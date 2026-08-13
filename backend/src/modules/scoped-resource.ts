import { Router } from "express";
import { and, count, desc, eq, ilike, isNull, or, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { notFound } from "../lib/errors.js";
import { authOf, requireAuth, requirePermission } from "../middleware/auth.js";
import { assertBankAccess, bankScope } from "../services/access.js";
import { diff, recordAudit } from "../services/audit.js";
import { softDelete, type BinRecordType } from "../services/recycle-bin.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ScopedResourceConfig<TCreate extends z.ZodTypeAny> {
  /** Drizzle table. Must carry id, bank_id and the soft-delete columns. */
  table: PgTable & Record<string, any>;
  /** Key in the recycle-bin registry. */
  recordType: BinRecordType;
  permissions: {
    view: string;
    create: string;
    edit: string;
    delete?: string;
    approve?: string;
  };
  createSchema: TCreate;
  /** Columns matched by the `search` query parameter. */
  searchable?: string[];
  /** Columns exposed as exact-match query parameters. */
  filterable?: string[];
  /** Numeric columns — Drizzle wants strings for `numeric`, the API takes numbers. */
  numericFields?: string[];
  /** Generates the human-readable code (LN-1001, DSB-5001, ...). */
  codePrefix?: string;
  codeStart?: number;
  /** Column the ordering is applied to. Defaults to created_at. */
  orderColumn?: string;
  /** Runs inside create/update before the write. Use for cross-record checks. */
  beforeWrite?: (
    input: Record<string, any>,
    context: { db: ReturnType<typeof getDb>; ctx: ReturnType<typeof authOf>; existing?: any },
  ) => Promise<void> | void;
  /** Human label for audit summaries. */
  label?: (row: Record<string, any>) => string;
}

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(25),
  search: z.string().trim().max(160).optional(),
  bankId: z.string().uuid().optional(),
});

function stringifyNumerics(
  input: Record<string, any>,
  fields: string[] | undefined,
): Record<string, any> {
  if (!fields?.length) return input;
  const out = { ...input };
  for (const field of fields) {
    if (out[field] !== undefined && out[field] !== null) out[field] = String(out[field]);
  }
  return out;
}

/**
 * Builds a router whose every handler goes through the same four gates:
 * authenticate -> permission -> bank scope -> audit.
 *
 * Writing ten of these by hand is how one resource ends up missing its scope
 * filter. The factory makes that failure mode structurally impossible: there is
 * exactly one place the WHERE clause is assembled.
 */
