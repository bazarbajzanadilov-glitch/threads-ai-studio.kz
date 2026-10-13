import { describe, expect, it, vi, afterEach } from "vitest";
import { api, ApiError } from "./api";

afterEach(() => vi.restoreAllMocks());

describe("Admin API Client", () => {
  it("authenticates via login and stores token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        token: "session_token_123",
        user: { email: "bazarbajzanadilov@gmail.com", role: "admin" }
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    );

    const res = await api.login("bazarbajzanadilov@gmail.com", "admin_master_secret_2026");
    expect(res.token).toBe("session_token_123");
    expect(localStorage.getItem("admin_token")).toBe("session_token_123");
  });

  it("fetches accounts and attaches bearer token", async () => {
    localStorage.setItem("admin_token", "test_token");

    let capturedHeaders: HeadersInit | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify({
        accounts: [
          { id: "acc-1", username: "studio", threads_user_id: "123", is_active: true, status: "active" }
        ]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const accounts = await api.getAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.username).toBe("studio");
    expect((capturedHeaders as Record<string, string>)?.Authorization).toBe("Bearer test_token");
  });

  it("handles 401 unauthorized by clearing token", async () => {
    localStorage.setItem("admin_token", "bad_token");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "Invalid session" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(api.getAccounts()).rejects.toThrow(ApiError);
    expect(localStorage.getItem("admin_token")).toBeNull();
  });

  it("creates a Threads post (Text + 1 Image)", async () => {
    let capturedBody: string | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({
        post: {
          id: "post-1",
          text: "Hello Threads!",
          image_filename: "pic.jpg",
          image_url: "https://thread.ai-studio.kz/uploads/pic.jpg",
          status: "scheduled"
        }
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    });

    const res = await api.createPost({
      text: "Hello Threads!",
      image_filename: "pic.jpg",
      image_url: "https://thread.ai-studio.kz/uploads/pic.jpg",
      scheduled_at: "2026-10-15T12:00:00Z"
    });

    expect(res.post?.text).toBe("Hello Threads!");
    const parsed = JSON.parse(capturedBody!);
    expect(parsed.image_url).toBe("https://thread.ai-studio.kz/uploads/pic.jpg");
  });
});
