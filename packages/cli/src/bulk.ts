import { createHash } from "node:crypto";
import type { ContentInput } from "./manifest.js";

export const BULK_CHUNK_SIZE = 25;

export interface BulkResult {
  readonly created: readonly unknown[];
  readonly updated: readonly unknown[];
  readonly unchanged: readonly unknown[];
  readonly conflicts: readonly unknown[];
  readonly errors: readonly unknown[];
}

export interface BulkChunkReport {
  readonly index: number;
  readonly item_count: number;
  readonly idempotency_key: string;
  readonly counts: {
    readonly created: number;
    readonly updated: number;
    readonly unchanged: number;
    readonly conflicts: number;
    readonly errors: number;
  };
}

export interface ChunkedBulkResult {
  readonly chunk_size: number;
  readonly chunks: readonly BulkChunkReport[];
  readonly result: BulkResult;
}

interface BulkClient {
  request(
    path: string,
    options: {
      method: "POST";
      body: unknown;
      idempotencyKey: string;
    }
  ): Promise<unknown>;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseBulkResult(response: unknown): BulkResult {
  const envelope = record(response);
  const data = record(envelope && "data" in envelope ? envelope.data : response);
  if (!data) throw new Error("Bulk API returned an invalid response");
  return {
    created: array(data.created),
    updated: array(data.updated),
    unchanged: array(data.unchanged),
    conflicts: array(data.conflicts),
    errors: array(data.errors)
  };
}

function chunkKey(
  seed: string,
  index: number,
  total: number,
  dryRun: boolean,
  overrideConflicts: boolean
): string {
  const digest = createHash("sha256")
    .update(`${seed}\0${dryRun ? "dry" : "apply"}\0${overrideConflicts ? "override" : "strict"}\0${index}\0${total}`)
    .digest("hex");
  return `bulk-${digest.slice(0, 48)}`;
}

export function bulkResultStatus(result: BulkResult): "complete" | "partial" {
  return result.conflicts.length > 0 || result.errors.length > 0 ? "partial" : "complete";
}

export function chunkContent(
  items: readonly ContentInput[],
  chunkSize = BULK_CHUNK_SIZE
): readonly (readonly ContentInput[])[] {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > BULK_CHUNK_SIZE) {
    throw new Error(`Bulk chunk size must be an integer from 1 to ${BULK_CHUNK_SIZE}`);
  }
  const chunks: ContentInput[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

export async function chunkedBulkUpsert(
  client: BulkClient,
  items: readonly ContentInput[],
  options: {
    readonly dryRun: boolean;
    readonly overrideConflicts: boolean;
    readonly idempotencySeed: string;
    readonly chunkSize?: number;
  }
): Promise<ChunkedBulkResult> {
  const chunks = chunkContent(items, options.chunkSize ?? BULK_CHUNK_SIZE);
  const aggregate: {
    created: unknown[];
    updated: unknown[];
    unchanged: unknown[];
    conflicts: unknown[];
    errors: unknown[];
  } = { created: [], updated: [], unchanged: [], conflicts: [], errors: [] };
  const reports: BulkChunkReport[] = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk) continue;
    const key = chunkKey(
      options.idempotencySeed,
      index,
      chunks.length,
      options.dryRun,
      options.overrideConflicts
    );
    const result = parseBulkResult(
      await client.request("/api/v1/content:bulk-upsert", {
        method: "POST",
        idempotencyKey: key,
        body: {
          items: chunk,
          dry_run: options.dryRun,
          override_conflicts: options.overrideConflicts
        }
      })
    );
    aggregate.created.push(...result.created);
    aggregate.updated.push(...result.updated);
    aggregate.unchanged.push(...result.unchanged);
    aggregate.conflicts.push(...result.conflicts);
    aggregate.errors.push(...result.errors);
    reports.push({
      index: index + 1,
      item_count: chunk.length,
      idempotency_key: key,
      counts: {
        created: result.created.length,
        updated: result.updated.length,
        unchanged: result.unchanged.length,
        conflicts: result.conflicts.length,
        errors: result.errors.length
      }
    });
  }

  return { chunk_size: options.chunkSize ?? BULK_CHUNK_SIZE, chunks: reports, result: aggregate };
}
