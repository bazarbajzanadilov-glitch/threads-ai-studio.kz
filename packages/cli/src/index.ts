#!/usr/bin/env node
import { parseArgs } from "./args.js";
import { runCommand } from "./commands.js";
import { ApiError } from "./http.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), 0);
  await runCommand({ args, tokens: args.positionals });
}

main().catch((error: unknown) => {
  if (error instanceof ApiError) {
    const suffix = [error.code, error.requestId ? `request ${error.requestId}` : undefined]
      .filter(Boolean)
      .join(", ");
    process.stderr.write(`API error ${error.status}${suffix ? ` (${suffix})` : ""}: ${error.message}\n`);
    if (error.details !== undefined) process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
    process.exitCode = error.status === 409 ? 4 : 1;
    return;
  }
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
