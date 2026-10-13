import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const BYTES_PER_GB = 1_000_000_000;
const FREE_BYTES = 10 * BYTES_PER_GB;
const STORAGE_USD_PER_BILLED_GB_MONTH = 0.015;

export interface StorageEntry {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function collectPath(path: string, recursive: boolean, output: string[]): Promise<void> {
  const absolute = resolve(path);
  const info = await lstat(absolute);
  if (info.isSymbolicLink()) throw new Error(`Symbolic links are not followed: ${absolute}`);
  if (info.isFile()) {
    output.push(absolute);
    return;
  }
  if (!info.isDirectory()) throw new Error(`Not a regular file or directory: ${absolute}`);
  if (!recursive) throw new Error(`Directory input requires explicit --recursive: ${absolute}`);
  const entries = await readdir(absolute, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not followed: ${resolve(absolute, entry.name)}`);
    await collectPath(resolve(absolute, entry.name), true, output);
  }
}

export function summarizeStorage(entries: readonly StorageEntry[]): {
  input_files: number;
  unique_objects: number;
  duplicate_files: number;
  total_input_bytes: number;
  unique_bytes: number;
  free_tier_bytes: number;
  remaining_free_bytes: number;
  overage_bytes: number;
  extra_gb: number;
  billed_gb: number;
  projected_usd: number;
  assumptions: {
    free_gb_month: number;
    usd_per_billed_gb_month: number;
    storage_class: "R2 Standard";
    duration: "constant volume for one month";
    billing_rounding: "ceil extra GB";
    scope: "provided unique digests only; excludes existing bucket usage";
  };
  objects: readonly StorageEntry[];
} {
  const unique = new Map<string, StorageEntry>();
  for (const entry of entries) unique.set(`${entry.sha256}:${entry.bytes}`, unique.get(`${entry.sha256}:${entry.bytes}`) ?? entry);
  const objects = [...unique.values()];
  const totalInputBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const uniqueBytes = objects.reduce((sum, entry) => sum + entry.bytes, 0);
  const overageBytes = Math.max(0, uniqueBytes - FREE_BYTES);
  const extraGb = overageBytes / BYTES_PER_GB;
  const billedGb = Math.ceil(extraGb);
  return {
    input_files: entries.length,
    unique_objects: objects.length,
    duplicate_files: entries.length - objects.length,
    total_input_bytes: totalInputBytes,
    unique_bytes: uniqueBytes,
    free_tier_bytes: FREE_BYTES,
    remaining_free_bytes: Math.max(0, FREE_BYTES - uniqueBytes),
    overage_bytes: overageBytes,
    extra_gb: extraGb,
    billed_gb: billedGb,
    projected_usd: Number((billedGb * STORAGE_USD_PER_BILLED_GB_MONTH).toFixed(3)),
    assumptions: {
      free_gb_month: 10,
      usd_per_billed_gb_month: STORAGE_USD_PER_BILLED_GB_MONTH,
      storage_class: "R2 Standard",
      duration: "constant volume for one month",
      billing_rounding: "ceil extra GB",
      scope: "provided unique digests only; excludes existing bucket usage"
    },
    objects
  };
}

export async function storagePlan(inputs: readonly string[], recursive: boolean): Promise<ReturnType<typeof summarizeStorage>> {
  if (inputs.length === 0) throw new Error("storage-plan requires at least one file or directory");
  const paths: string[] = [];
  for (const input of inputs) await collectPath(input, recursive, paths);
  const distinctPaths = [...new Set(paths)].sort();
  const entries: StorageEntry[] = [];
  for (const path of distinctPaths) {
    const info = await lstat(path);
    entries.push({ path, bytes: info.size, sha256: await hashFile(path) });
  }
  return summarizeStorage(entries);
}
