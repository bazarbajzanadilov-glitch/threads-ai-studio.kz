import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeApplyReceipt } from "./receipt.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("apply receipt", () => {
  it("atomically records the full manifest, result, and hashes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "publisher-receipt-"));
    directories.push(directory);
    const manifest = {
      version: 1 as const,
      items: [
        {
          external_id: "thread-1",
          account_id: "account",
          platform: "threads" as const,
          format: "text" as const,
          text: "Hello"
        }
      ]
    };
    const receipt = await writeApplyReceipt({
      manifestPath: join(directory, "manifest.json"),
      manifest,
      operation: "sync",
      status: "complete",
      result: { created: 1 },
      now: new Date("2026-08-25T15:30:00.000Z")
    });
    const body = JSON.parse(await readFile(receipt.path, "utf8"));
    expect(receipt.path).toContain("manifest.json.publisher-applied-20260825T153000000Z-");
    expect(body.manifest).toEqual(manifest);
    expect(body.result).toEqual({ created: 1 });
    expect(body.status).toBe("complete");
    expect(body.sha256).toBe(receipt.sha256);
    expect(body.manifest_sha256).toBe(receipt.manifest_sha256);
  });

  it("preserves a partial outcome for recovery after chunk conflicts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "publisher-receipt-partial-"));
    directories.push(directory);
    const manifest = {
      version: 1 as const,
      items: [
        {
          external_id: "thread-conflict",
          account_id: "account",
          platform: "threads" as const,
          format: "text" as const,
          text: "Hello"
        }
      ]
    };
    const result = { conflicts: [{ external_id: "thread-conflict", reason: "revision" }], errors: [] };
    const receipt = await writeApplyReceipt({
      manifestPath: join(directory, "manifest.json"),
      manifest,
      operation: "bulk-upsert",
      status: "partial",
      result,
      now: new Date("2026-08-25T15:31:00.000Z")
    });
    const body = JSON.parse(await readFile(receipt.path, "utf8"));
    expect(body.status).toBe("partial");
    expect(body.result).toEqual(result);
  });
});
