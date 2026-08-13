import { and, eq, isNull, sql } from "drizzle-orm";
import type { Request } from "express";
import type { Database } from "../db/index.js";
import {
  bankOrders,
  banks,
  customers,
  disbursements,
  documents,
  fundingSources,
  ledgerEntries,
  loans,
  recycleBinEntries,
  serviceProviders,
  settlements,
  transactions,
  verifications,
} from "../db/schema/index.js";
import { conflict, notFound } from "../lib/errors.js";
import { env } from "../config/env.js";
import { recordAudit } from "./audit.js";
import type { AuthContext } from "./access.js";

/**
 * Registry of soft-deletable record types. Adding a new type here is all that
 * is needed for it to appear in the Bin, restore correctly, and be purgeable.
 */
export const BIN_REGISTRY = {
  customer: {
    table: customers,
    label: (row: Record<string, unknown>) => String(row.name ?? row.code ?? "Customer"),
    bankIdOf: (row: Record<string, unknown>) => (row.bankId as string | null) ?? null,
  },
  bank: {
    table: banks,
    label: (row: Record<string, unknown>) => String(row.name ?? "Bank"),
    bankIdOf: (row: Record<string, unknown>) => (row.id as string | null) ?? null,
  },
  loan: {
    table: loans,
    label: (row: Record<string, unknown>) => String(row.code ?? row.applicationNo ?? "Loan"),
    bankIdOf: (row: Record<string, unknown>) => (row.bankId as string | null) ?? null,
  },
  bank_order: {
    table: bankOrders,
    label: (row: Record<string, unknown>) => String(row.code ?? "Bank order"),
    bankIdOf: (row: Record<string, unknown>) => (row.bankId as string | null) ?? null,
  },
  verification: {
    table: verifications,
    label: (row: Record<string, unknown>) => String(row.providerReference ?? "Verification"),
    bankIdOf: (row: Record<string, unknown>) => (row.bankId as string | null) ?? null,
  },
  disbursement: {
    table: disbursements,
    label: (row: Record<string, unknown>) => String(row.code ?? row.utr ?? "Disbursement"),
    bankIdOf: (row: Record<string, unknown>) => (row.bankId as string | null) ?? null,
  },
  settlement: {
    table: settlements,
    label: (row: Record<string, unknown>) => String(row.code ?? row.invoiceNo ?? "Settlement"),
    bankIdOf: (row: Record<string, unknown>) => (row.bankId as string | null) ?? null,
  },
  transaction: {
    table: transactions,
    label: (row: Record<string, unknown>) => String(row.code ?? row.reference ?? "Transaction"),
    bankIdOf: (row: Record<string, unknown>) => (row.bankId as string | null) ?? null,
  },
  ledger_entry: {
    table: ledgerEntries,
    label: (row: Record<string, unknown>) => String(row.voucherNo ?? row.code ?? "Ledger entry"),
    bankIdOf: (row: Record<string, unknown>) => (row.bankId as string | null) ?? null,
  },
  document: {
    table: documents,
    label: (row: Record<string, unknown>) => String(row.fileName ?? "Document"),
    bankIdOf: (row: Record<string, unknown>) => (row.bankId as string | null) ?? null,
  },
  funding_source: {
    table: fundingSources,
    label: (row: Record<string, unknown>) => String(row.name ?? "Funding source"),
    bankIdOf: (row: Record<string, unknown>) => (row.bankId as string | null) ?? null,
  },
  service_provider: {
    table: serviceProviders,
    label: (row: Record<string, unknown>) => String(row.name ?? "Service provider"),
    bankIdOf: () => null,
  },
} as const;

export type BinRecordType = keyof typeof BIN_REGISTRY;

export const isBinRecordType = (value: string): value is BinRecordType => value in BIN_REGISTRY;

