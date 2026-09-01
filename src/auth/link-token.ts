const encoder = new TextEncoder();
const TTL_SECONDS = 600;

async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function issueLinkToken(secret: string, slug: string, now: number): Promise<string> {
  const expiry = now + TTL_SECONDS;
  return `${expiry}.${await sign(secret, `${slug}:${expiry}`)}`;
}

export async function verifyLinkToken(
  secret: string,
  slug: string,
  token: string,
  now: number,
): Promise<boolean> {
  const [expiryPart, signature] = token.split(".");
  if (!expiryPart || !signature) return false;

  const expiry = Number.parseInt(expiryPart, 10);
  if (!Number.isFinite(expiry) || expiry <= now) return false;

  const expected = await sign(secret, `${slug}:${expiry}`);
  if (expected.length !== signature.length) return false;

  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}
