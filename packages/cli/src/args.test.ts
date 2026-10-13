import { describe, expect, it } from "vitest";
import { booleanFlag, integerFlag, parseArgs, stringFlag, stringsFlag } from "./args.js";

describe("parseArgs", () => {
  it("keeps commands and positional arguments while parsing flags", () => {
    const result = parseArgs(
      ["reschedule", "post-1", "--revision", "3", "--at=2026-09-01T09:00:00+05:00", "--json"],
      0
    );
    expect(result.positionals).toEqual(["reschedule", "post-1"]);
    expect(stringFlag(result, "revision")).toBe("3");
    expect(stringFlag(result, "at")).toBe("2026-09-01T09:00:00+05:00");
    expect(booleanFlag(result, "json")).toBe(true);
  });

  it("supports repeated flags and negated flags", () => {
    const result = parseArgs(["list", "--state", "ready", "--state", "failed", "--no-store"], 0);
    expect(stringsFlag(result, "state")).toEqual(["ready", "failed"]);
    expect(result.flags.store).toBe(false);
  });

  it("does not silently truncate malformed integer flags", () => {
    expect(integerFlag(parseArgs(["--concurrency", "4"], 0), "concurrency", 3)).toBe(4);
    expect(() => integerFlag(parseArgs(["--concurrency=4.5"], 0), "concurrency", 3)).toThrow(/integer/);
    expect(() => integerFlag(parseArgs(["--concurrency=4parts"], 0), "concurrency", 3)).toThrow(/integer/);
  });
});
