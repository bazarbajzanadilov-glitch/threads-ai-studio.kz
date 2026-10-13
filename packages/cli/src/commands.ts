import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { booleanFlag, integerFlag, stringFlag, type ParsedArgs } from "./args.js";
import { BULK_CHUNK_SIZE, bulkResultStatus, chunkedBulkUpsert } from "./bulk.js";
import {
  configPath,
  loadConfig,
  removeProfileToken,
  resolveProfile,
  saveConfig,
  upsertProfile,
  type CliConfig
} from "./config.js";
import { ApiClient } from "./http.js";
import { loadManifest, type ContentInput } from "./manifest.js";
import { prepareMedia, validateMedia, type MediaKind, type MediaPlatform } from "./media.js";
import { printValue, unwrapData } from "./output.js";
import { writeApplyReceipt } from "./receipt.js";
import { storagePlan } from "./storage.js";
import { syncContentPagePath, syncValuesEqual } from "./sync.js";
import { abortUpload, assertUploadConcurrency, resumeUpload, uploadFile } from "./upload.js";

interface CommandContext {
  readonly args: ParsedArgs;
  readonly tokens: readonly string[];
}

interface ContentListPage {
  readonly items?: unknown[];
  readonly next_cursor?: string | null;
}

function outputOptions(args: ParsedArgs): { json: boolean; quiet: boolean } {
  return { json: booleanFlag(args, "json"), quiet: booleanFlag(args, "quiet") };
}

function requireToken(tokens: readonly string[], index: number, description: string): string {
  const value = tokens[index];
  if (!value) throw new Error(`Missing ${description}`);
  return value;
}

function idempotencyKey(args: ParsedArgs): string {
  return stringFlag(args, "idempotency-key") ?? randomUUID();
}

function requiredRevision(args: ParsedArgs): number {
  const raw = stringFlag(args, "revision");
  if (raw === undefined) {
    throw new Error("--revision is required for mutation safety. Read the current item before retrying.");
  }
  const revision = Number(raw);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("--revision must be a positive integer");
  return revision;
}

async function clientFor(args: ParsedArgs, requireTokenValue = true): Promise<ApiClient> {
  const config = await loadConfig();
  const resolved = resolveProfile(config, stringFlag(args, "profile"));
  if (requireTokenValue && !resolved.profile.token) {
    throw new Error(`Profile '${resolved.name}' has no token. Run publisherctl auth login.`);
  }
  return new ApiClient(resolved.profile);
}

