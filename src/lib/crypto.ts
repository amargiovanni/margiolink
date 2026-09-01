const PBKDF2_ITERATIONS = 100_000;
const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function utcDay(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

async function dailyKey(secret: string, ts: number): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(`${secret}:${utcDay(ts)}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function dailyHmac(secret: string, ts: number, message: string): Promise<string> {
  const key = await dailyKey(secret, ts);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return toHex(signature).slice(0, 32);
}

export function visitorHash(
  secret: string,
  ip: string,
  ua: string,
  slug: string,
  ts: number,
): Promise<string> {
  return dailyHmac(secret, ts, `${ip} ${ua} ${slug}`);
}

export function ipHash(secret: string, ip: string, ts: number): Promise<string> {
  return dailyHmac(secret, ts, `login ${ip}`);
}

export async function sha256Hex(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(input)));
}

export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

export function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

export async function constantTimeEquals(a: string, b: string): Promise<boolean> {
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(digestA, digestB);
}

export async function hashPassword(password: string, saltHex: string): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: fromHex(saltHex),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  return toHex(bits);
}

export async function verifyPassword(
  password: string,
  saltHex: string,
  expectedHex: string,
): Promise<boolean> {
  const actual = await hashPassword(password, saltHex);
  return constantTimeEquals(actual, expectedHex);
}
