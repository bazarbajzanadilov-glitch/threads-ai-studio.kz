import { describe, expect, it, vi } from "vitest";
import { bulkResultStatus, chunkContent, chunkedBulkUpsert } from "./bulk.js";
import type { ContentInput } from "./manifest.js";

function item(index: number): ContentInput {
  return {
    external_id: `item-${index}`,
    account_id: "account",
    platform: "threads",
    format: "text",
    text: `Text ${index}`
  };
}

describe("chunked bulk upsert", () => {
  it("splits manifests below the API maximum", () => {
    expect(chunkContent(Array.from({ length: 205 }, (_, index) => item(index))).map((chunk) => chunk.length))
      .toEqual([25, 25, 25, 25, 25, 25, 25, 25, 5]);
    expect(() => chunkContent([item(1)], 26)).toThrow(/1 to 25/);
  });

  it("chunks dry-runs, derives unique keys, and aggregates responses", async () => {
    const request = vi.fn(async (_path: string, options: { body: unknown }) => {
      const body = options.body as { items: ContentInput[]; dry_run: boolean };
      expect(body.dry_run).toBe(true);
      return {
        data: {
          created: body.items,
          updated: [],
          unchanged: [],
          conflicts: [],
          errors: []
        }
      };
    });
    const result = await chunkedBulkUpsert(
      { request },
      Array.from({ length: 205 }, (_, index) => item(index)),
      { dryRun: true, overrideConflicts: false, idempotencySeed: "stable-operation" }
    );
    expect(request).toHaveBeenCalledTimes(9);
    expect(result.result.created).toHaveLength(205);
    expect(result.chunks.map((chunk) => chunk.item_count)).toEqual([25, 25, 25, 25, 25, 25, 25, 25, 5]);
    expect(new Set(result.chunks.map((chunk) => chunk.idempotency_key)).size).toBe(9);
    expect(result.chunks.every((chunk) => chunk.idempotency_key.length < 64)).toBe(true);
  });

  it("does not reuse chunk keys between dry-run/apply/override bodies", async () => {
    const request = vi.fn(async (_path: string, options: { body: unknown }) => {
      const body = options.body as { items: ContentInput[] };
      return { data: { created: body.items, updated: [], unchanged: [], conflicts: [], errors: [] } };
    });
    const items = [item(1)];
    const dry = await chunkedBulkUpsert({ request }, items, {
      dryRun: true,
      overrideConflicts: false,
      idempotencySeed: "same-seed"
    });
    const apply = await chunkedBulkUpsert({ request }, items, {
      dryRun: false,
      overrideConflicts: false,
      idempotencySeed: "same-seed"
    });
    const override = await chunkedBulkUpsert({ request }, items, {
      dryRun: false,
      overrideConflicts: true,
      idempotencySeed: "same-seed"
    });
    expect(new Set([
      dry.chunks[0]?.idempotency_key,
      apply.chunks[0]?.idempotency_key,
      override.chunks[0]?.idempotency_key
    ]).size).toBe(3);
  });

  it("classifies conflict/error responses as partial", () => {
    expect(bulkResultStatus({ created: [], updated: [], unchanged: [], conflicts: [{}], errors: [] })).toBe("partial");
    expect(bulkResultStatus({ created: [], updated: [], unchanged: [], conflicts: [], errors: [] })).toBe("complete");
  });
});
