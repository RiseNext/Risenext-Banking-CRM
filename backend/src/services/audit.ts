import type { Request } from "express";
import type { Database } from "../db/index.js";
import { auditLogs } from "../db/schema/index.js";
import type { AuditAction } from "../db/schema/governance.js";
import type { AuthContext } from "./access.js";
import { logger } from "../lib/logger.js";

export interface AuditInput {
  action: AuditAction | string;
  recordType: string;
  recordId?: string | null;
  bankId?: string | null;
  summary?: string;
  changes?: unknown;
  metadata?: Record<string, unknown>;
}

const REDACTED_FIELDS = new Set([
  "password",
  "passwordHash",
  "password_hash",
  "aadhaar",
  "aadhaarHash",
  "aadhaar_hash",
  "token",
  "tokenHash",
]);

/** Never let a secret reach the audit table via a diff. */
export function diff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const key of keys) {
    if (REDACTED_FIELDS.has(key)) continue;
    const from = before?.[key];
    const to = after?.[key];
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from, to };
  }
  return changes;
}

/**
 * Writes an audit row. Deliberately accepts the same `db` handle the caller is
 * using, so that when the caller is inside a transaction the audit row commits
 * or rolls back atomically with the change it describes.
 */
export async function recordAudit(
  db: Database,
  ctx: AuthContext | null,
  req: Request | null,
  input: AuditInput,
): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actorId: ctx?.userId ?? null,
      actorEmail: ctx?.email ?? null,
      actorRoleKey: ctx?.roleKey ?? null,
      action: input.action,
      recordType: input.recordType,
      recordId: input.recordId ?? null,
      bankId: input.bankId ?? null,
      summary: input.summary ?? null,
      changes: (input.changes ?? null) as never,
      metadata: (input.metadata ?? null) as never,
      ipAddress: req?.ip ?? null,
      userAgent: req?.headers["user-agent"] ?? null,
      requestId: req?.requestId ?? null,
    });
  } catch (error) {
    // An audit write must never mask the operation's own error, but a silent
    // failure would be worse, so it is logged at error level for alerting.
    logger.error({ err: error, audit: input }, "Failed to write audit log");
    throw error;
  }
}

export async function recordAuthEvent(
  db: Database,
  req: Request | null,
  action: AuditAction,
  email: string,
  userId: string | null,
  summary: string,
): Promise<void> {
  await db.insert(auditLogs).values({
    actorId: userId,
    actorEmail: email,
    action,
    recordType: "auth",
    recordId: userId,
    summary,
    ipAddress: req?.ip ?? null,
    userAgent: req?.headers["user-agent"] ?? null,
    requestId: req?.requestId ?? null,
  });
}
