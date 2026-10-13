#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

const minimumNodeMajor = 22;
const failures = [];
const warnings = [];

function check(label, command, args, required = true) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  if (result.status === 0) {
    const version = (result.stdout || result.stderr).trim().split(/\r?\n/)[0] ?? "ok";
    process.stdout.write(`OK   ${label}: ${version}\n`);
    return;
  }
  const message = `${label} is unavailable`;
  (required ? failures : warnings).push(message);
  process.stdout.write(`${required ? "FAIL" : "WARN"} ${message}\n`);
}

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
if (nodeMajor < minimumNodeMajor) {
  failures.push(`Node.js ${minimumNodeMajor}+ is required; found ${process.versions.node}`);
  process.stdout.write(`FAIL Node.js ${minimumNodeMajor}+ is required; found ${process.versions.node}\n`);
} else {
  process.stdout.write(`OK   Node.js: ${process.versions.node}\n`);
}

if (process.platform === "win32") {
  check("npm", process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm --version"]);
} else {
  check("npm", "npm", ["--version"]);
}
check(
  "Wrangler (local dependency)",
  process.execPath,
  [resolve(import.meta.dirname, "../node_modules/wrangler/bin/wrangler.js"), "--version"]
);
check("FFmpeg", "ffmpeg", ["-version"], false);
check("FFprobe", "ffprobe", ["-version"], false);

if (warnings.length > 0) {
  process.stdout.write("\nFFmpeg/FFprobe are optional for deployment but required for prepare, validate, and upload.\n");
}
if (failures.length > 0) {
  process.stderr.write(`\nPrerequisite check failed (${failures.length}).\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("\nRequired prerequisites are ready.\n");
}
