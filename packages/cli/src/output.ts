export interface OutputOptions {
  readonly json: boolean;
  readonly quiet: boolean;
}

function printable(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function printValue(value: unknown, options: OutputOptions): void {
  if (options.quiet) return;
  if (options.json || !Array.isArray(value)) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  printTable(value);
}

export function printTable(rows: readonly unknown[]): void {
  const records = rows.filter(
    (row): row is Record<string, unknown> => typeof row === "object" && row !== null && !Array.isArray(row)
  );
  if (records.length === 0) {
    process.stdout.write("No results.\n");
    return;
  }
  const keys = [...new Set(records.flatMap((row) => Object.keys(row)))];
  const widths = keys.map((key) =>
    Math.min(
      60,
      Math.max(key.length, ...records.map((row) => printable(row[key]).length))
    )
  );
  const formatRow = (row: Record<string, unknown>): string =>
    keys
      .map((key, index) => printable(row[key]).slice(0, widths[index] ?? 0).padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd();
  process.stdout.write(`${formatRow(Object.fromEntries(keys.map((key) => [key, key])))}\n`);
  process.stdout.write(`${widths.map((width) => "-".repeat(width)).join("  ")}\n`);
  for (const row of records) process.stdout.write(`${formatRow(row)}\n`);
}

export function unwrapData(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return "data" in record ? record.data : value;
}