async function promptSecret(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
    throw new Error("Set PUBLISHER_API_TOKEN in non-interactive environments");
  }
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  let value = "";
  try {
    return await new Promise<string>((resolvePromise, reject) => {
      const onData = (chunk: string): void => {
        for (const character of chunk) {
          if (character === "\u0003") {
            process.stdin.off("data", onData);
            reject(new Error("Cancelled"));
            return;
          }
          if (character === "\r" || character === "\n") {
            process.stdin.off("data", onData);
            process.stdout.write("\n");
            resolvePromise(value);
            return;
          }
          if (character === "\u007f" || character === "\b") {
            value = value.slice(0, -1);
          } else if (character >= " ") {
            value += character;
          }
        }
      };
      process.stdin.on("data", onData);
    });
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

async function authCommand(context: CommandContext): Promise<void> {
  const action = context.tokens[1] ?? "login";
  const profileName = stringFlag(context.args, "profile") ?? "default";
  if (action === "logout") {
    await removeProfileToken(profileName);
    printValue({ profile: profileName, authenticated: false }, outputOptions(context.args));
    return;
  }
  if (action !== "login") throw new Error("Usage: publisherctl auth login|logout");
  const current = await loadConfig();
  const existing = current.profiles[profileName];
  const apiUrl = stringFlag(context.args, "api-url") ?? process.env.PUBLISHER_API_URL ?? existing?.apiUrl;
  if (!apiUrl) throw new Error("--api-url is required the first time a profile is configured");
  const token =
    stringFlag(context.args, "token") ?? process.env.PUBLISHER_API_TOKEN ?? (await promptSecret("Agent token: "));
  if (!token) throw new Error("Agent token cannot be empty");
  const cfAccessClientId =
    stringFlag(context.args, "cf-access-client-id") ??
    process.env.CF_ACCESS_CLIENT_ID ??
    existing?.cfAccessClientId;
  let cfAccessClientSecret =
    stringFlag(context.args, "cf-access-client-secret") ??
    process.env.CF_ACCESS_CLIENT_SECRET ??
    existing?.cfAccessClientSecret;
  if (cfAccessClientId && !cfAccessClientSecret) {
    cfAccessClientSecret = await promptSecret("Cloudflare Access client secret: ");
  }
  if (!cfAccessClientId && cfAccessClientSecret) {
    throw new Error("--cf-access-client-id is required when a Cloudflare Access client secret is set");
  }
  const access = cfAccessClientId && cfAccessClientSecret
    ? { cfAccessClientId, cfAccessClientSecret }
    : {};
  const client = new ApiClient({ apiUrl, token, ...access });
  await client.request("/api/v1/system/status");
  if (context.args.flags.store === false) {
    printValue(
      { profile: profileName, apiUrl, authenticated: true, cloudflareAccess: Boolean(cfAccessClientId), stored: false },
      outputOptions(context.args)
    );
    return;
  }
  await upsertProfile(profileName, { apiUrl, token, ...access });
  printValue(
    { profile: profileName, apiUrl, authenticated: true, cloudflareAccess: Boolean(cfAccessClientId), stored: true },
    outputOptions(context.args)
  );
}

async function configCommand(context: CommandContext): Promise<void> {
  const action = context.tokens[1] ?? "show";
  const profileName = stringFlag(context.args, "profile");
  if (action === "path") {
    process.stdout.write(`${configPath()}\n`);
    return;
  }
  if (action === "show") {
    const config = await loadConfig();
    const redacted = {
      ...config,
      profiles: Object.fromEntries(
        Object.entries(config.profiles).map(([name, profile]) => [
          name,
          {
            apiUrl: profile.apiUrl,
            authenticated: Boolean(profile.token),
            cloudflareAccess: Boolean(profile.cfAccessClientId && profile.cfAccessClientSecret)
          }
        ])
      )
    };
    printValue(redacted, outputOptions(context.args));
    return;
  }
  if (action === "set") {
    const name = profileName ?? "default";
    const apiUrl = stringFlag(context.args, "api-url");
    if (!apiUrl) throw new Error("config set requires --api-url");
    const result = await upsertProfile(name, { apiUrl });
    printValue({ currentProfile: result.currentProfile, profile: name, apiUrl }, outputOptions(context.args));
    return;
  }
  if (action === "use") {
    const name = requireToken(context.tokens, 2, "profile name");
    const config = await loadConfig();
    if (!config.profiles[name]) throw new Error(`Unknown profile '${name}'`);
    const next: CliConfig = { ...config, currentProfile: name };
    await saveConfig(next);
    printValue({ currentProfile: name }, outputOptions(context.args));
    return;
  }
  throw new Error("Usage: publisherctl config show|path|set|use");
}

function queryString(args: ParsedArgs, allowed: readonly string[]): string {
  const params = new URLSearchParams();
  for (const name of allowed) {
    const value = stringFlag(args, name);
    if (value !== undefined) params.set(name, value);
  }
  return params.size > 0 ? `?${params}` : "";
}

async function readCommand(context: CommandContext): Promise<void> {
  const command = context.tokens[0];
  const client = await clientFor(context.args);
  let path: string;
  if (command === "status") path = "/api/v1/system/status";
  else if (command === "accounts") path = "/api/v1/accounts";
  else if (command === "events") {
    path = `/api/v1/events${queryString(context.args, ["cursor", "limit", "level", "type"] )}`;
  } else {
    path = `/api/v1/content${queryString(context.args, ["cursor", "limit", "platform", "state", "account_id", "from", "to"] )}`;
  }
  const response = await client.request(path);
  printValue(unwrapData(response), outputOptions(context.args));
}

function mediaKind(args: ParsedArgs): MediaKind {
  const value = stringFlag(args, "kind") ?? "reel";
  if (value !== "reel" && value !== "video" && value !== "image") {
    throw new Error("--kind must be reel, video, or image");
  }
  return value;
}

function mediaPlatform(args: ParsedArgs): MediaPlatform {
  const value = stringFlag(args, "platform") ?? "threads";
  if (value !== "threads") {
    throw new Error("--platform must be threads");
  }
  return value;
}

async function validateCommand(context: CommandContext): Promise<void> {
  const path = requireToken(context.tokens, 1, "manifest or media path");
  if (booleanFlag(context.args, "manifest") || extname(path).toLowerCase() === ".json") {
    const result = await loadManifest(path);
    printValue(result, outputOptions(context.args));
    if (!result.valid) process.exitCode = 3;
    return;
  }
  const result = await validateMedia(
    path,
    mediaPlatform(context.args),
    mediaKind(context.args),
    stringFlag(context.args, "ffprobe")
  );
  printValue(result, outputOptions(context.args));
  if (!result.valid) process.exitCode = 3;
}

async function prepareCommand(context: CommandContext): Promise<void> {
  const input = requireToken(context.tokens, 1, "input path");
  const output = stringFlag(context.args, "output");
  if (!output) throw new Error("prepare requires --output");
  const fitValue = stringFlag(context.args, "fit") ?? "contain";
  if (fitValue !== "contain" && fitValue !== "cover") throw new Error("--fit must be contain or cover");
  const options = {
    input,
    output,
    kind: mediaKind(context.args),
    fit: fitValue,
    force: booleanFlag(context.args, "force"),
    dryRun: booleanFlag(context.args, "dry-run"),
    ...(stringFlag(context.args, "ffmpeg") ? { ffmpegPath: stringFlag(context.args, "ffmpeg") } : {})
  } as const;
  const command = await prepareMedia(options);
  printValue({ output: resolve(output), command: [options.ffmpegPath ?? "ffmpeg", ...command] }, outputOptions(context.args));
}

function inferContentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".mp4":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
}

