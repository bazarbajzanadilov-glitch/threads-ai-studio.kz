import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "./http.js";

describe("ApiClient", () => {
  it("sends bearer, revision, and idempotency headers on writes", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.headers.get("authorization")).toBe("Bearer secret");
      expect(request.headers.get("cf-access-client-id")).toBe("access-id");
      expect(request.headers.get("cf-access-client-secret")).toBe("access-secret");
      expect(request.headers.get("if-match")).toBe("4");
      expect(request.headers.get("idempotency-key")).toBe("stable-key");
      return Response.json({ data: { ok: true } });
    });
    const client = new ApiClient({
      apiUrl: "https://api.example.com",
      token: "secret",
      cfAccessClientId: "access-id",
      cfAccessClientSecret: "access-secret",
      fetch: fetchMock
    });
    await expect(
      client.request("/api/v1/content/id:pause", {
        method: "POST",
        body: { expected_revision: 4 },
        revision: 4,
        idempotencyKey: "stable-key"
      })
    ).resolves.toEqual({ data: { ok: true } });
  });

  it("surfaces structured API conflicts", async () => {
    const client = new ApiClient({
      apiUrl: "https://api.example.com",
      fetch: vi.fn(async () =>
        Response.json(
          { error: { code: "REVISION_CONFLICT", message: "stale", details: { current: 7 } } },
          { status: 409 }
        )
      )
    });
    const error = await client.request("/test").catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("REVISION_CONFLICT");
    expect((error as ApiError).details).toEqual({ current: 7 });
  });
});
