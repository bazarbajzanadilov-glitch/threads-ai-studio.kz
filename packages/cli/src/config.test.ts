import { describe, expect, it } from "vitest";
import { parseConfig, resolveProfile } from "./config.js";

describe("CLI config", () => {
  it("normalizes API URLs and uses environment credentials first", () => {
    const config = parseConfig({
      currentProfile: "production",
      profiles: {
        production: {
          apiUrl: "https://publisher.example.com/",
          token: "stored",
          cfAccessClientId: "stored-id",
          cfAccessClientSecret: "stored-secret"
        }
      }
    });
    const resolved = resolveProfile(config, undefined, {
      PUBLISHER_API_TOKEN: "environment",
      CF_ACCESS_CLIENT_ID: "environment-id",
      CF_ACCESS_CLIENT_SECRET: "environment-secret"
    });
    expect(resolved.profile).toEqual({
      apiUrl: "https://publisher.example.com",
      token: "environment",
      cfAccessClientId: "environment-id",
      cfAccessClientSecret: "environment-secret"
    });
  });

  it("rejects insecure non-local API URLs", () => {
    expect(() =>
      parseConfig({ currentProfile: "default", profiles: { default: { apiUrl: "http://example.com" } } })
    ).toThrow(/HTTPS/);
  });

  it("rejects incomplete Cloudflare Access service-token pairs", () => {
    expect(() =>
      parseConfig({
        profiles: {
          default: { apiUrl: "https://publisher.example.com", cfAccessClientId: "only-one-field" }
        }
      })
    ).toThrow(/both Cloudflare Access/);
  });
});
