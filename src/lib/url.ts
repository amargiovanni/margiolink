export type UrlValidation =
  | { ok: true; url: string }
  | { ok: false; error: "invalid" | "unsupported_protocol" | "self_reference" | "too_long" };

const MAX_LENGTH = 2048;
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export function validateTargetUrl(input: string, shortDomain: string): UrlValidation {
  const trimmed = input.trim();

  if (trimmed.length > MAX_LENGTH) {
    return { ok: false, error: "too_long" };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "invalid" };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, error: "unsupported_protocol" };
  }

  if (parsed.hostname === "") {
    return { ok: false, error: "invalid" };
  }

  if (parsed.hostname.toLowerCase() === shortDomain.toLowerCase()) {
    return { ok: false, error: "self_reference" };
  }

  return { ok: true, url: parsed.toString() };
}
