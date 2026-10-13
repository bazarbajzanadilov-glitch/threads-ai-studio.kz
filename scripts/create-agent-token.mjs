#!/usr/bin/env node
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const environment = option("--environment", "test");
if (environment !== "test" && environment !== "production") {
  throw new Error("--environment must be test or production");
}
const name = option("--name", "publisherctl");
if (!name?.trim() || name.length > 80) throw new Error("--name must contain 1-80 non-whitespace characters");
const allowedScopes = new Set(["content:read", "content:write", "uploads:write"]);
const scopes = option("--scopes", [...allowedScopes].join(","))
  .split(",")
  .map((scope) => scope.trim())
  .filter(Boolean);
if (scopes.length === 0 || scopes.some((scope) => !allowedScopes.has(scope))) {
  throw new Error(`--scopes may contain only: ${[...allowedScopes].join(", ")}`);
}
const expiresInput = option("--expires", undefined);
const expiresAt = expiresInput ? new Date(expiresInput).toISOString() : null;
if (expiresAt && Date.parse(expiresAt) <= Date.now()) throw new Error("--expires must be in the future");
const token = `pub_${randomBytes(32).toString("base64url")}`;
const tokenHash = createHash("sha256").update(token).digest("hex");
const id = randomUUID();
const createdAt = new Date().toISOString();
const tokenInsert =
  "INSERT INTO agent_tokens (id, name, token_hash, scopes_json, expires_at, created_at) VALUES (" +
  [id, name.trim(), tokenHash, JSON.stringify(scopes), expiresAt, createdAt]
    .map((value) => (value === null ? "NULL" : sqlString(value)))
    .join(", ") +
  ");";
const auditInsert =
  "INSERT INTO events (level, kind, entity_type, entity_id, message, details_json, created_at) VALUES (" +
  [
    "warning",
    "agent_token.bootstrap_created",
    "agent_token",
    id,
    "Agent token created through the local break-glass bootstrap script",
    JSON.stringify({ name: name.trim(), scopes, environment, expires_at: expiresAt }),
    createdAt
  ].map(sqlString).join(", ") +
  ");";
const sql = `${tokenInsert}\n${auditInsert}`;

if (process.argv.includes("--apply")) {
  const expectedConfirmation = environment === "production" ? "publisher-production" : "publisher-test";
  if (option("--confirm", "") !== expectedConfirmation) {
    throw new Error(`Mutation requires --confirm ${expectedConfirmation}`);
  }
  const wranglerCli = resolve(import.meta.dirname, "../node_modules/wrangler/bin/wrangler.js");
  const database = environment === "test" ? "publisher-test" : "publisher-production";
  const result = spawnSync(
    process.execPath,
    [
      wranglerCli,
      "d1",
      "execute",
      database,
      "--env",
      environment,
      "--remote",
      "--config",
      "workers/api/wrangler.toml",
      "--command",
      sql
    ],
    { stdio: ["ignore", "inherit", "inherit"], windowsHide: true }
  );
  if (result.status !== 0) throw new Error("Wrangler could not insert the agent token");
  process.stderr.write("Agent token inserted. The plaintext below will not be recoverable from D1.\n");
} else {
  process.stderr.write("Dry run: nothing was inserted. Re-run with --apply after checking the target environment.\n");
}

process.stdout.write(
  `${JSON.stringify({ environment, id, name, scopes, expires_at: expiresAt, token, sql: process.argv.includes("--apply") ? undefined : sql }, null, 2)}\n`
);
