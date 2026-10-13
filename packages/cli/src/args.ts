export type FlagValue = string | boolean | string[];

export interface ParsedArgs {
  readonly command: string[];
  readonly flags: Readonly<Record<string, FlagValue>>;
  readonly positionals: readonly string[];
}

const SHORT_FLAGS: Readonly<Record<string, string>> = {
  h: "help",
  j: "json",
  o: "output",
  p: "profile",
  q: "quiet",
  v: "verbose"
};

function addFlag(
  flags: Record<string, FlagValue>,
  key: string,
  value: string | boolean
): void {
  const current = flags[key];
  if (current === undefined) {
    flags[key] = value;
    return;
  }
  if (Array.isArray(current)) {
    if (typeof value === "string") current.push(value);
    return;
  }
  if (typeof current === "string" && typeof value === "string") {
    flags[key] = [current, value];
    return;
  }
  flags[key] = value;
}

export function parseArgs(argv: readonly string[], commandDepth = 2): ParsedArgs {
  const flags: Record<string, FlagValue> = {};
  const positionals: string[] = [];
  let passthrough = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (passthrough) {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      passthrough = true;
      continue;
    }
    if (token.startsWith("--no-") && token.length > 5) {
      addFlag(flags, token.slice(5), false);
      continue;
    }
    if (token.startsWith("--")) {
      const raw = token.slice(2);
      const equalsAt = raw.indexOf("=");
      if (equalsAt >= 0) {
        addFlag(flags, raw.slice(0, equalsAt), raw.slice(equalsAt + 1));
        continue;
      }
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("-")) {
        addFlag(flags, raw, next);
        index += 1;
      } else {
        addFlag(flags, raw, true);
      }
      continue;
    }
    if (token.startsWith("-") && token !== "-") {
      const short = token.slice(1);
      if (short.length > 1) {
        for (const character of short) {
          addFlag(flags, SHORT_FLAGS[character] ?? character, true);
        }
        continue;
      }
      const key = SHORT_FLAGS[short] ?? short;
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("-")) {
        addFlag(flags, key, next);
        index += 1;
      } else {
        addFlag(flags, key, true);
      }
      continue;
    }
    positionals.push(token);
  }

  return {
    command: positionals.slice(0, commandDepth),
    flags,
    positionals: positionals.slice(commandDepth)
  };
}

export function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  if (Array.isArray(value)) return value.at(-1);
  return typeof value === "string" ? value : undefined;
}

export function stringsFlag(args: ParsedArgs, name: string): readonly string[] {
  const value = args.flags[name];
  if (Array.isArray(value)) return value;
  return typeof value === "string" ? [value] : [];
}

export function booleanFlag(args: ParsedArgs, name: string): boolean {
  return args.flags[name] === true;
}

export function integerFlag(
  args: ParsedArgs,
  name: string,
  defaultValue: number
): number {
  const raw = stringFlag(args, name);
  if (raw === undefined) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`--${name} must be an integer`);
  }
  return parsed;
}
