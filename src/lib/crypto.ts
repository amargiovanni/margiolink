const LEGACY_PBKDF2_ITERATIONS = 100_000;
const PBKDF2_ITERATIONS = 600_000;
const PASSWORD_HASH_PREFIX = `pbkdf2-sha256$${PBKDF2_ITERATIONS}$`;
const HEX_32_BYTES = /^[0-9a-f]{64}$/;
const HEX_16_BYTES = /^[0-9a-f]{32}$/;
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

async function derivePassword(
  password: string,
  saltHex: string,
  iterations: number,
): Promise<string> {
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
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  return toHex(bits);
}

export async function hashPassword(password: string, saltHex: string): Promise<string> {
  if (!HEX_16_BYTES.test(saltHex)) {
    throw new Error("Password salt must be 16 bytes of lowercase hex");
  }
  const digest = await derivePassword(password, saltHex, PBKDF2_ITERATIONS);
  return `${PASSWORD_HASH_PREFIX}${digest}`;
}

export async function verifyPassword(
  password: string,
  saltHex: string,
  encodedHash: string,
): Promise<boolean> {
  if (!HEX_16_BYTES.test(saltHex)) return false;

  let iterations: number;
  let expectedDigest: string;
  if (HEX_32_BYTES.test(encodedHash)) {
    iterations = LEGACY_PBKDF2_ITERATIONS;
    expectedDigest = encodedHash;
  } else if (encodedHash.startsWith(PASSWORD_HASH_PREFIX)) {
    const digest = encodedHash.slice(PASSWORD_HASH_PREFIX.length);
    if (!HEX_32_BYTES.test(digest)) return false;
    iterations = PBKDF2_ITERATIONS;
    expectedDigest = digest;
  } else {
    return false;
  }

  const actual = await derivePassword(password, saltHex, iterations);
  return constantTimeEquals(actual, expectedDigest);
}