export function purgeDate(): Date {
  const days = env().RECYCLE_BIN_RETENTION_DAYS;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/**
 * Soft delete: the row stays put with `deleted_at` set and an index entry is
 * written to the Bin. Runs in a transaction so a record can never be marked
 * deleted without a corresponding, restorable Bin entry.
 */
export async function softDelete(
  db: Database,
  ctx: AuthContext,
  req: Request | null,
  recordType: BinRecordType,
  recordId: string,
): Promise<void> {
  const entry = BIN_REGISTRY[recordType];
  const table = entry.table;

  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(table)
      .where(and(eq(table.id, recordId), isNull(table.deletedAt)))
      .limit(1);

    if (!row) throw notFound(`${recordType} not found`);

    const now = new Date();
    const purgeAfter = purgeDate();

    await tx
      .update(table)
      .set({ deletedAt: now, deletedBy: ctx.userId, purgeAfter })
      .where(eq(table.id, recordId));

    await tx.insert(recycleBinEntries).values({
      recordType,
      recordId,
      bankId: entry.bankIdOf(row as Record<string, unknown>),
      label: entry.label(row as Record<string, unknown>),
      snapshot: row as never,
      deletedAt: now,
      deletedBy: ctx.userId,
      purgeAfter,
    });

    await recordAudit(tx as unknown as Database, ctx, req, {
      action: "deleted",
      recordType,
      recordId,
      bankId: entry.bankIdOf(row as Record<string, unknown>),
      summary: `Moved ${entry.label(row as Record<string, unknown>)} to the recycle bin`,
    });
  });
}

export async function restore(
  db: Database,
  ctx: AuthContext,
  req: Request | null,
  binEntryId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(recycleBinEntries)
      .where(
        and(
          eq(recycleBinEntries.id, binEntryId),
          isNull(recycleBinEntries.restoredAt),
          isNull(recycleBinEntries.purgedAt),
        ),
      )
      .limit(1);

    if (!entry) throw notFound("Recycle bin entry not found");
    if (!isBinRecordType(entry.recordType)) throw conflict("Unsupported record type");

    const table = BIN_REGISTRY[entry.recordType].table;

    await tx
      .update(table)
      .set({ deletedAt: null, deletedBy: null, purgeAfter: null, updatedBy: ctx.userId })
      .where(eq(table.id, entry.recordId));

    await tx
      .update(recycleBinEntries)
      .set({ restoredAt: new Date(), restoredBy: ctx.userId })
      .where(eq(recycleBinEntries.id, binEntryId));

    await recordAudit(tx as unknown as Database, ctx, req, {
      action: "restored",
      recordType: entry.recordType,
      recordId: entry.recordId,
      bankId: entry.bankId,
      summary: `Restored ${entry.label} from the recycle bin`,
    });
  });
}

/**
 * Hard delete. The Bin entry itself is retained and marked `purged_at` so the
 * audit trail still shows the record existed, who deleted it and who purged it,
 * even though the row is gone. The brief's "do not silently destroy financial
 * history" requirement is met by that retained entry plus the audit log.
 */
export async function permanentDelete(
  db: Database,
  ctx: AuthContext,
  req: Request | null,
  binEntryId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(recycleBinEntries)
      .where(and(eq(recycleBinEntries.id, binEntryId), isNull(recycleBinEntries.purgedAt)))
      .limit(1);

    if (!entry) throw notFound("Recycle bin entry not found");
    if (!isBinRecordType(entry.recordType)) throw conflict("Unsupported record type");

    const table = BIN_REGISTRY[entry.recordType].table;

    await tx.delete(table).where(eq(table.id, entry.recordId));

    await tx
      .update(recycleBinEntries)
      .set({ purgedAt: new Date(), purgedBy: ctx.userId })
      .where(eq(recycleBinEntries.id, binEntryId));

    await recordAudit(tx as unknown as Database, ctx, req, {
      action: "permanently_deleted",
      recordType: entry.recordType,
      recordId: entry.recordId,
      bankId: entry.bankId,
      summary: `Permanently deleted ${entry.label}`,
      metadata: { retainedSnapshot: true },
    });
  });
}

/** Rows whose retention window has elapsed. Driven by a scheduled job. */
export async function expiredEntries(db: Database) {
  return db
    .select()
    .from(recycleBinEntries)
    .where(
      and(
        isNull(recycleBinEntries.restoredAt),
        isNull(recycleBinEntries.purgedAt),
        sql`${recycleBinEntries.purgeAfter} < now()`,
      ),
    );
}
