export type ReferrerType = "direct" | "search" | "social" | "email" | "ai" | "other";

export interface ReferrerInfo {
  host: string | null;
  type: ReferrerType;
}

const CLASSIFICATION: ReadonlyArray<readonly [ReferrerType, readonly string[]]> = [
  [
    "email",
    [
      "mail.google.com",
      "outlook.live.com",
      "outlook.office.com",
      "outlook.office365.com",
      "mail.yahoo.com",
      "mail.proton.me",
    ],
  ],
  [
    "ai",
    [
      "chatgpt.com",
      "chat.openai.com",
      "claude.ai",
      "perplexity.ai",
      "gemini.google.com",
      "copilot.microsoft.com",
    ],
  ],
  [
    "search",
    [
      "google.com",
      "google.it",
      "bing.com",
      "duckduckgo.com",
      "ecosia.org",
      "yandex.com",
      "baidu.com",
      "search.brave.com",
      "startpage.com",
      "qwant.com",
    ],
  ],
  [
    "social",
    [
      "facebook.com",
      "instagram.com",
      "twitter.com",
      "x.com",
      "t.co",
      "linkedin.com",
      "lnkd.in",
      "reddit.com",
      "pinterest.com",
      "tiktok.com",
      "youtube.com",
      "t.me",
      "whatsapp.com",
      "threads.net",
      "bsky.app",
      "mastodon.social",
    ],
  ],
];

function stripWww(hostname: string): string {
  return hostname.replace(/^www\./, "");
}

function matches(host: string, candidate: string): boolean {
  return host === candidate || host.endsWith(`.${candidate}`);
}

/**
 * Classify a `Referer` header down to its host and a channel.
 *
 * The raw header is deliberately not returned: its path and query carry
 * unbounded free text from a third-party page, nothing in the application ever
 * needed it, and `migrations/0002_drop_referrer_url.sql` removed the column
 * that used to store it.
 */
export function parseReferrer(raw: string | null): ReferrerInfo {
  if (!raw) {
    return { host: null, type: "direct" };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { host: null, type: "direct" };
  }

  const host = stripWww(parsed.hostname.toLowerCase());

  for (const [type, hosts] of CLASSIFICATION) {
    if (hosts.some((candidate) => matches(host, candidate))) {
      return { host, type };
    }
  }

  return { host, type: "other" };
}
