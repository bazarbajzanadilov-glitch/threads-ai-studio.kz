#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const environment = argument("--environment");
if (environment !== "test" && environment !== "production") {
  throw new Error("Usage: node scripts/assert-configured.mjs --environment test|production");
}

const root = resolve(import.meta.dirname, "..");
const [apiConfig, publicConfigText, corsConfigText, lifecycleConfigText] = await Promise.all([
  readFile(resolve(root, "workers/api/wrangler.toml"), "utf8"),
  readFile(resolve(root, "workers/public/wrangler.jsonc"), "utf8"),
  readFile(resolve(root, `infra/r2-cors.${environment}.json`), "utf8"),
  readFile(resolve(root, "infra/r2-lifecycle.json"), "utf8")
]);

const marker = `[env.${environment}]`;
const start = apiConfig.indexOf(marker);
if (start < 0) throw new Error(`API Wrangler config has no ${marker} section`);
const otherMarker = environment === "test" ? "[env.production]" : "[env.test]";
const other = apiConfig.indexOf(otherMarker, start + marker.length);
const apiEnvironment = apiConfig.slice(start, other < 0 ? undefined : other);
const publicConfig = JSON.parse(publicConfigText);
const corsConfig = JSON.parse(corsConfigText);
const lifecycleConfig = JSON.parse(lifecycleConfigText);
const publicEnvironment = publicConfig.env?.[environment];
if (!publicEnvironment) throw new Error(`Public Wrangler config has no env.${environment} section`);

const failures = [];
function rejectPlaceholder(label, value) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (!serialized || /REPLACE_ME|example\.invalid|\.example\.workers\.dev/i.test(serialized)) {
    failures.push(`${label} still contains a placeholder`);
  }
}

rejectPlaceholder("workers/api/wrangler.toml", apiEnvironment);
rejectPlaceholder("public vars", publicEnvironment.vars);
rejectPlaceholder(`infra/r2-cors.${environment}.json`, corsConfig);
for (const database of publicEnvironment.d1_databases ?? []) {
  rejectPlaceholder(`public D1 ${database.binding ?? "binding"}`, database.database_id);
}
const apiDatabaseId = apiEnvironment.match(/database_id\s*=\s*"([^"]+)"/)?.[1];
const apiPublicBaseUrl = apiEnvironment.match(/PUBLIC_BASE_URL\s*=\s*"([^"]+)"/)?.[1];
const apiDeclaredBucketName = apiEnvironment.match(/R2_BUCKET_NAME\s*=\s*"([^"]+)"/)?.[1];
const apiBucketName = apiEnvironment.match(/bucket_name\s*=\s*"([^"]+)"/)?.[1];
const publicDatabaseId = (publicEnvironment.d1_databases ?? [])
  .find((database) => database.binding === "DB")?.database_id;
if (!apiDatabaseId || !publicDatabaseId || apiDatabaseId !== publicDatabaseId) {
  failures.push("API and Public Workers must bind the same environment D1 database_id");
}
const expectedApiService = environment === "test" ? "social-publisher-api-test" : "social-publisher-api";
const expectedMediaBucket = `publisher-${environment}`;
const apiBinding = (publicEnvironment.services ?? []).find((entry) => entry.binding === "API");
if (apiBinding?.service !== expectedApiService) {
  failures.push(`public API service binding must target ${expectedApiService}`);
}
if (apiPublicBaseUrl !== publicEnvironment.vars?.PUBLIC_BASE_URL) {
  failures.push("API PUBLIC_BASE_URL must exactly match the Public Worker PUBLIC_BASE_URL used for OAuth callbacks");
}
if (apiBucketName !== expectedMediaBucket) {
  failures.push(`API media R2 binding must target ${expectedMediaBucket}`);
}
if (apiDeclaredBucketName !== expectedMediaBucket) {
  failures.push(`API R2_BUCKET_NAME must be ${expectedMediaBucket}`);
}
const expectedAdminOrigin = publicEnvironment.vars?.API_INTERNAL_BASE_URL;
const corsOrigins = corsConfig.rules?.flatMap((rule) => rule.allowed?.origins ?? []) ?? [];
if (!expectedAdminOrigin || !corsOrigins.includes(expectedAdminOrigin)) {
  failures.push(`R2 CORS must contain the exact admin/API origin ${expectedAdminOrigin ?? "(missing)"}`);
}
const exposesEtag = corsConfig.rules?.some((rule) =>
  (rule.exposeHeaders ?? []).some((header) => String(header).toLowerCase() === "etag")
);
if (!exposesEtag) failures.push("R2 CORS must expose ETag for multipart upload completion");
const unsafeCorsMethods = corsConfig.rules?.some((rule) => {
  const methods = rule.allowed?.methods ?? [];
  return methods.length !== 1 || methods[0] !== "PUT";
});
if (unsafeCorsMethods) failures.push("R2 CORS must allow only PUT; complete/abort stay on the same-origin API");
const requiredCorsHeaders = [
  "authorization",
  "content-type",
  "amz-sdk-invocation-id",
  "amz-sdk-request",
  "x-amz-*"
];
const missingCorsHeaders = requiredCorsHeaders.filter((required) =>
  !corsConfig.rules?.some((rule) =>
    (rule.allowed?.headers ?? []).some((header) => String(header).toLowerCase() === required)
  )
);
if (missingCorsHeaders.length > 0) {
  failures.push(`R2 CORS is missing browser multipart headers: ${missingCorsHeaders.join(", ")}`);
}
const abortAfterOneDay = lifecycleConfig.rules?.some(
  (rule) => rule.abortMultipartUploadsTransition?.condition?.type === "Age" &&
    rule.abortMultipartUploadsTransition?.condition?.maxAge === 86400
);
if (!abortAfterOneDay) failures.push("R2 lifecycle must abort incomplete multipart uploads after 86400 seconds");

if (failures.length > 0) {
  process.stderr.write(`${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Configuration for ${environment} has no known placeholders.\n`);
}
