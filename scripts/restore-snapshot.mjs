#!/usr/bin/env node
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import process from "node:process";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function flag(name) {
  return process.argv.includes(name);
}

function requiredString(value, context) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${context} is missing`);
  return value;
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Snapshot contains a non-finite number");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `'${text.replaceAll("'", "''")}'`;
}

function insert(table, columns, value) {
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((column) => sqlValue(value[column])).join(", ")});`;
}

function parseSnapshot(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) throw new Error("Snapshot is empty");
  const records = lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSON on snapshot line ${index + 1}: ${error.message}`, { cause: error });
    }
  });
  const manifest = records[0];
  if (manifest?.type !== "manifest" || manifest.version !== 1 || typeof manifest.created_at !== "string") {
    throw new Error("Snapshot must start with a version 1 manifest record");
  }
  const grouped = { content: [], media: [], content_media: [], account: [] };
  for (const [index, record] of records.slice(1).entries()) {
    if (!record || !Object.hasOwn(grouped, record.type) || !record.value || typeof record.value !== "object") {
      throw new Error(`Unsupported record on snapshot line ${index + 2}`);
    }
    grouped[record.type].push(record.value);
  }
  for (const account of grouped.account) {
    for (const forbidden of ["access_token", "access_token_encrypted", "refresh_token", "refresh_token_encrypted", "app_secret"]) {
      if (forbidden in account) throw new Error(`Snapshot unexpectedly contains secret field '${forbidden}'`);
    }
  }
  const contentIds = new Set();
  const accountIds = new Set();
  for (const row of grouped.account) {
    const id = requiredString(row.id, "account.id");
    if (accountIds.has(id)) throw new Error(`Duplicate account id ${id}`);
    accountIds.add(id);
  }
  for (const row of grouped.content) {
    const id = requiredString(row.id, "content.id");
    if (contentIds.has(id)) throw new Error(`Duplicate content id ${id}`);
    if (!accountIds.has(row.account_id)) throw new Error(`Broken content account reference ${String(row.account_id)}`);
    contentIds.add(id);
  }
  const mediaIds = new Set();
  for (const row of grouped.media) {
    const id = requiredString(row.id, "media.id");
    if (mediaIds.has(id)) throw new Error(`Duplicate media id ${id}`);
    mediaIds.add(id);
  }
  for (const link of grouped.content_media) {
    if (!contentIds.has(link.content_id) || !mediaIds.has(link.media_id)) {
      throw new Error(`Broken content_media reference ${String(link.content_id)} -> ${String(link.media_id)}`);
    }
  }
  const recordCount = grouped.content.length + grouped.media.length + grouped.content_media.length + grouped.account.length;
  if (manifest.record_count !== undefined &&
      (!Number.isSafeInteger(manifest.record_count) || manifest.record_count < 0 || manifest.record_count !== recordCount)) {
    throw new Error(`Snapshot manifest record_count does not match the ${recordCount} parsed records`);
  }
  return { manifest, ...grouped, line_count: lines.length };
}

