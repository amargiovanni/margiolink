const PBKDF2_ITERATIONS = 600_000;
const HASH_PREFIX = `pbkdf2-sha256$${PBKDF2_ITERATIONS}$`;

export async function hashPasswordForSeed(password, saltHex) {
  if (!/^[0-9a-f]{32}$/.test(saltHex)) {
    throw new Error("Password salt must be 16 bytes of lowercase hex");
  }

  const encoder = new TextEncoder();
  const salt = Uint8Array.from(saltHex.match(/../g), (byte) => Number.parseInt(byte, 16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  const digest = [...new Uint8Array(bits)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${HASH_PREFIX}${digest}`;
}
