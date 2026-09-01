import { insertClick, type Outcome } from "../db/clicks";
import { visitorHash } from "../lib/crypto";
import type { RequestContext } from "../lib/request-context";
import type { Env } from "../types";

export interface RecordClickParams {
  linkId: number;
  slug: string;
  outcome: Outcome;
  context: RequestContext;
  now: number;
}

export async function recordClick(env: Env, params: RecordClickParams): Promise<void> {
  try {
    const hash = await visitorHash(
      env.HASH_SECRET,
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
    console.error("recordClick failed", error);
  }
}