async function uploadCommand(context: CommandContext): Promise<void> {
  const client = await clientFor(context.args);
  const action = context.tokens[1];
  const concurrency = integerFlag(context.args, "concurrency", 3);
  assertUploadConcurrency(concurrency);
  if (action === "resume" || action === "abort") {
    const state = stringFlag(context.args, "state") ?? context.tokens[2];
    if (!state) throw new Error(`${action} requires --state <resume-file>`);
    if (action === "abort") {
      await abortUpload(client, state, idempotencyKey(context.args));
      printValue({ aborted: true, state: resolve(state) }, outputOptions(context.args));
    } else {
      const result = await resumeUpload(client, state, {
        concurrency,
        quiet: booleanFlag(context.args, "quiet"),
        idempotencyKey: idempotencyKey(context.args)
      });
      printValue(result, outputOptions(context.args));
    }
    return;
  }
  const file = requireToken(context.tokens, 1, "file path");
  const kind = stringFlag(context.args, "kind") ?? (inferContentType(file).startsWith("image/") ? "image" : "video");
  if (kind !== "image" && kind !== "video") throw new Error("--kind must be image or video");
  const result = await uploadFile(client, {
    file,
    contentType: stringFlag(context.args, "content-type") ?? inferContentType(file),
    kind,
    ...(stringFlag(context.args, "state") ? { resumeFile: stringFlag(context.args, "state") } : {}),
    concurrency,
    partSize: integerFlag(context.args, "part-size", 67_108_864),
    ...(stringFlag(context.args, "ffprobe") ? { ffprobePath: stringFlag(context.args, "ffprobe") } : {}),
    idempotencyKey: idempotencyKey(context.args),
    quiet: booleanFlag(context.args, "quiet")
  });
  printValue(result, outputOptions(context.args));
}

async function manifestOrThrow(path: string): Promise<readonly ContentInput[]> {
  const validation = await loadManifest(path);
  if (!validation.valid || !validation.manifest) {
    const message = validation.issues
      .map((entry) => `${entry.index === undefined ? "manifest" : `item ${entry.index}`}${entry.field ? `.${entry.field}` : ""}: ${entry.message}`)
      .join("\n");
    throw new Error(message);
  }
  return validation.manifest.items;
}

async function bulkUpsertCommand(context: CommandContext): Promise<void> {
  const manifestPath = requireToken(context.tokens, 1, "manifest path");
  const items = await manifestOrThrow(manifestPath);
  const apply = booleanFlag(context.args, "apply");
  const client = await clientFor(context.args);
  const result = await chunkedBulkUpsert(client, items, {
    dryRun: !apply,
    overrideConflicts: false,
    idempotencySeed: idempotencyKey(context.args)
  });
  let receipt: Awaited<ReturnType<typeof writeApplyReceipt>> | undefined;
  const status = bulkResultStatus(result.result);
  if (apply) {
    receipt = await writeApplyReceipt({
      manifestPath,
      manifest: { version: 1, items },
      operation: "bulk-upsert",
      status,
      result,
      ...(stringFlag(context.args, "receipt-dir") ? { receiptDir: stringFlag(context.args, "receipt-dir") } : {})
    });
  }
  printValue({ status, ...result, ...(receipt ? { receipt } : {}) }, outputOptions(context.args));
  if (status === "partial") process.exitCode = 3;
  if (!apply && !booleanFlag(context.args, "quiet")) {
    process.stderr.write("Dry run only. Re-run with --apply to write changes.\n");
  }
}

