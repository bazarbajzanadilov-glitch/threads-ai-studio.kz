import { randomUUID } from "node:crypto";

export interface ApiErrorBody {
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
    readonly details?: unknown;
    readonly request_id?: string;
  };
  readonly message?: string;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly details?: unknown;
  public readonly requestId?: string;

  public constructor(status: number, body: ApiErrorBody, fallback: string) {
    super(body.error?.message ?? body.message ?? fallback);
    this.name = "ApiError";
    this.status = status;
    this.code = body.error?.code;
    this.details = body.error?.details;
    this.requestId = body.error?.request_id;
  }
}

export interface ApiClientOptions {
  readonly apiUrl: string;
  readonly token?: string;
  readonly cfAccessClientId?: string;
  readonly cfAccessClientSecret?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export interface RequestOptions {
  readonly method?: "GET" | "POST" | "PATCH" | "DELETE";
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly revision?: string | number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

function safelyParseJson(value: string): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export class ApiClient {
  readonly #apiUrl: string;
  readonly #token?: string;
  readonly #cfAccessClientId?: string;
  readonly #cfAccessClientSecret?: string;
  readonly #fetch: typeof globalThis.fetch;

  public constructor(options: ApiClientOptions) {
    this.#apiUrl = options.apiUrl.replace(/\/$/, "");
    this.#token = options.token;
    this.#cfAccessClientId = options.cfAccessClientId;
    this.#cfAccessClientSecret = options.cfAccessClientSecret;
    if (Boolean(this.#cfAccessClientId) !== Boolean(this.#cfAccessClientSecret)) {
      throw new Error("Cloudflare Access requires both client ID and client secret");
    }
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  public mutationKey(provided?: string): string {
    return provided ?? randomUUID();
  }

  public async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");
    headers.set("User-Agent", "publisherctl/0.1.0");
    if (this.#token) headers.set("Authorization", `Bearer ${this.#token}`);
    if (this.#cfAccessClientId && this.#cfAccessClientSecret) {
      headers.set("CF-Access-Client-Id", this.#cfAccessClientId);
      headers.set("CF-Access-Client-Secret", this.#cfAccessClientSecret);
    }
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
    if (options.revision !== undefined) headers.set("If-Match", String(options.revision));

    const response = await this.#fetch(`${this.#apiUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {})
    });
    const raw = await response.text();
    const parsed = safelyParseJson(raw);
    if (!response.ok) {
      const body = typeof parsed === "object" && parsed !== null ? (parsed as ApiErrorBody) : {};
      throw new ApiError(response.status, body, `API request failed with HTTP ${response.status}`);
    }
    return parsed as T;
  }
}