export function createScopedResource<TCreate extends z.ZodTypeAny>(
  config: ScopedResourceConfig<TCreate>,
): Router {
  const router = Router();
  router.use(requireAuth);

  const table = config.table;
  const bankColumn = table.bankId as PgColumn;
  const idColumn = table.id as PgColumn;
  const deletedAtColumn = table.deletedAt as PgColumn;
  const orderColumn = (table[config.orderColumn ?? "createdAt"] ?? table.createdAt) as PgColumn;
  const labelOf = config.label ?? ((row) => String(row.code ?? row.name ?? config.recordType));

  async function nextCode(): Promise<string | undefined> {
    if (!config.codePrefix) return undefined;
    const [row] = await getDb().select({ total: count() }).from(table);
    return `${config.codePrefix}-${(config.codeStart ?? 1000) + (row?.total ?? 0) + 1}`;
  }

  /** The single choke point. Every read passes through here. */
  function scopedWhere(req: Parameters<typeof authOf>[0], extra: SQL[] = []): SQL | undefined {
    const ctx = authOf(req);
    const filters: SQL[] = [isNull(deletedAtColumn), ...extra];
    const scope = bankScope(ctx, bankColumn);
    if (scope) filters.push(scope);
    return and(...filters);
  }

  router.get("/", requirePermission(config.permissions.view), async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const query = listQuery.parse(req.query);
      const db = getDb();
      const extra: SQL[] = [];

      if (query.bankId) {
        // A client filter can narrow the scope; it can never widen it.
        assertBankAccess(ctx, query.bankId);
        extra.push(eq(bankColumn, query.bankId));
      }

      for (const field of config.filterable ?? []) {
        const value = req.query[field];
        if (typeof value === "string" && value.length > 0) {
          extra.push(eq(table[field] as PgColumn, value));
        }
      }

      if (query.search && config.searchable?.length) {
        const needle = `%${query.search}%`;
        const match = or(
          ...config.searchable.map((field) => ilike(table[field] as PgColumn, needle)),
        );
        if (match) extra.push(match);
      }

      const where = scopedWhere(req, extra);
      const [{ total = 0 } = {}] = await db.select({ total: count() }).from(table).where(where);
      const rows = await db
        .select()
        .from(table)
        .where(where)
        .orderBy(desc(orderColumn))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);

      res.json({
        data: rows,
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.ceil(total / query.pageSize),
          scoped: ctx.bankIds !== null,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", requirePermission(config.permissions.view), async (req, res, next) => {
    try {
      const [row] = await getDb()
        .select()
        .from(table)
        .where(scopedWhere(req, [eq(idColumn, req.params.id as string)]))
        .limit(1);
      // Out of scope and non-existent are indistinguishable by design.
      if (!row) throw notFound(`${config.recordType} not found`);
      res.json({ data: row });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", requirePermission(config.permissions.create), async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const parsed = config.createSchema.parse(req.body) as Record<string, any>;
      const db = getDb();

      // Asserted against the *payload*, so a hand-crafted bankId is rejected.
      assertBankAccess(ctx, parsed.bankId);
      await config.beforeWrite?.(parsed, { db, ctx });

      const code = await nextCode();
      const [created] = await db
        .insert(table)
        .values({
          ...stringifyNumerics(parsed, config.numericFields),
          ...(code ? { code } : {}),
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning();

      await recordAudit(db, ctx, req, {
        action: "created",
        recordType: config.recordType,
        recordId: (created as any)?.id,
        bankId: parsed.bankId,
        summary: `Created ${config.recordType} ${labelOf(created as any)}`,
      });

      res.status(201).json({ data: created });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id", requirePermission(config.permissions.edit), async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const id = req.params.id as string;
      const parsed = (config.createSchema as any).partial().parse(req.body) as Record<string, any>;
      const db = getDb();

      const [before] = await db
        .select()
        .from(table)
        .where(scopedWhere(req, [eq(idColumn, id)]))
        .limit(1);
      if (!before) throw notFound(`${config.recordType} not found`);

      // Reassigning to another bank requires access to the destination too,
      // otherwise scoping could be escaped by moving a record out.
      if (parsed.bankId && parsed.bankId !== (before as any).bankId) {
        assertBankAccess(ctx, parsed.bankId);
      }
      await config.beforeWrite?.(parsed, { db, ctx, existing: before });

      const [after] = await db
        .update(table)
        .set({
          ...stringifyNumerics(parsed, config.numericFields),
          updatedAt: new Date(),
          updatedBy: ctx.userId,
        })
        .where(eq(idColumn, id))
        .returning();

      await recordAudit(db, ctx, req, {
        action: "updated",
        recordType: config.recordType,
        recordId: id,
        bankId: (after as any)?.bankId,
        summary: `Updated ${config.recordType} ${labelOf(after as any)}`,
        changes: diff(before as any, after as any),
      });

      res.json({ data: after });
    } catch (error) {
      next(error);
    }
  });

  if (config.permissions.delete) {
    router.delete("/:id", requirePermission(config.permissions.delete), async (req, res, next) => {
      try {
        const ctx = authOf(req);
        const id = req.params.id as string;
        const [row] = await getDb()
          .select({ id: idColumn })
          .from(table)
          .where(scopedWhere(req, [eq(idColumn, id)]))
          .limit(1);
        if (!row) throw notFound(`${config.recordType} not found`);

        await softDelete(getDb(), ctx, req, config.recordType, id);
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    });
  }

  if (config.permissions.approve) {
    router.post(
      "/:id/approve",
      requirePermission(config.permissions.approve),
      async (req, res, next) => {
        try {
          const ctx = authOf(req);
          const id = req.params.id as string;
          const db = getDb();

          const [before] = await db
            .select()
            .from(table)
            .where(scopedWhere(req, [eq(idColumn, id)]))
            .limit(1);
          if (!before) throw notFound(`${config.recordType} not found`);

          const status = z
            .object({ status: z.string().min(1), notes: z.string().max(1000).optional() })
            .parse(req.body);

          const [after] = await db
            .update(table)
            .set({
              status: status.status,
              ...(table.approvedBy ? { approvedBy: ctx.userId, approvedAt: new Date() } : {}),
              ...(status.notes && table.notes ? { notes: status.notes } : {}),
              updatedAt: new Date(),
              updatedBy: ctx.userId,
            })
            .where(eq(idColumn, id))
            .returning();

          await recordAudit(db, ctx, req, {
            action: "approved",
            recordType: config.recordType,
            recordId: id,
            bankId: (after as any)?.bankId,
            summary: `Set ${config.recordType} ${labelOf(after as any)} to ${status.status}`,
            changes: diff(before as any, after as any),
          });

          res.json({ data: after });
        } catch (error) {
          next(error);
        }
      },
    );
  }

  return router;
}
