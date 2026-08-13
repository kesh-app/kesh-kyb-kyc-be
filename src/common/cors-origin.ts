/**
 * Shared CORS origin policy — used by the HTTP server (main.ts) and the
 * notifications WebSocket gateway, so the two transports never drift apart.
 */

export function corsOriginList(): string[] {
  return (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isOriginAllowed(origin: string | undefined, allowList: string[]): boolean {
  // No Origin header = server-to-server / Postman, not a browser request.
  if (!origin) return true;
  try {
    const u = new URL(origin);
    const isDevTunnels = /\.devtunnels\.ms$/.test(u.hostname);
    return isDevTunnels || allowList.includes(origin);
  } catch {
    return false;
  }
}