function pageItems(response: unknown): { items: Record<string, unknown>[]; next?: string } {
  if (typeof response === "object" && response !== null) {
    const envelope = response as { data?: unknown; next_cursor?: unknown };
    if (Array.isArray(envelope.data)) {
      return {
        items: envelope.data.filter(
          (item): item is Record<string, unknown> => typeof item === "object" && item !== null
        ),
        ...(typeof envelope.next_cursor === "string" && envelope.next_cursor
          ? { next: envelope.next_cursor }
          : {})
      };
    }
  }
  const data = unwrapData(response);
  if (Array.isArray(data)) {
    return { items: data.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null) };
  }
  if (typeof data === "object" && data !== null) {
    const page = data as ContentListPage;
    return {
      items: (page.items ?? []).filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null),
      ...(page.next_cursor ? { next: page.next_cursor } : {})
    };
  }
  return { items: [] };
}

async function allRemoteContent(client: ApiClient): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  do {
    const page = pageItems(await client.request(syncContentPagePath(cursor)));
    results.push(...page.items);
    cursor = page.next;
  } while (cursor);
  return results;
}

async function syncCommand(context: CommandContext): Promise<void> {
  const manifestPath = requireToken(context.tokens, 1, "manifest path");
  const local = await manifestOrThrow(manifestPath);
  const client = await clientFor(context.args);
  const remote = await allRemoteContent(client);
  const remoteByKey = new Map<string, Record<string, unknown>>(
    remote.map((item) => [`${String(item.platform)}:${String(item.external_id)}`, item] as const)
  );
  const creates: ContentInput[] = [];
  const updates: ContentInput[] = [];
  const unchanged: ContentInput[] = [];
  for (const item of local) {
    const remoteKey = `${item.platform}:${item.external_id.trim()}`;
    const remoteItem = remoteByKey.get(remoteKey);
    if (!remoteItem) {
      creates.push(item);
      continue;
    }
    remoteByKey.delete(remoteKey);
    if (syncValuesEqual(item as unknown as Record<string, unknown>, remoteItem)) {
      unchanged.push(item);
    } else {
      const revision = remoteItem.revision;
      updates.push({
        ...item,
        ...(typeof revision === "number" ? { expected_revision: revision } : {})
      });
    }
  }
  const summary = {
    creates: creates.length,
    updates: updates.length,
    unchanged: unchanged.length,
    remote_only: remoteByKey.size,
    remote_only_note: "Remote-only rows are never deleted or cancelled by sync."
  };
  const apply = booleanFlag(context.args, "apply");
  const changed = [...creates, ...updates];
  const result = changed.length > 0
    ? await chunkedBulkUpsert(client, changed, {
        dryRun: !apply,
        overrideConflicts: false,
        idempotencySeed: idempotencyKey(context.args)
      })
    : { chunk_size: BULK_CHUNK_SIZE, chunks: [], result: { created: [], updated: [], unchanged: [], conflicts: [], errors: [] } };
  if (!apply) {
    const status = bulkResultStatus(result.result);
    printValue({ status, summary, ...result }, outputOptions(context.args));
    if (status === "partial") process.exitCode = 3;
    if (!booleanFlag(context.args, "quiet")) process.stderr.write("Dry run only. Re-run with --apply to upsert.\n");
    return;
  }
  const receipt = await writeApplyReceipt({
    manifestPath,
    manifest: { version: 1, items: local },
    operation: "sync",
    status: bulkResultStatus(result.result),
    result: { summary, ...result },
    ...(stringFlag(context.args, "receipt-dir") ? { receiptDir: stringFlag(context.args, "receipt-dir") } : {})
  });
  const status = bulkResultStatus(result.result);
  printValue({ status, summary, ...result, receipt }, outputOptions(context.args));
  if (status === "partial") process.exitCode = 3;
}

async function storagePlanCommand(context: CommandContext): Promise<void> {
  const inputs = context.tokens.slice(1);
  const result = await storagePlan(inputs, booleanFlag(context.args, "recursive"));
  printValue(result, outputOptions(context.args));
}

async function mutationCommand(context: CommandContext): Promise<void> {
  const action = context.tokens[0];
  const id = requireToken(context.tokens, 1, "content ID");
  const revision = requiredRevision(context.args);
  const client = await clientFor(context.args);
  let body: Record<string, unknown> = { expected_revision: revision };
  const endpoint = `/api/v1/content/${encodeURIComponent(id)}:${action}`;
  if (action === "reschedule") {
    const scheduledAt = stringFlag(context.args, "at");
    if (
      !scheduledAt ||
      !/^\d{4}-\d{2}-\d{2}T/.test(scheduledAt) ||
      !Number.isFinite(Date.parse(scheduledAt)) ||
      !/[zZ]|[+-]\d{2}:\d{2}$/.test(scheduledAt)
    ) {
      throw new Error("reschedule requires --at with an ISO-8601 timestamp including Z or an offset");
    }
    body = { ...body, scheduled_at: scheduledAt };
  }
  const response = await client.request(endpoint, {
    method: "POST",
    body,
    revision,
    idempotencyKey: idempotencyKey(context.args)
  });
  printValue(unwrapData(response), outputOptions(context.args));
}

