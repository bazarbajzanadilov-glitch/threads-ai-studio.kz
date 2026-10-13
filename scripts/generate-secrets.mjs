#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import process from "node:process";

function secret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

const values = {
  INTERNAL_SHARED_SECRET: secret(),
  TOKEN_ENCRYPTION_KEY: secret(),
  DATA_DELETION_SECRET: secret()
};

process.stderr.write(
  "Generated locally. Do not commit, paste into tickets, or save in shell history. " +
    "INTERNAL_SHARED_SECRET must also be stored as public-worker INTERNAL_API_SECRET.\n"
);
process.stdout.write(`${JSON.stringify(values, null, 2)}\n`);
