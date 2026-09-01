import { insertClick, type Outcome } from "../db/clicks";
import { visitorHash } from "../lib/crypto";
import type { RequestContext } from "../lib/request-context";
import { requireHashSecret } from "../lib/secrets";
import type { Env } from "../types";

export interface RecordClickParams {
  linkId: number;
  slug: string;
  outcome: Outcome;
  context: RequestContext;
  now: number;
}

export async function recordClick(env: Env, params: RecordClickParams): Promise<void> {
  // Deliberately outside the `try`: everything below is best-effort and must
  // never break a redirect, but an unusable HASH_SECRET is not a transient
  // ingestion failure to be logged and forgotten — it would silently write
  // reproducible visitor hashes. It propagates instead, and the callers in
  // `src/routes/redirect.ts` refuse the request before ever reaching here.
  const secret = requireHashSecret(env);

  try {
    const hash = await visitorHash(
      secret,
      params.context.ip,
      params.context.userAgent,
      params.slug,
      params.now,
    );

    await insertClick(env.DB, {
      linkId: params.linkId,
      ts: params.now,
      visitorHash: hash,
      source: params.context.source,
      outcome: params.outcome,
      isBot: params.context.client.isBot,
      geo: params.context.geo,
      client: params.context.client,
      referrer: params.context.referrer,
      utm: params.context.utm,
    });
  } catch (error) {
    // Log only `error`, never `params` — params.context carries the visitor's
    // IP and raw user-agent, which must never reach Workers observability.
    console.error("recordClick failed", error);
  }
}
