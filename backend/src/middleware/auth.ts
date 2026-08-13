import type { NextFunction, Request, Response } from "express";
import { getDb } from "../db/index.js";
import { unauthorized } from "../lib/errors.js";
import { verifyAccessToken } from "../lib/tokens.js";
import { assertPermission, loadAuthContext, type AuthContext } from "../services/access.js";

function bearerFrom(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

/**
 * Verifies the access token, then re-reads the user's role, permissions and
 * bank assignments from the database on every request. Slightly more expensive
 * than trusting claims in the JWT, and worth it: a revoked permission or a
 * deactivated account takes effect immediately rather than at token expiry.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = bearerFrom(req);
    if (!token) throw unauthorized("Missing bearer token");
    const claims = verifyAccessToken(token);
    req.auth = await loadAuthContext(getDb(), claims.sub);
    next();
  } catch (error) {
    next(error);
  }
}

export function authOf(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

/** Route guard. Always reference PERMISSIONS.*, never a role name. */
export function requirePermission(...keys: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const ctx = authOf(req);
      for (const key of keys) assertPermission(ctx, key);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Passes if the caller holds ANY of the listed permissions. */
export function requireAnyPermission(...keys: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const ctx = authOf(req);
      if (!keys.some((k) => ctx.permissions.has(k))) {
        assertPermission(ctx, keys[0] ?? "unknown");
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
