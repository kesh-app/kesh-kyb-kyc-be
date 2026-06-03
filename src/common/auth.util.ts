/**
 * Resolve authenticated user ID from JWT payload.
 * JWT strategy sets `sub`; falls back to `id` for backwards compat.
 * Throws if called without a valid authenticated user (should never happen behind JwtAuthGuard).
 */
export function resolveUserId(user: any): number | string {
  const id = user?.sub ?? user?.id;
  if (id === undefined || id === null) {
    throw new Error('resolveUserId: no sub/id in JWT payload — unauthenticated call');
  }
  return id;
}
