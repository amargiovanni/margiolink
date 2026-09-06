import type { MiddlewareHandler } from "hono";

export const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; " +
    "script-src 'self' 'sha256-jqkx9pzJml1aEgfjAiBiRSKJKCqhFzmHOf/oRgGdqw0='; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; font-src 'self'; connect-src 'self'; " +
    "frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

export function applySecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  if (new URL(c.req.url).pathname.startsWith("/api/")) {
    c.header("Cache-Control", "private, no-store");
  }
  await next();
  c.res = applySecurityHeaders(c.res);
};
