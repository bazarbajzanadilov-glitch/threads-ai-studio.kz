import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface ProfileConfig {
  readonly apiUrl: string;
  readonly token?: string;
  readonly cfAccessClientId?: string;
  readonly cfAccessClientSecret?: string;
}

export interface CliConfig {
  readonly currentProfile: string;
  readonly profiles: Readonly<Record<string, ProfileConfig>>;
}

const DEFAULT_CONFIG: CliConfig = {
  currentProfile: "default",
  profiles: {}
};

export function configPath(environment: NodeJS.ProcessEnv = process.env): string {
  if (environment.PUBLISHER_CONFIG_PATH) {
    return resolve(environment.PUBLISHER_CONFIG_PATH);
  }
  const base = environment.PUBLISHER_HOME
    ? resolve(environment.PUBLISHER_HOME)
    : join(homedir(), ".publisherctl");
  return join(base, "config.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeApiUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("API URL must use HTTPS (HTTP is allowed only for localhost)");
  }
  return url.toString().replace(/\/$/, "");
}

export function parseConfig(raw: unknown): CliConfig {
  if (!isRecord(raw)) throw new Error("CLI config must be a JSON object");
  const currentProfile = typeof raw.currentProfile === "string" ? raw.currentProfile : "default";
  const profileInput = isRecord(raw.profiles) ? raw.profiles : {};
  const profiles: Record<string, ProfileConfig> = {};
  for (const [name, profile] of Object.entries(profileInput)) {
    if (!isRecord(profile) || typeof profile.apiUrl !== "string") continue;
    const cfAccessClientId =
      typeof profile.cfAccessClientId === "string" && profile.cfAccessClientId.length > 0
        ? profile.cfAccessClientId
        : undefined;
    const cfAccessClientSecret =
      typeof profile.cfAccessClientSecret === "string" && profile.cfAccessClientSecret.length > 0
        ? profile.cfAccessClientSecret
        : undefined;
    if (Boolean(cfAccessClientId) !== Boolean(cfAccessClientSecret)) {
      throw new Error(`Profile '${name}' must contain both Cloudflare Access service-token fields`);
    }
    profiles[name] = {
      apiUrl: normalizeApiUrl(profile.apiUrl),
      ...(typeof profile.token === "string" && profile.token.length > 0
        ? { token: profile.token }
        : {}),
      ...(cfAccessClientId && cfAccessClientSecret
        ? { cfAccessClientId, cfAccessClientSecret }
        : {})
    };
  }
  return { currentProfile, profiles };
}

export async function loadConfig(path = configPath()): Promise<CliConfig> {
  try {
    return parseConfig(JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_CONFIG;
    throw error;
  }
}

export async function saveConfig(config: CliConfig, path = configPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  try {
    await rename(temporaryPath, path);
    await chmod(path, 0o600).catch(() => undefined);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function upsertProfile(
  profileName: string,
  patch: Partial<ProfileConfig>,
  path = configPath()
): Promise<CliConfig> {
  const config = await loadConfig(path);
  const existing = config.profiles[profileName];
  const apiUrl = patch.apiUrl ?? existing?.apiUrl;
  if (!apiUrl) throw new Error("An API URL is required for a new profile");
  const cfAccessClientId =
    patch.cfAccessClientId !== undefined
      ? patch.cfAccessClientId || undefined
      : existing?.cfAccessClientId;
  const cfAccessClientSecret =
    patch.cfAccessClientSecret !== undefined
      ? patch.cfAccessClientSecret || undefined
      : existing?.cfAccessClientSecret;
  if (Boolean(cfAccessClientId) !== Boolean(cfAccessClientSecret)) {
    throw new Error("Cloudflare Access requires both client ID and client secret");
  }
  const nextProfile: ProfileConfig = {
    apiUrl: normalizeApiUrl(apiUrl),
    ...(patch.token !== undefined
      ? patch.token.length > 0
        ? { token: patch.token }
        : {}
      : existing?.token
        ? { token: existing.token }
        : {}),
    ...(cfAccessClientId && cfAccessClientSecret
      ? { cfAccessClientId, cfAccessClientSecret }
      : {})
  };
  const next: CliConfig = {
    currentProfile: profileName,
    profiles: { ...config.profiles, [profileName]: nextProfile }
  };
  await saveConfig(next, path);
  return next;
}

export async function removeProfileToken(
  profileName: string,
  path = configPath()
): Promise<CliConfig> {
  const config = await loadConfig(path);
  const profile = config.profiles[profileName];
  if (!profile) return config;
  const next: CliConfig = {
    ...config,
    profiles: {
      ...config.profiles,
      [profileName]: {
        apiUrl: profile.apiUrl,
        ...(profile.cfAccessClientId && profile.cfAccessClientSecret
          ? {
              cfAccessClientId: profile.cfAccessClientId,
              cfAccessClientSecret: profile.cfAccessClientSecret
            }
          : {})
      }
    }
  };
  await saveConfig(next, path);
  return next;
}

export function resolveProfile(
  config: CliConfig,
  requestedProfile: string | undefined,
  environment: NodeJS.ProcessEnv = process.env
): { name: string; profile: ProfileConfig } {
  const name = requestedProfile ?? environment.PUBLISHER_PROFILE ?? config.currentProfile;
  const stored = config.profiles[name];
  const apiUrl = environment.PUBLISHER_API_URL ?? stored?.apiUrl;
  const token = environment.PUBLISHER_API_TOKEN ?? stored?.token;
  const cfAccessClientId = environment.CF_ACCESS_CLIENT_ID ?? stored?.cfAccessClientId;
  const cfAccessClientSecret = environment.CF_ACCESS_CLIENT_SECRET ?? stored?.cfAccessClientSecret;
  if (!apiUrl) {
    throw new Error(`Profile '${name}' is not configured. Run: publisherctl auth login --profile ${name}`);
  }
  if (Boolean(cfAccessClientId) !== Boolean(cfAccessClientSecret)) {
    throw new Error("Cloudflare Access requires both CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET");
  }
  return {
    name,
    profile: {
      apiUrl: normalizeApiUrl(apiUrl),
      ...(token ? { token } : {}),
      ...(cfAccessClientId && cfAccessClientSecret
        ? { cfAccessClientId, cfAccessClientSecret }
        : {})
    }
  };
}
