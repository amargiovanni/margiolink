export const SESSION_COOKIE = "__Host-ml_session";
export const SESSION_MAX_AGE = 30 * 24 * 3600;

export function summariseUserAgent(browser: string | null, os: string | null): string | null {
  if (!browser && !os) return null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os;
}
