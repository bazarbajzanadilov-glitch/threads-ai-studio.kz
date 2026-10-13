const encoder = new TextEncoder();
const decoder = new TextDecoder();

function ownedBuffer(value: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

export function base64UrlEncode(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function sha256Hex(value: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const hash = await crypto.subtle.digest("SHA-256", ownedBuffer(bytes));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256(key: string | Uint8Array, value: string | Uint8Array): Promise<Uint8Array> {
  const rawKey = typeof key === "string" ? encoder.encode(key) : key;
  const message = typeof value === "string" ? encoder.encode(value) : value;
  const cryptoKey = await crypto.subtle.importKey("raw", ownedBuffer(rawKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, ownedBuffer(message)));
}

export async function encryptSecret(plaintext: string, base64UrlKey: string): Promise<string> {
  const rawKey = base64UrlDecode(base64UrlKey);
  if (rawKey.byteLength !== 32) throw new Error("Encryption key must be 32 bytes");
  const key = await crypto.subtle.importKey("raw", ownedBuffer(rawKey), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: ownedBuffer(iv) }, key, ownedBuffer(encoder.encode(plaintext)));
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(ciphertext)}`;
}

export async function decryptSecret(payload: string, base64UrlKey: string): Promise<string> {
  const [version, ivValue, ciphertextValue] = payload.split(".");
  if (version !== "v1" || !ivValue || !ciphertextValue) throw new Error("Unsupported encrypted payload");
  const rawKey = base64UrlDecode(base64UrlKey);
  if (rawKey.byteLength !== 32) throw new Error("Encryption key must be 32 bytes");
  const key = await crypto.subtle.importKey("raw", ownedBuffer(rawKey), "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ownedBuffer(base64UrlDecode(ivValue)) },
    key,
    ownedBuffer(base64UrlDecode(ciphertextValue))
  );
  return decoder.decode(plaintext);
}

export function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  return difference === 0;
}

export function randomToken(byteLength = 32): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}
