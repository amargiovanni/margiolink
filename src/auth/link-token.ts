const encoder = new TextEncoder();
const TTL_SECONDS = 600;

export interface LinkTokenIdentity {
  id: number;
  slug: string;
  passwordSalt: string;
  passwordHash: string;
}

function message(identity: LinkTokenIdentity, expiry: number): string {
  // A JSON array gives every field an unambiguous boundary. The password
  // credential fields are authenticated by HMAC but never included in the
  // token sent to the browser.
  return JSON.stringify([
    "v2",
    identity.id,
    identity.slug,
    identity.passwordSalt,
    identity.passwordHash,
    expiry,
  ]);
}

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

export async function issueLinkToken(
  secret: string,
  identity: LinkTokenIdentity,
  now: number,
): Promise<string> {
  const expiry = now + TTL_SECONDS;
  return `v2.${expiry}.${await sign(secret, message(identity, expiry))}`;
}

export async function verifyLinkToken(
  secret: string,
  identity: LinkTokenIdentity,
  token: string,
  now: number,
): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, expiryPart, signature] = parts;
  if (version !== "v2" || !expiryPart || !/^\d+$/.test(expiryPart)) return false;
  if (!signature || !/^[0-9a-f]{64}$/.test(signature)) return false;

  const expiry = Number(expiryPart);
  if (!Number.isSafeInteger(expiry) || expiry <= now) return false;

  const expected = await sign(secret, message(identity, expiry));
  if (expected.length !== signature.length) return false;

  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}
