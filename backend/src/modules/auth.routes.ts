import { Router, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { refreshTokens, roles, users } from "../db/schema/index.js";
import { env } from "../config/env.js";
import { forbidden, tooManyRequests, unauthorized, unprocessable } from "../lib/errors.js";
import { hashPassword, passwordProblems, sha256, verifyPassword } from "../lib/password.js";
import {
  REFRESH_COOKIE_NAME,
  refreshCookieOptions,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../lib/tokens.js";
import { authOf, requireAuth } from "../middleware/auth.js";
import { loadAuthContext } from "../services/access.js";
import { recordAuthEvent } from "../services/audit.js";
import { randomUUID } from "node:crypto";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().min(3).max(255),
  password: z.string().min(1).max(512),
});

const MAX_FAILED_ATTEMPTS = 8;
const LOCKOUT_MINUTES = 15;

async function issueSession(req: Request, res: Response, userId: string) {
  const db = getDb();
  const ctx = await loadAuthContext(db, userId);

  const jti = randomUUID();
  const refresh = signRefreshToken({ sub: userId, jti });
  const expiresAt = new Date(Date.now() + env().REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(refreshTokens).values({
    userId,
    tokenHash: sha256(refresh),
    expiresAt,
    userAgent: req.headers["user-agent"] ?? null,
    ipAddress: req.ip ?? null,
  });

  const access = signAccessToken({
    sub: userId,
    email: ctx.email,
    roleId: ctx.roleId,
    roleKey: ctx.roleKey,
    roleLevel: ctx.roleLevel,
  });

  res.cookie(REFRESH_COOKIE_NAME, refresh, refreshCookieOptions());
  return { access, ctx };
}

function profileOf(ctx: Awaited<ReturnType<typeof loadAuthContext>>) {
  return {
    id: ctx.userId,
    name: ctx.name,
    email: ctx.email,
    role: { id: ctx.roleId, key: ctx.roleKey, name: ctx.roleName, level: ctx.roleLevel },
    permissions: [...ctx.permissions].sort(),
    bankIds: ctx.bankIds,
    unrestrictedBankAccess: ctx.bankIds === null,
  };
}

/**
 * POST /api/auth/login
 *
 * Note what is absent: the client does not tell us which role it wants. The
 * demo frontend let the user pick from a dropdown; the role now comes from the
 * user record and nowhere else.
 */
authRouter.post("/login", async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const db = getDb();
    const normalised = email.trim().toLowerCase();

    const [account] = await db
      .select({
        id: users.id,
        email: users.email,
        passwordHash: users.passwordHash,
        status: users.status,
        mustChangePassword: users.mustChangePassword,
        failedLoginAttempts: users.failedLoginAttempts,
        lockedUntil: users.lockedUntil,
        roleActive: roles.isActive,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(and(eq(users.email, normalised), isNull(users.deletedAt)))
      .limit(1);

    if (account?.lockedUntil && account.lockedUntil > new Date()) {
      await recordAuthEvent(db, req, "login_failed", normalised, account.id, "Account locked");
      throw tooManyRequests("Account temporarily locked. Try again shortly.");
    }

    // Always run a verification so response timing does not reveal whether the
    // address exists. The dummy hash below is a real argon2id digest.
    const hash = account?.passwordHash ?? DUMMY_HASH;
    const ok = await verifyPassword(hash, password);

    if (!account || !ok) {
      if (account) {
        const attempts = account.failedLoginAttempts + 1;
        await db
          .update(users)
          .set({
            failedLoginAttempts: attempts,
            lockedUntil:
              attempts >= MAX_FAILED_ATTEMPTS
                ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
                : null,
          })
          .where(eq(users.id, account.id));
      }
      await recordAuthEvent(db, req, "login_failed", normalised, account?.id ?? null, "Bad credentials");
      throw unauthorized("Invalid email or password");
    }

    if (account.status !== "Active") throw forbidden("Account is not active");
    if (!account.roleActive) throw forbidden("Assigned role has been disabled");

    await db
      .update(users)
      .set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(users.id, account.id));

    const { access, ctx } = await issueSession(req, res, account.id);
    await recordAuthEvent(db, req, "login_succeeded", ctx.email, ctx.userId, "Signed in");

    res.json({
      accessToken: access,
      expiresIn: env().ACCESS_TOKEN_TTL,
      mustChangePassword: account.mustChangePassword,
      user: profileOf(ctx),
    });
  } catch (error) {
    next(error);
  }
});

/** A fixed argon2id hash of a random string, used only for timing equalisation. */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZS1zdGF0aWMtc2FsdA$3Ppw0kZ0i0Nn2m1S8kQmVJv0k1r3sPqZ8Xa9Yb0cDeE";

authRouter.post("/refresh", async (req, res, next) => {
  try {
    const cookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
    if (!cookie) throw unauthorized("No refresh token");

    const claims = verifyRefreshToken(cookie);
    const db = getDb();
    const tokenHash = sha256(cookie);

    const [stored] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      // Reuse of a revoked token is treated as compromise: kill every session.
      if (stored?.revokedAt) {
        await db
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(eq(refreshTokens.userId, claims.sub));
      }
      throw unauthorized("Session expired");
    }

    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, stored.id));

    const { access, ctx } = await issueSession(req, res, claims.sub);
    res.json({ accessToken: access, expiresIn: env().ACCESS_TOKEN_TTL, user: profileOf(ctx) });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    const cookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
    const db = getDb();
    if (cookie) {
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.tokenHash, sha256(cookie)));
    }
    res.clearCookie(REFRESH_COOKIE_NAME, { ...refreshCookieOptions(), maxAge: undefined });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: profileOf(authOf(req)) });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

authRouter.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const db = getDb();

    const [account] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);

    if (!account || !(await verifyPassword(account.passwordHash, currentPassword))) {
      throw unauthorized("Current password is incorrect");
    }

    const problems = passwordProblems(newPassword);
    if (problems.length > 0) throw unprocessable(`Password ${problems.join(", ")}`);

    await db
      .update(users)
      .set({
        passwordHash: await hashPassword(newPassword),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, ctx.userId));

    // Force re-authentication everywhere else.
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.userId, ctx.userId));

    await recordAuthEvent(db, req, "password_changed", ctx.email, ctx.userId, "Password changed");
    res.clearCookie(REFRESH_COOKIE_NAME, { ...refreshCookieOptions(), maxAge: undefined });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
