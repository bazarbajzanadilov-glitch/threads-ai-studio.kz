import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./http.js";

const aws = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn() }));

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    S3Client: class {
      send(command: unknown): Promise<unknown> {
        return aws.send(command) as Promise<unknown>;
      }

      destroy(): void {
        aws.destroy();
      }
    }
  };
});

vi.mock("./media.js", () => ({
  probeUploadMetadata: vi.fn(async () => ({
    width: 1080,
    height: 1920,
    duration_ms: 10_000,
    fps: 30,
    video_codec: "h264",
    audio_codec: "aac"
  }))
}));

const {
  abortUpload,
  assertUploadConcurrency,
  assertUploadProfile,
  deriveUploadMutationKey,
  normalizeTemporaryCredentials,
  resumeUpload,
  uploadFile
} = await import("./upload.js");

const directories: string[] = [];

afterEach(async () => {
  aws.send.mockReset();
  aws.destroy.mockReset();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function credentials() {
  return {
    access_key_id: "access",
    secret_access_key: "secret",
    session_token: "session"
  };
}

function apiClient(request: ReturnType<typeof vi.fn>): ApiClient {
  return {
    request,
    mutationKey: (provided?: string) => provided ?? "generated"
  } as unknown as ApiClient;
}

async function sourceFile(contents = "abcdefghij"): Promise<{ file: string; state: string }> {
  const directory = await mkdtemp(join(tmpdir(), "publisher-upload-"));
  directories.push(directory);
  const file = join(directory, "video.mp4");
  const state = join(directory, "resume.json");
  await writeFile(file, contents);
  return { file, state };
}

describe("upload helpers", () => {
  it("enforces the four-part concurrency ceiling and the ready-media profile", () => {
    expect(() => assertUploadConcurrency(0)).toThrow(/1 to 4/);
    expect(() => assertUploadConcurrency(5)).toThrow(/1 to 4/);
    expect(() => assertUploadConcurrency(4)).not.toThrow();
    expect(() => assertUploadProfile("raw.mov", "video", "video/quicktime")).toThrow(/prepare.*\.mp4/i);
    expect(() => assertUploadProfile("ready.mp4", "video", "video/mp4")).not.toThrow();
    expect(() => assertUploadProfile("ready.png", "image", "image/png")).not.toThrow();
  });

  it("normalizes the snake_case credentials returned by the API", () => {
    expect(normalizeTemporaryCredentials(credentials())).toEqual({
      accessKeyId: "access",
      secretAccessKey: "secret",
      sessionToken: "session"
    });
  });

  it("accepts Cloudflare camelCase responses and rejects incomplete values", () => {
    expect(
      normalizeTemporaryCredentials({
        accessKeyId: "access",
        secretAccessKey: "secret",
        sessionToken: "session"
      })
    ).toEqual({
      accessKeyId: "access",
      secretAccessKey: "secret",
      sessionToken: "session"
    });
    expect(normalizeTemporaryCredentials({ access_key_id: "access" })).toBeUndefined();
    expect(normalizeTemporaryCredentials(undefined)).toBeUndefined();
  });

  it("derives stable, route-specific idempotency keys", () => {
    const create = deriveUploadMutationKey("workflow", "create");
    const complete = deriveUploadMutationKey("workflow", "complete");
    expect(create).toBe(deriveUploadMutationKey("workflow", "create"));
    expect(create).not.toBe(complete);
    expect(create.length).toBeLessThan(64);
  });

  it("uploads multipart parts and asks the API to complete sorted ETags", async () => {
    const { file, state } = await sourceFile();
    aws.send.mockImplementation(async (command: { constructor: { name: string }; input?: { PartNumber?: number } }) => {
      if (command.constructor.name === "ListPartsCommand") return { Parts: [], IsTruncated: false };
      if (command.constructor.name === "UploadPartCommand") return { ETag: `etag-${String(command.input?.PartNumber)}` };
      throw new Error(`Unexpected S3 command ${command.constructor.name}`);
    });
    const request = vi.fn(async (path: string, options?: { body?: unknown }) => {
      if (path === "/api/v1/uploads") {
        return {
          data: {
            id: "session-1",
            key: "uploads/session-1/video.mp4",
            mode: "multipart",
            endpoint: "https://account.r2.cloudflarestorage.com",
            bucket: "publisher-test",
            region: "auto",
            expires_at: "2026-08-26T00:00:00Z",
            part_size: 5,
            upload_id: "r2-upload-1",
            credentials: credentials()
          }
        };
      }
      if (path.endsWith(":complete")) return { data: { id: "session-1", status: "uploaded" } };
      throw new Error(`Unexpected API path ${path}: ${JSON.stringify(options)}`);
    });
    const result = await uploadFile(apiClient(request), {
      file,
      contentType: "video/mp4",
      kind: "video",
      resumeFile: state,
      concurrency: 1,
      partSize: 5,
      idempotencyKey: "workflow",
      quiet: true
    });
    expect(result.mode).toBe("multipart");
    const completeCall = request.mock.calls.find(([path]) => String(path).endsWith(":complete"));
    expect(completeCall?.[1]?.body).toEqual({
      parts: [
        { part_number: 1, etag: "etag-1" },
        { part_number: 2, etag: "etag-2" }
      ]
    });
    expect(aws.send.mock.calls.map(([command]) => command.constructor.name)).toEqual([
      "ListPartsCommand",
      "UploadPartCommand",
      "UploadPartCommand"
    ]);
    await expect(readFile(state, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("resumes only missing parts and preserves the API-owned upload id", async () => {
    const { file, state } = await sourceFile();
    const info = await stat(file);
    await writeFile(state, JSON.stringify({
      version: 1,
      apiSessionId: "session-2",
      mode: "multipart",
      objectKey: "uploads/session-2/video.mp4",
      filePath: file,
      fileSize: info.size,
      fileMtimeMs: info.mtimeMs,
      sha256: "a".repeat(64),
      contentType: "video/mp4",
      idempotencySeed: "original-workflow",
      endpoint: "https://account.r2.cloudflarestorage.com",
      bucket: "publisher-test",
      region: "auto",
      partSize: 5,
      r2UploadId: "r2-upload-2"
    }));
    aws.send.mockImplementation(async (command: { constructor: { name: string }; input?: { PartNumber?: number } }) => {
      if (command.constructor.name === "ListPartsCommand") {
        return { Parts: [{ PartNumber: 1, ETag: "etag-1" }], IsTruncated: false };
      }
      if (command.constructor.name === "UploadPartCommand") return { ETag: `etag-${String(command.input?.PartNumber)}` };
      throw new Error(`Unexpected S3 command ${command.constructor.name}`);
    });
    const request = vi.fn(async (path: string, _options?: { body?: unknown }) => {
      if (path.endsWith(":credentials")) {
        return { data: { upload_id: "r2-upload-2", credentials: credentials() } };
      }
      if (path.endsWith(":complete")) return { data: { status: "uploaded" } };
      throw new Error(`Unexpected API path ${path}`);
    });
    await resumeUpload(apiClient(request), state, {
      concurrency: 1,
      quiet: true,
      idempotencyKey: "resume-invocation"
    });
    expect(aws.send.mock.calls.map(([command]) => command.constructor.name)).toEqual([
      "ListPartsCommand",
      "UploadPartCommand"
    ]);
    const completeCall = request.mock.calls.find(([path]) => String(path).endsWith(":complete"));
    expect(completeCall?.[1]?.body).toEqual({
      parts: [
        { part_number: 1, etag: "etag-1" },
        { part_number: 2, etag: "etag-2" }
      ]
    });
  });

  it("aborts the direct multipart session and the authoritative API session", async () => {
    const { file, state } = await sourceFile();
    const info = await stat(file);
    await writeFile(state, JSON.stringify({
      version: 1,
      apiSessionId: "session-3",
      mode: "multipart",
      objectKey: "uploads/session-3/video.mp4",
      filePath: file,
      fileSize: info.size,
      fileMtimeMs: info.mtimeMs,
      sha256: "b".repeat(64),
      contentType: "video/mp4",
      idempotencySeed: "original-workflow",
      endpoint: "https://account.r2.cloudflarestorage.com",
      bucket: "publisher-test",
      region: "auto",
      partSize: 5,
      r2UploadId: "r2-upload-3"
    }));
    aws.send.mockResolvedValue({});
    const request = vi.fn(async (path: string, options?: { body?: unknown }) => {
      if (path.endsWith(":credentials")) {
        return { data: { upload_id: "r2-upload-3", credentials: credentials() } };
      }
      if (path.endsWith(":abort")) return { data: { aborted: true, body: options?.body } };
      throw new Error(`Unexpected API path ${path}`);
    });
    await abortUpload(apiClient(request), state, "abort-invocation");
    expect(aws.send).toHaveBeenCalledTimes(1);
    expect(aws.send.mock.calls[0]?.[0]?.constructor.name).toBe("AbortMultipartUploadCommand");
    const abortCall = request.mock.calls.find(([path]) => String(path).endsWith(":abort"));
    expect(abortCall?.[1]?.body).toEqual({ upload_id: "r2-upload-3" });
  });
});