async function exportCommand(context: CommandContext): Promise<void> {
  const format = stringFlag(context.args, "format") ?? "json";
  if (format !== "json" && format !== "csv") throw new Error("--format must be json or csv");
  const scope = stringFlag(context.args, "scope") ?? "recovery";
  if (!["recovery", "schedule", "events"].includes(scope)) {
    throw new Error("--scope must be recovery, schedule, or events");
  }
  if (format === "csv" && scope === "recovery") {
    throw new Error("CSV does not preserve full recovery data; use --scope schedule|events or JSON recovery");
  }
  const client = await clientFor(context.args);
  const response = await client.request<unknown>(`/api/v1/export?format=${format}&scope=${scope}`);
  const data = unwrapData(response);
  const content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const output = stringFlag(context.args, "output");
  if (output) {
    await writeFile(resolve(output), `${content}${content.endsWith("\n") ? "" : "\n"}`, "utf8");
    printValue({ output: resolve(output), format, scope }, outputOptions(context.args));
  } else {
    process.stdout.write(`${content}${content.endsWith("\n") ? "" : "\n"}`);
  }
}

export async function runCommand(context: CommandContext): Promise<void> {
  const command = context.tokens[0];
  if (!command || command === "help" || booleanFlag(context.args, "help")) {
    process.stdout.write(HELP);
    return;
  }
  if (command === "auth") return await authCommand(context);
  if (command === "config") return await configCommand(context);
  if (["status", "list", "events", "accounts"].includes(command)) return await readCommand(context);
  if (command === "validate") return await validateCommand(context);
  if (command === "prepare") return await prepareCommand(context);
  if (command === "upload") return await uploadCommand(context);
  if (command === "storage-plan") return await storagePlanCommand(context);
  if (command === "bulk-upsert") return await bulkUpsertCommand(context);
  if (command === "sync") return await syncCommand(context);
  if (["pause", "resume", "publish-now", "cancel", "duplicate", "reschedule"].includes(command)) {
    return await mutationCommand(context);
  }
  if (command === "export") return await exportCommand(context);
  throw new Error(`Unknown command '${command}'. Run publisherctl help.`);
}

export const HELP = `publisherctl — operator and agent CLI for Social Publisher

Authentication and config:
  publisherctl auth login --api-url URL [--profile NAME] [--cf-access-client-id ID]
  publisherctl auth logout [--profile NAME]
  publisherctl config show|path
  publisherctl config set --api-url URL [--profile NAME]
  publisherctl config use NAME

Read operations:
  publisherctl status [--json]
  publisherctl list [--platform instagram|threads] [--state STATE] [--json]
  publisherctl accounts [--json]
  publisherctl events [--limit 100] [--json]

Media and manifests:
  publisherctl validate FILE --kind reel|video|image --platform instagram|threads
  publisherctl validate MANIFEST.json --manifest
  publisherctl prepare INPUT --output FILE --kind reel|video|image [--fit contain|cover]
  publisherctl upload FILE [--content-type TYPE] [--concurrency 1..4] [--ffprobe PATH] [--state RESUME.json]
  publisherctl upload resume --state RESUME.json [--concurrency 1..4]
  publisherctl upload abort --state RESUME.json
  publisherctl storage-plan FILE... [--recursive] [--json]
  publisherctl bulk-upsert MANIFEST.json [--apply] [--receipt-dir DIR]
  publisherctl sync MANIFEST.json [--apply] [--receipt-dir DIR]

Safe mutations (revision is mandatory):
  publisherctl pause ID --revision N
  publisherctl resume ID --revision N
  publisherctl reschedule ID --revision N --at ISO_TIMESTAMP
  publisherctl publish-now ID --revision N
  publisherctl cancel ID --revision N
  publisherctl duplicate ID --revision N
  publisherctl export --format json|csv --scope recovery|schedule|events [--output FILE]

Global options:
  --profile NAME  --json  --quiet  --idempotency-key KEY

Environment overrides:
  PUBLISHER_API_URL, PUBLISHER_API_TOKEN, PUBLISHER_PROFILE,
  PUBLISHER_HOME, PUBLISHER_CONFIG_PATH,
  CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET
`;
