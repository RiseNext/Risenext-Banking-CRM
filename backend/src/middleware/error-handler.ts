import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

interface PostgresError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  customers_bank_reference_unique:
    "A customer with this Bank Reference ID already exists for the selected bank",
  customers_code_unique: "A customer with this code already exists",
  users_email_unique: "A user with this email address already exists",
  users_employee_code_unique: "A user with this employee code already exists",
  banks_code_unique: "A bank with this code already exists",
  teams_name_unique: "A team with this name already exists",
  roles_key_unique: "A role with this key already exists",
};

/**
 * Drizzle wraps driver errors in a DrizzleQueryError, so the pg error code
 * lives on `.cause` (sometimes nested). Without this, every unique-constraint
 * violation surfaces as a 500 instead of a 409.
 */
function rootCause(error: unknown, depth = 0): unknown {
  if (depth > 5 || !error || typeof error !== "object") return error;
  const cause = (error as { cause?: unknown }).cause;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && /^\d{5}$/.test(code)) return error;
  return cause ? rootCause(cause, depth + 1) : error;
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: "not_found", message: "Route not found" } });
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ZodError) {
    res.status(422).json({
      error: {
        code: "validation_failed",
        message: "The submitted data is not valid",
        details: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
    return;
  }

  if (error instanceof AppError) {
    if (error.status >= 500) logger.error({ err: error, requestId: req.requestId }, error.message);
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details ?? undefined },
    });
    return;
  }

  const pg = rootCause(error) as PostgresError;
  if (pg?.code === "23505") {
    const message = pg.constraint ? CONSTRAINT_MESSAGES[pg.constraint] : undefined;
    res.status(409).json({
      error: {
        code: "conflict",
        message: message ?? "That record already exists",
        details: pg.constraint ? { constraint: pg.constraint } : undefined,
      },
    });
    return;
  }
  if (pg?.code === "23503") {
    res.status(409).json({
      error: { code: "conflict", message: "That record is still referenced by other records" },
    });
    return;
  }

  logger.error({ err: error, requestId: req.requestId }, "Unhandled error");
  res.status(500).json({
    error: { code: "internal_error", message: "Unexpected server error" },
  });
}
