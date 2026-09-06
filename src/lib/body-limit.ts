export const PUBLIC_BODY_LIMIT_BYTES = 16 * 1024;
export const JSON_BODY_LIMIT_BYTES = 16 * 1024;

export type LimitedBody = { ok: true; text: string } | { ok: false };
export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; error: "unsupported_media_type" | "payload_too_large" | "invalid_body" };

/**
 * Read an unauthenticated request body without retaining more than `limit`
 * bytes. Content-Length is only a fast rejection path: the stream is always
 * counted as it is consumed, so a missing or dishonest header cannot bypass
 * the limit.
 */
export async function readLimitedBody(
  request: Request,
  limit = PUBLIC_BODY_LIMIT_BYTES,
): Promise<LimitedBody> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && /^\d+$/.test(declaredLength)) {
    const length = Number(declaredLength);
    if (Number.isSafeInteger(length) && length > limit) return { ok: false };
  }

  if (request.body === null) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      if (total + value.byteLength > limit) {
        await reader.cancel().catch(() => undefined);
        return { ok: false };
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}

export async function readJsonBody(
  request: Request,
  limit = JSON_BODY_LIMIT_BYTES,
): Promise<JsonBodyResult> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return { ok: false, error: "unsupported_media_type" };

  const body = await readLimitedBody(request, limit);
  if (!body.ok) return { ok: false, error: "payload_too_large" };

  try {
    return { ok: true, value: JSON.parse(body.text) };
  } catch {
    return { ok: false, error: "invalid_body" };
  }
}
