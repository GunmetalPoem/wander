/**
 * If ADMIN_SECRET is unset, mutating routes are allowed (local demo only).
 * If set, require matching `x-admin-secret` header.
 */
export function assertAdminSecret(req: Request): void {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return;

  const h = req.headers.get("x-admin-secret");
  if (h !== secret) {
    const err = new Error("Unauthorized");
    (err as Error & { statusCode: number }).statusCode = 401;
    throw err;
  }
}
