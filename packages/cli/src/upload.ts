import {
  AbortMultipartUploadCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
  type CompletedPart
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { Readable } from "node:stream";
import type { ApiClient } from "./http.js";
import { probeUploadMetadata } from "./media.js";

export interface TemporaryCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken: string;
}

interface ApiTemporaryCredentials {
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly sessionToken?: string;
  readonly access_key_id?: string;
  readonly secret_access_key?: string;
  readonly session_token?: string;
}

interface UploadSessionBase {
  readonly id: string;
  readonly key: string;
  readonly mode: "single" | "multipart";
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: "auto" | string;
  readonly expires_at: string;
  readonly part_size: number;
}

interface UploadSession extends UploadSessionBase {
  readonly upload_url?: string;
  readonly upload_headers?: Readonly<Record<string, string>>;
  readonly upload_id?: string;
  readonly credentials?: ApiTemporaryCredentials;
}

interface ApiEnvelope<T> {
  readonly data: T;
}

interface ResumeState {
  readonly version: 1;
  readonly apiSessionId: string;
  readonly mode: "single" | "multipart";
  readonly objectKey: string;
  readonly filePath: string;
  readonly fileSize: number;
  readonly fileMtimeMs: number;
  readonly sha256: string;
  readonly contentType: string;
  readonly idempotencySeed?: string;
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly partSize: number;
  readonly uploadHeaders?: Readonly<Record<string, string>>;
  readonly r2UploadId?: string;
  readonly completedParts?: readonly { readonly part_number: number; readonly etag: string }[];
  readonly objectUploaded?: boolean;
}

export interface UploadOptions {
  readonly file: string;
  readonly contentType: string;
  readonly kind: "image" | "video";
  readonly resumeFile?: string;
  readonly concurrency: number;
  readonly partSize: number;
  readonly ffprobePath?: string;
  readonly idempotencyKey?: string;
  readonly quiet: boolean;
}

export interface UploadResult {
  readonly id: string;
  readonly key: string;
  readonly sha256: string;
  readonly size: number;
  readonly mode: "single" | "multipart";
}

function resumePath(file: string, explicit?: string): string {
  return resolve(explicit ?? `${file}.publisher-upload.json`);
}

export function normalizeTemporaryCredentials(
  credentials: ApiTemporaryCredentials | undefined
): TemporaryCredentials | undefined {
  if (!credentials) return undefined;
  const accessKeyId = credentials.accessKeyId ?? credentials.access_key_id;
  const secretAccessKey = credentials.secretAccessKey ?? credentials.secret_access_key;
  const sessionToken = credentials.sessionToken ?? credentials.session_token;
  if (!accessKeyId || !secretAccessKey || !sessionToken) return undefined;
  return { accessKeyId, secretAccessKey, sessionToken };
}

export function deriveUploadMutationKey(seed: string, stage: string): string {
  return `upload-${createHash("sha256").update(`${seed}\0${stage}`).digest("hex").slice(0, 48)}`;
}

export function assertUploadConcurrency(concurrency: number): void {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw new Error("Upload concurrency must be an integer from 1 to 4");
  }
}

export function assertUploadProfile(file: string, kind: "image" | "video", contentType: string): void {
  const extension = extname(file).toLowerCase();
  if (kind === "video" && (extension !== ".mp4" || contentType !== "video/mp4")) {
    throw new Error("Upload-ready video must be an MP4 file with video/mp4 content type; run publisherctl prepare to create .mp4");
  }
  if (
    kind === "image" &&
    !((extension === ".jpg" || extension === ".jpeg") && contentType === "image/jpeg") &&
    !(extension === ".png" && contentType === "image/png")
  ) {
    throw new Error("Upload-ready image must be JPEG (image/jpeg) or PNG (image/png)");
  }
}

async function saveResume(path: string, state: ResumeState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}