function inside(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function regularFile(path, context) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${context} must be a regular, non-symlink file`);
}

async function materializeShardedSnapshot(manifestText) {
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    throw new Error(`Invalid sharded snapshot manifest JSON: ${error.message}`, { cause: error });
  }
  if (manifest?.type !== "publisher-sharded-snapshot" || manifest.version !== 2 ||
      typeof manifest.created_at !== "string" || !Number.isFinite(Date.parse(manifest.created_at)) ||
      typeof manifest.target_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(manifest.target_date) ||
      !Number.isSafeInteger(manifest.privacy_epoch) || manifest.privacy_epoch < 0 ||
      !Number.isSafeInteger(manifest.record_count) || manifest.record_count < 0 ||
      !Number.isSafeInteger(manifest.shard_bytes) || manifest.shard_bytes < 0 || !Array.isArray(manifest.shards)) {
    throw new Error("Unsupported or malformed sharded snapshot manifest");
  }
  const shardsArg = option("--shards-dir", undefined);
  if (!shardsArg) throw new Error("Version 2 manifests require --shards-dir DIR containing every referenced shard");
  const shardsRoot = resolve(shardsArg);
  const rootInfo = await lstat(shardsRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("--shards-dir must be a regular, non-symlink directory");
  }
  const realShardsRoot = await realpath(shardsRoot);

  const tables = new Map([["content", 0], ["media", 1], ["content_media", 2], ["account", 3]]);
  const keys = new Set();
  const bodies = [];
  let previousTable = 0;
  let totalBytes = 0;
  let totalRecords = 0;
  for (const [index, shard] of manifest.shards.entries()) {
    if (!shard || typeof shard !== "object" || shard.shard_index !== index || !tables.has(shard.table) ||
        typeof shard.key !== "string" || !/^snapshots\/staging\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+\.jsonl$/.test(shard.key) ||
        typeof shard.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(shard.sha256) ||
        !Number.isSafeInteger(shard.size_bytes) || shard.size_bytes <= 0 ||
        !Number.isSafeInteger(shard.record_count) || shard.record_count < 1 || shard.record_count > 50) {
      throw new Error(`Malformed shard descriptor at index ${index}`);
    }
    if (keys.has(shard.key)) throw new Error(`Duplicate shard key ${shard.key}`);
    keys.add(shard.key);
    const tableOrder = tables.get(shard.table);
    if (tableOrder < previousTable) throw new Error(`Shard ${index} is out of table order`);
    previousTable = tableOrder;

    const hierarchical = resolve(shardsRoot, ...shard.key.split("/"));
    if (!inside(shardsRoot, hierarchical)) throw new Error(`Shard key escapes --shards-dir: ${shard.key}`);
    const flat = resolve(shardsRoot, basename(shard.key));
    let shardPath = hierarchical;
    try {
      await regularFile(shardPath, `Shard ${shard.key}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      shardPath = flat;
      await regularFile(shardPath, `Shard ${shard.key}`);
    }
    const realShardPath = await realpath(shardPath);
    if (!inside(realShardsRoot, realShardPath)) throw new Error(`Shard resolves outside --shards-dir: ${shard.key}`);
    const body = await readFile(shardPath, "utf8");
    const bytes = Buffer.byteLength(body, "utf8");
    const digest = createHash("sha256").update(body).digest("hex");
    if (bytes !== shard.size_bytes) throw new Error(`Shard ${shard.key} size does not match its manifest`);
    if (digest !== shard.sha256) throw new Error(`Shard ${shard.key} SHA-256 does not match its manifest`);
    const records = body.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (records.length !== shard.record_count) throw new Error(`Shard ${shard.key} record count does not match its manifest`);
    for (const [lineIndex, line] of records.entries()) {
      let record;
      try {
        record = JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSON in shard ${shard.key} line ${lineIndex + 1}: ${error.message}`, { cause: error });
      }
      if (record?.type !== shard.table || !record.value || typeof record.value !== "object") {
        throw new Error(`Shard ${shard.key} contains a record for the wrong table`);
      }
    }
    bodies.push(body.endsWith("\n") ? body : `${body}\n`);
    totalBytes += bytes;
    totalRecords += records.length;
  }
  if (totalBytes !== manifest.shard_bytes) throw new Error("Manifest shard_bytes does not match downloaded shards");
  if (totalRecords !== manifest.record_count) throw new Error("Manifest record_count does not match downloaded shards");
  return `${JSON.stringify({
    type: "manifest", version: 1, created_at: manifest.created_at, record_count: manifest.record_count
  })}\n${bodies.join("")}`;
}

const MEDIA_COLUMNS = [
  "id", "file_name", "mime_type", "size_bytes", "sha256", "width", "height", "duration_ms", "fps",
  "video_codec", "audio_codec", "video_bitrate_bps", "audio_bitrate_bps", "audio_sample_rate_hz",
  "drive_ref", "r2_key", "status", "validation_error", "revision",
  "delete_after", "created_at", "updated_at"
];
const ACCOUNT_COLUMNS = [
  "id", "platform", "platform_user_id", "username", "access_token_encrypted", "refresh_token_encrypted",
  "token_expires_at", "scopes_json", "status", "last_error", "created_at", "updated_at"
];
const CONTENT_COLUMNS = [
  "id", "external_id", "account_id", "platform", "format", "scheduled_at", "text", "topic_tag", "location_id",
  "share_to_feed", "late_policy", "late_window_minutes", "enabled", "revision", "state", "resume_state",
  "next_attempt_at", "lease_token", "lease_expires_at", "container_id", "container_children_json",
  "platform_media_id", "permalink",
  "last_error", "published_at", "created_at", "updated_at"
];
const LINK_COLUMNS = ["content_id", "media_id", "position", "alt_text"];

function smokeSql(snapshot) {
  const lines = ["PRAGMA foreign_keys = ON;"];
  for (const source of snapshot.account) {
    lines.push(insert("platform_accounts", ACCOUNT_COLUMNS, {
      ...source,
      // Keep the stable account id/platform identity so a later OAuth upsert
      // reactivates this exact row and all restored content bindings remain
      // valid. Snapshots intentionally never contain a usable Meta token.
      access_token_encrypted: "",
      refresh_token_encrypted: null,
      token_expires_at: null,
      scopes_json: source.scopes_json ?? "[]",
      status: "revoked",
      last_error: "Recovery smoke import: reconnect this account through OAuth"
    }));
  }
  for (const source of snapshot.media) {
    lines.push(insert("media_assets", MEDIA_COLUMNS, {
      ...source,
      status: "invalid",
      validation_error: "Recovery smoke: R2 object presence was not verified",
      delete_after: null
    }));
  }
  for (const source of snapshot.content) {
    const alreadyPublished = source.state === "published";
    lines.push(insert("content_items", CONTENT_COLUMNS, {
      ...source,
      enabled: 0,
      state: alreadyPublished ? "published" : "paused",
      resume_state: null,
      next_attempt_at: null,
      lease_token: null,
      lease_expires_at: null,
      container_id: null,
      container_children_json: null,
      platform_media_id: alreadyPublished ? source.platform_media_id ?? null : null,
      permalink: alreadyPublished ? source.permalink ?? null : null,
      published_at: alreadyPublished ? source.published_at ?? null : null,
      last_error: alreadyPublished
        ? "Recovery smoke import: published identity preserved; this row cannot be resumed"
        : "Recovery smoke import: disabled and paused; reconcile before use"
    }));
  }
  for (const source of snapshot.content_media) lines.push(insert("content_media", LINK_COLUMNS, source));
  return `${lines.join("\n")}\n`;
}

function runWrangler(args, capture = false) {
  const wranglerCli = resolve(import.meta.dirname, "../node_modules/wrangler/bin/wrangler.js");
  const result = spawnSync(process.execPath, [wranglerCli, ...args], {
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(`Wrangler failed: wrangler ${args.join(" ")}`);
  return capture ? result.stdout : "";
}

function firstD1Row(output) {
  const rows = d1Rows(output);
  const row = rows[0];
  if (!row || typeof row !== "object") throw new Error("Could not parse Wrangler D1 JSON output");
  return row;
}

function d1Rows(output) {
  const payload = JSON.parse(output);
  const page = Array.isArray(payload) ? payload[0] : payload;
  if (!Array.isArray(page?.results)) throw new Error("Could not parse Wrangler D1 JSON output");
  return page.results;
}

async function runRecoverySafetySelfTest() {
  const db = new DatabaseSync(":memory:");
  try {
    for (const name of [
      "0001_initial.sql", "0002_carousel_children.sql", "0003_cron_wall_duration.sql",
      "0004_publish_attempt_generation.sql", "0005_storage_privacy.sql", "0006_snapshot_jobs.sql",
      "0007_account_deletion_state.sql", "0008_media_metadata.sql", "0009_media_gc_claims.sql"
    ]) db.exec(await readFile(resolve(import.meta.dirname, `../migrations/${name}`), "utf8"));
    const base = {
      external_id: "external", account_id: "account-1", platform: "instagram", format: "image",
      scheduled_at: "2026-08-25T12:00:00.000Z", text: "caption", topic_tag: null, location_id: null,
      share_to_feed: 1, late_policy: "publish_within_window", late_window_minutes: 240,
      enabled: 1, revision: 1, resume_state: null, next_attempt_at: null, lease_token: "stale-lease",
      lease_expires_at: "2026-08-25T12:10:00.000Z", container_id: "stale-container",
      container_children_json: "[]", last_error: null,
      created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z"
    };
    const snapshot = {
      account: [{
        id: "account-1", platform: "instagram", platform_user_id: "meta-user", username: "owner",
        token_expires_at: null, scopes_json: "[]", status: "active", last_error: null,
        created_at: base.created_at, updated_at: base.updated_at
      }],
      media: [], content_media: [],
      content: [
        {
          ...base, id: "published", external_id: "published-external", state: "published", platform_media_id: "remote-published",
          permalink: "https://www.instagram.com/p/published/", published_at: "2026-08-25T12:01:00.000Z"
        },
        {
          ...base, id: "scheduled", external_id: "scheduled-external", state: "scheduled", platform_media_id: "unsafe-remote-id",
          permalink: "https://www.instagram.com/p/unsafe/", published_at: "2026-08-25T12:01:00.000Z"
        }
      ]
    };
    db.exec(smokeSql(snapshot));
    const rows = db.prepare(
      `SELECT id, state, enabled, resume_state, lease_token, container_id,
              platform_media_id, permalink, published_at
         FROM content_items ORDER BY id`
    ).all();
    const published = rows.find((row) => row.id === "published");
    const scheduled = rows.find((row) => row.id === "scheduled");
    if (!published || published.state !== "published" || Number(published.enabled) !== 0 ||
        published.resume_state !== null || published.lease_token !== null || published.container_id !== null ||
        published.platform_media_id !== "remote-published" ||
        published.permalink !== "https://www.instagram.com/p/published/" ||
        published.published_at !== "2026-08-25T12:01:00.000Z") {
      throw new Error(`Published recovery invariant failed: ${JSON.stringify(published)}`);
    }
    if (!scheduled || scheduled.state !== "paused" || Number(scheduled.enabled) !== 0 ||
        scheduled.resume_state !== null || scheduled.lease_token !== null || scheduled.container_id !== null ||
        scheduled.platform_media_id !== null || scheduled.permalink !== null || scheduled.published_at !== null) {
      throw new Error(`Non-published recovery invariant failed: ${JSON.stringify(scheduled)}`);
    }
    process.stdout.write(`${JSON.stringify({ self_test: "passed", published_identity_preserved: 1, nonpublished_paused: 1 })}\n`);
  } finally {
    db.close();
  }
}

if (flag("--self-test")) {
  await runRecoverySafetySelfTest();
  process.exit(0);
}

const snapshotArg = process.argv[2];
if (!snapshotArg || snapshotArg.startsWith("--")) {
  throw new Error("Usage: node scripts/restore-snapshot.mjs SNAPSHOT.{jsonl,manifest.json} [--shards-dir DIR] [--expected-sha256 HEX] [--apply --remote --database NAME --confirm NAME]");
}
const snapshotPath = resolve(snapshotArg);
const info = await lstat(snapshotPath);
if (!info.isFile() || info.isSymbolicLink()) throw new Error("Snapshot must be a regular, non-symlink file");
const text = await readFile(snapshotPath, "utf8");
const digest = createHash("sha256").update(text).digest("hex");
const expectedDigest = option("--expected-sha256", undefined);
if (expectedDigest && expectedDigest.toLowerCase() !== digest) throw new Error("Snapshot SHA-256 does not match --expected-sha256");
const snapshotInput = text.trimStart().startsWith("{") && (() => {
  try {
    const candidate = JSON.parse(text);
    return candidate?.type === "publisher-sharded-snapshot" && candidate.version === 2;
  } catch {
    return false;
  }
})() ? await materializeShardedSnapshot(text) : text;
const snapshot = parseSnapshot(snapshotInput);
const publishedCount = snapshot.content.filter((item) => item.state === "published").length;
const nonPublishedCount = snapshot.content.length - publishedCount;
const summary = {
  file: snapshotPath,
  sha256: digest,
  created_at: snapshot.manifest.created_at,
  records: {
    content: snapshot.content.length,
    media: snapshot.media.length,
    content_media: snapshot.content_media.length,
    accounts_requiring_oauth: snapshot.account.length,
    published_identity_preserved: publishedCount,
    nonpublished_paused: nonPublishedCount
  },
  safety: "Published rows stay disabled/published with remote identity preserved; all other rows are disabled/paused with remote identity cleared. Media remains invalid until R2 objects are verified."
};

const apply = flag("--apply");
const remote = flag("--remote");
if (!apply && !remote) {
  process.stdout.write(`${JSON.stringify({ mode: "dry-run", ...summary }, null, 2)}\n`);
  process.exit(0);
}
if (!apply || !remote) throw new Error("Remote mutation requires BOTH --apply and --remote");
const environment = option("--environment", "test");
if (environment !== "test") throw new Error("Snapshot smoke restore is hard-blocked outside the test environment");
const database = option("--database", "publisher-test");
if (!/^publisher-(?:test|recovery-[a-z0-9-]+)$/.test(database)) {
  throw new Error("--database must be publisher-test or start with publisher-recovery-");
}
if (option("--confirm", "") !== database) throw new Error(`Add --confirm ${database} to acknowledge the exact clean test D1 target`);

const configArgs = ["--env", "test", "--remote", "--config", "workers/api/wrangler.toml"];
const cleanRow = firstD1Row(runWrangler([
  "d1", "execute", database, ...configArgs, "--json", "--command",
  "SELECT (SELECT COUNT(*) FROM content_items) AS content_count, (SELECT COUNT(*) FROM media_assets) AS media_count, (SELECT COUNT(*) FROM content_media) AS link_count, (SELECT COUNT(*) FROM platform_accounts) AS account_count;"
], true));
if (["content_count", "media_count", "link_count", "account_count"].some((key) => Number(cleanRow[key]) !== 0)) {
  throw new Error(`Target D1 is not clean: ${JSON.stringify(cleanRow)}`);
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "publisher-recovery-"));
const sqlPath = join(temporaryDirectory, "smoke-import.sql");
try {
  await writeFile(sqlPath, smokeSql(snapshot), { encoding: "utf8", mode: 0o600, flag: "wx" });
  runWrangler(["d1", "execute", database, ...configArgs, "--yes", "--file", sqlPath]);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

const restored = firstD1Row(runWrangler([
  "d1", "execute", database, ...configArgs, "--json", "--command",
  `SELECT
     (SELECT COUNT(*) FROM content_items) AS content_count,
     (SELECT COUNT(*) FROM content_items WHERE enabled = 0 AND state = 'paused') AS safely_paused,
     (SELECT COUNT(*) FROM content_items WHERE enabled = 0) AS safely_disabled,
     (SELECT COUNT(*) FROM content_items WHERE enabled = 0 AND state = 'published' AND resume_state IS NULL) AS preserved_published,
     (SELECT COUNT(*) FROM content_items WHERE container_id IS NULL AND container_children_json IS NULL) AS cleared_containers,
     (SELECT COUNT(*) FROM content_items WHERE state = 'paused' AND platform_media_id IS NULL AND permalink IS NULL AND published_at IS NULL) AS cleared_nonpublished_remote,
     (SELECT COUNT(*) FROM media_assets) AS media_count,
     (SELECT COUNT(*) FROM media_assets WHERE status = 'invalid') AS safely_invalid_media,
     (SELECT COUNT(*) FROM content_media) AS link_count,
     (SELECT COUNT(*) FROM platform_accounts) AS account_count,
     (SELECT COUNT(*) FROM platform_accounts WHERE status = 'revoked' AND access_token_encrypted = '') AS reconnect_required_accounts;`
], true));
if (
  Number(restored.content_count) !== snapshot.content.length ||
  Number(restored.safely_paused ?? 0) !== nonPublishedCount ||
  Number(restored.safely_disabled ?? 0) !== snapshot.content.length ||
  Number(restored.preserved_published ?? 0) !== publishedCount ||
  Number(restored.cleared_containers ?? 0) !== snapshot.content.length ||
  Number(restored.cleared_nonpublished_remote ?? 0) !== nonPublishedCount ||
  Number(restored.media_count) !== snapshot.media.length ||
  Number(restored.safely_invalid_media ?? 0) !== snapshot.media.length ||
  Number(restored.link_count) !== snapshot.content_media.length ||
  Number(restored.account_count) !== snapshot.account.length ||
  Number(restored.reconnect_required_accounts ?? 0) !== snapshot.account.length
) {
  throw new Error(`Post-import smoke check failed: ${JSON.stringify(restored)}`);
}
const restoredIdentities = d1Rows(runWrangler([
  "d1", "execute", database, ...configArgs, "--json", "--command",
  `SELECT id, state, enabled, resume_state, container_id, container_children_json,
          platform_media_id, permalink, published_at
     FROM content_items ORDER BY id;`
], true));
const sourceById = new Map(snapshot.content.map((item) => [item.id, item]));
if (restoredIdentities.length !== snapshot.content.length) {
  throw new Error("Post-import identity check returned the wrong number of content rows");
}
for (const row of restoredIdentities) {
  const source = sourceById.get(row.id);
  if (!source) throw new Error(`Post-import identity check found unexpected content ${String(row.id)}`);
  const published = source.state === "published";
  const safeBase = Number(row.enabled) === 0 && row.resume_state === null &&
    row.container_id === null && row.container_children_json === null;
  const samePublishedIdentity = row.platform_media_id === (source.platform_media_id ?? null) &&
    row.permalink === (source.permalink ?? null) && row.published_at === (source.published_at ?? null);
  const clearedRemoteIdentity = row.platform_media_id === null && row.permalink === null && row.published_at === null;
  if (!safeBase || (published
    ? row.state !== "published" || !samePublishedIdentity
    : row.state !== "paused" || !clearedRemoteIdentity)) {
    throw new Error(`Post-import state/identity safety check failed for content ${String(row.id)}`);
  }
}
process.stdout.write(`${JSON.stringify({
  mode: "applied-to-clean-test", database, ...summary,
  verification: { ...restored, identity_rows_checked: restoredIdentities.length }
}, null, 2)}\n`);
