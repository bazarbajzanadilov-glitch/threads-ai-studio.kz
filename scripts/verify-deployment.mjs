#!/usr/bin/env node
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function normalizedUrl(value, label) {
  if (!value) throw new Error(`${label} is required`);
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS`);
  return url.toString().replace(/\/$/, "");
}

async function request(url, init = {}) {
  return await globalThis.fetch(url, {
    ...init,
    signal: globalThis.AbortSignal.timeout(15_000),
    redirect: "error"
  });
}

const publicUrl = normalizedUrl(option("--public-url", process.env.PUBLIC_URL), "--public-url");
const apiValue = option("--api-url", process.env.PUBLISHER_API_URL);
const apiUrl = apiValue ? normalizedUrl(apiValue, "--api-url") : undefined;
const waitSeconds = Number.parseInt(option("--wait-seconds", "0"), 10);
if (!Number.isSafeInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > 600) {
  throw new Error("--wait-seconds must be an integer from 0 to 600");
}

const privacy = await request(`${publicUrl}/privacy`);
if (!privacy.ok || !(await privacy.text()).toLowerCase().includes("privacy")) {
  throw new Error(`Privacy endpoint failed with HTTP ${privacy.status}`);
}
process.stdout.write("OK public privacy endpoint\n");

const deadline = Date.now() + waitSeconds * 1000;
async function waitForHealth() {
  let lastStatus;
  let lastPayload;
  const attempts = Math.max(1, Math.ceil(waitSeconds / 15) + 1);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const health = await request(`${publicUrl}/health`);
    lastStatus = health.status;
    lastPayload = await health.json().catch(() => ({}));
    if (health.ok && lastPayload?.status === "ok") return lastPayload;
    if (Date.now() >= deadline) break;
    await delay(15_000);
  }
  throw new Error(`Health endpoint is not ready (HTTP ${String(lastStatus)}): ${JSON.stringify(lastPayload)}`);
}
const healthPayload = await waitForHealth();
process.stdout.write(`OK public health endpoint (${JSON.stringify(healthPayload.checks)})\n`);

if (apiUrl) {
  const token = option("--api-token", process.env.PUBLISHER_API_TOKEN);
  if (!token) throw new Error("PUBLISHER_API_TOKEN or --api-token is required when --api-url is used");
  const clientId = option("--cf-access-client-id", process.env.CF_ACCESS_CLIENT_ID);
  const clientSecret = option("--cf-access-client-secret", process.env.CF_ACCESS_CLIENT_SECRET);
  if (Boolean(clientId) !== Boolean(clientSecret)) throw new Error("Both Cloudflare Access service-token values are required");
  const headers = new globalThis.Headers({ Accept: "application/json", Authorization: `Bearer ${token}` });
  if (clientId && clientSecret) {
    headers.set("CF-Access-Client-Id", clientId);
    headers.set("CF-Access-Client-Secret", clientSecret);
  }
  const response = await request(`${apiUrl}/api/v1/system/status`, { headers });
  if (!response.ok) throw new Error(`Protected API status failed with HTTP ${response.status}`);
  process.stdout.write("OK protected API status endpoint\n");
}