async function loadResume(path: string): Promise<ResumeState> {
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (typeof value !== "object" || value === null || (value as { version?: unknown }).version !== 1) {
    throw new Error(`Unsupported resume state in ${path}`);
  }
  return value as ResumeState;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function s3Client(session: UploadSession | ResumeState, credentials: TemporaryCredentials): S3Client {
  return new S3Client({
    endpoint: session.endpoint,
    region: session.region,
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials
  });
}

function report(message: string, quiet: boolean): void {
  if (!quiet) process.stderr.write(`${message}\n`);
}

async function uploadSingle(
  url: string,
  state: ResumeState,
  uploadHeaders: Readonly<Record<string, string>>,
  quiet: boolean
): Promise<void> {
  const stream = createReadStream(state.filePath);
  let uploaded = 0;
  stream.on("data", (chunk: string | Buffer) => {
    uploaded += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
    if (!quiet && uploaded === state.fileSize) {
      process.stderr.write(`Uploaded ${state.fileSize} bytes.\n`);
    }
  });
  const headers = new Headers(uploadHeaders);
  headers.set("Content-Type", state.contentType);
  headers.set("Content-Length", String(state.fileSize));
  const response = await fetch(url, {
    method: "PUT",
    headers,
    body: Readable.toWeb(stream) as ReadableStream<Uint8Array>,
    duplex: "half"
  } as RequestInit & { duplex: "half" });
  if (!response.ok) {
    throw new Error(`R2 single upload failed with HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
}

async function listCompletedParts(
  client: S3Client,
  state: ResumeState
): Promise<Map<number, CompletedPart>> {
  if (!state.r2UploadId) return new Map();
  const completed = new Map<number, CompletedPart>();
  let marker: string | undefined;
  do {
    const page = await client.send(
      new ListPartsCommand({
        Bucket: state.bucket,
        Key: state.objectKey,
        UploadId: state.r2UploadId,
        ...(marker ? { PartNumberMarker: marker } : {})
      })
    );
    for (const part of page.Parts ?? []) {
      if (part.PartNumber !== undefined && part.ETag) {
        completed.set(part.PartNumber, { ETag: part.ETag, PartNumber: part.PartNumber });
      }
    }
    marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
  } while (marker);
  return completed;
}

async function uploadMultipart(
  api: ApiClient,
  statePath: string,
  initialState: ResumeState,
  initialCredentials: TemporaryCredentials | undefined,
  concurrency: number,
  quiet: boolean,
  idempotencyKey?: string
): Promise<ResumeState> {
  let state = initialState;
  let credentials = initialCredentials;
  if (!credentials) {
    const refreshed = await api.request<ApiEnvelope<UploadSession>>(
      `/api/v1/uploads/${encodeURIComponent(state.apiSessionId)}:credentials`,
      {
        method: "POST",
        idempotencyKey: deriveUploadMutationKey(
          api.mutationKey(idempotencyKey ?? state.idempotencySeed),
          "credentials"
        )
      }
    );
    credentials = normalizeTemporaryCredentials(refreshed.data.credentials);
  }
  if (!credentials) throw new Error("API did not return temporary multipart credentials");
  const client = s3Client(state, credentials);
  if (!state.r2UploadId) throw new Error("API did not return an R2 multipart upload ID");

  const parts = await listCompletedParts(client, state);
  const partCount = Math.ceil(state.fileSize / state.partSize);
  const pending = Array.from({ length: partCount }, (_, index) => index + 1).filter(
    (partNumber) => !parts.has(partNumber)
  );
  let cursor = 0;
  let uploadedBytes = [...parts.keys()].reduce((total, partNumber) => {
    const start = (partNumber - 1) * state.partSize;
    return total + Math.min(state.partSize, state.fileSize - start);
  }, 0);

  const worker = async (): Promise<void> => {
    while (cursor < pending.length) {
      const item = pending[cursor];
      cursor += 1;
      if (item === undefined) return;
      const start = (item - 1) * state.partSize;
      const length = Math.min(state.partSize, state.fileSize - start);
      const body = createReadStream(state.filePath, { start, end: start + length - 1 });
      const result = await client.send(
        new UploadPartCommand({
          Bucket: state.bucket,
          Key: state.objectKey,
          UploadId: state.r2UploadId,
          PartNumber: item,
          Body: body,
          ContentLength: length
        })
      );
      if (!result.ETag) throw new Error(`R2 did not return an ETag for part ${item}`);
      parts.set(item, { ETag: result.ETag, PartNumber: item });
      uploadedBytes += length;
      report(`Uploaded part ${parts.size}/${partCount} (${Math.floor((uploadedBytes / state.fileSize) * 100)}%).`, quiet);
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), pending.length || 1) }, worker));
  } catch (error) {
    report(`Upload paused. Resume with: publisherctl upload resume --state "${statePath}"`, quiet);
    throw error;
  } finally {
    client.destroy();
  }
  const completedParts = [...parts.values()]
    .sort((left, right) => (left.PartNumber ?? 0) - (right.PartNumber ?? 0))
    .map((part) => {
      if (part.PartNumber === undefined || !part.ETag) throw new Error("R2 returned an incomplete part record");
      return { part_number: part.PartNumber, etag: part.ETag };
    });
  state = { ...state, completedParts, objectUploaded: true };
  await saveResume(statePath, state);
  return state;
}

async function finishApiSession(
  api: ApiClient,
  state: ResumeState,
  idempotencyKey?: string
): Promise<void> {
  await api.request(`/api/v1/uploads/${encodeURIComponent(state.apiSessionId)}:complete`, {
    method: "POST",
    body: state.mode === "multipart" ? { parts: state.completedParts ?? [] } : {},
    idempotencyKey: deriveUploadMutationKey(
      api.mutationKey(state.idempotencySeed ?? idempotencyKey),
      "complete"
    )
  });
}

export async function uploadFile(api: ApiClient, options: UploadOptions): Promise<UploadResult> {
  const filePath = resolve(options.file);
  assertUploadConcurrency(options.concurrency);
  assertUploadProfile(filePath, options.kind, options.contentType);
  const info = await stat(filePath);
  if (!info.isFile() || info.size === 0) throw new Error("Upload source must be a non-empty regular file");
  const statePath = resumePath(filePath, options.resumeFile);
  report("Calculating SHA-256…", options.quiet);
  const idempotencySeed = api.mutationKey(options.idempotencyKey);
  const [sha256, metadata] = await Promise.all([
    sha256File(filePath),
    probeUploadMetadata(filePath, options.kind, options.ffprobePath)
  ]);
  const response = await api.request<ApiEnvelope<UploadSession>>("/api/v1/uploads", {
    method: "POST",
    idempotencyKey: deriveUploadMutationKey(idempotencySeed, "create"),
    body: {
      file_name: basename(filePath),
      size_bytes: info.size,
      mime_type: options.contentType,
      sha256,
      ...metadata
    }
  });
  const session = response.data;
  let state: ResumeState = {
    version: 1,
    apiSessionId: session.id,
    mode: session.mode,
    objectKey: session.key,
    filePath,
    fileSize: info.size,
    fileMtimeMs: info.mtimeMs,
    sha256,
    contentType: options.contentType,
    idempotencySeed,
    endpoint: session.endpoint,
    bucket: session.bucket,
    region: session.region,
    partSize: session.part_size || options.partSize,
    ...(session.upload_headers ? { uploadHeaders: session.upload_headers } : {}),
    ...(session.upload_id ? { r2UploadId: session.upload_id } : {})
  };
  await saveResume(statePath, state);

  if (session.mode === "single") {
    if (!session.upload_url) throw new Error("API did not return a presigned single upload URL");
    await uploadSingle(session.upload_url, state, session.upload_headers ?? {}, options.quiet);
    state = { ...state, objectUploaded: true };
    await saveResume(statePath, state);
  } else {
    if (!session.upload_id) throw new Error("API did not return an R2 multipart upload ID");
    state = await uploadMultipart(
      api,
      statePath,
      state,
      normalizeTemporaryCredentials(session.credentials),
      options.concurrency,
      options.quiet,
      idempotencySeed
    );
  }
  await finishApiSession(api, state, idempotencySeed);
  await unlink(statePath).catch(() => undefined);
  return { id: session.id, key: session.key, sha256, size: info.size, mode: session.mode };
}

export async function resumeUpload(
  api: ApiClient,
  stateFile: string,
  options: Pick<UploadOptions, "concurrency" | "quiet" | "idempotencyKey">
): Promise<UploadResult> {
  assertUploadConcurrency(options.concurrency);
  const statePath = resolve(stateFile);
  let state = await loadResume(statePath);
  const info = await stat(state.filePath);
  if (info.size !== state.fileSize || info.mtimeMs !== state.fileMtimeMs) {
    throw new Error("Source file changed since the upload started; refusing an unsafe resume");
  }
  if (!state.objectUploaded) {
    const refreshed = await api.request<ApiEnvelope<UploadSession>>(
      `/api/v1/uploads/${encodeURIComponent(state.apiSessionId)}:credentials`,
      {
        method: "POST",
        idempotencyKey: deriveUploadMutationKey(api.mutationKey(options.idempotencyKey), "credentials")
      }
    );
    if (state.mode === "single") {
      if (!refreshed.data.upload_url) throw new Error("API did not refresh the presigned upload URL");
      const uploadHeaders = refreshed.data.upload_headers ?? state.uploadHeaders ?? {};
      await uploadSingle(refreshed.data.upload_url, state, uploadHeaders, options.quiet);
      state = { ...state, uploadHeaders, objectUploaded: true };
      await saveResume(statePath, state);
    } else {
      const uploadId = refreshed.data.upload_id ?? state.r2UploadId;
      if (!uploadId) throw new Error("API did not refresh the R2 multipart upload ID");
      if (state.r2UploadId && refreshed.data.upload_id && state.r2UploadId !== refreshed.data.upload_id) {
        throw new Error("API returned a different multipart upload ID; refusing unsafe resume");
      }
      state = { ...state, r2UploadId: uploadId };
      state = await uploadMultipart(
        api,
        statePath,
        state,
        normalizeTemporaryCredentials(refreshed.data.credentials),
        options.concurrency,
        options.quiet,
        options.idempotencyKey
      );
    }
  }
  await finishApiSession(api, state, options.idempotencyKey);
  await unlink(statePath).catch(() => undefined);
  return {
    id: state.apiSessionId,
    key: state.objectKey,
    sha256: state.sha256,
    size: state.fileSize,
    mode: state.mode
  };
}

export async function abortUpload(
  api: ApiClient,
  stateFile: string,
  idempotencyKey?: string
): Promise<void> {
  const statePath = resolve(stateFile);
  const state = await loadResume(statePath);
  if (state.mode === "multipart" && state.r2UploadId && !state.objectUploaded) {
    try {
      const refreshed = await api.request<ApiEnvelope<UploadSession>>(
      `/api/v1/uploads/${encodeURIComponent(state.apiSessionId)}:credentials`,
        {
          method: "POST",
          idempotencyKey: deriveUploadMutationKey(api.mutationKey(idempotencyKey), "abort-credentials")
        }
      );
      const credentials = normalizeTemporaryCredentials(refreshed.data.credentials);
      if (credentials) {
        const client = s3Client(state, credentials);
        try {
          await client.send(
            new AbortMultipartUploadCommand({
              Bucket: state.bucket,
              Key: state.objectKey,
              UploadId: state.r2UploadId
            })
          );
        } finally {
          client.destroy();
        }
      }
    } catch {
      // The API has an R2 binding and performs the authoritative abort below.
    }
  }
  await api.request(`/api/v1/uploads/${encodeURIComponent(state.apiSessionId)}:abort`, {
    method: "POST",
    body: state.r2UploadId ? { upload_id: state.r2UploadId } : {},
    idempotencyKey: deriveUploadMutationKey(
      api.mutationKey(state.idempotencySeed ?? idempotencyKey),
      "abort"
    )
  });
  await unlink(statePath).catch(() => undefined);
}
