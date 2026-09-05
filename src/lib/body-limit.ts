export const PUBLIC_BODY_LIMIT_BYTES = 16 * 1024;

export type LimitedBody = { ok: true; text: string } | { ok: false };

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
      if (done) break;
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
