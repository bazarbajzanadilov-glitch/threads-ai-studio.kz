import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { ContentManifest } from "./manifest.js";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function utcFileStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(".", "");
}

export async function writeApplyReceipt(options: {
  readonly manifestPath: string;
  readonly manifest: ContentManifest;
  readonly operation: "bulk-upsert" | "sync";
  readonly status: "complete" | "partial";
  readonly result: unknown;
  readonly receiptDir?: string;
  readonly now?: Date;
}): Promise<{ path: string; sha256: string; manifest_sha256: string }> {
  const manifestPath = resolve(options.manifestPath);
  const directory = resolve(options.receiptDir ?? dirname(manifestPath));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const appliedAt = (options.now ?? new Date()).toISOString();
  const manifestJson = JSON.stringify(options.manifest);
  const manifestSha256 = sha256(manifestJson);
  const core = {
    version: 1,
    type: "publisher-apply-receipt",
    operation: options.operation,
    status: options.status,
    applied_at: appliedAt,
    source_manifest: manifestPath,
    manifest_sha256: manifestSha256,
    manifest: options.manifest,
    result: options.result
  } as const;
  const receiptSha256 = sha256(JSON.stringify(core));
  const document = `${JSON.stringify({ ...core, sha256: receiptSha256 }, null, 2)}\n`;
  const name = `${basename(manifestPath)}.publisher-applied-${utcFileStamp(new Date(appliedAt))}-${randomUUID().slice(0, 8)}.json`;
  const target = join(directory, name);
  const temporary = join(directory, `.${name}.${process.pid}.tmp`);
  await writeFile(temporary, document, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, target);
  await chmod(target, 0o444).catch(() => undefined);
  return { path: target, sha256: receiptSha256, manifest_sha256: manifestSha256 };
}
