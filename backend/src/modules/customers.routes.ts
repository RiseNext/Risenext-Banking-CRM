import { Router } from "express";
import { and, count, desc, eq, ilike, isNull, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { banks, customers } from "../db/schema/index.js";
import { conflict, notFound } from "../lib/errors.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { peppered } from "../lib/password.js";
import { env } from "../config/env.js";
import { authOf, requireAuth, requirePermission } from "../middleware/auth.js";
import { assertBankAccess, bankScope } from "../services/access.js";
import { diff, recordAudit } from "../services/audit.js";
import { softDelete } from "../services/recycle-bin.js";

export const customersRouter = Router();
customersRouter.use(requireAuth);

const aadhaarSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s|-/g, ""))
  .refine((v) => v === "" || /^\d{12}$/.test(v), "Aadhaar must be 12 digits");

const customerInput = z.object({
  bankId: z.string().uuid(),
  /** Required by the brief. Unique per bank, case-insensitively. */
  bankReferenceId: z.string().trim().min(1).max(64),

  name: z.string().trim().min(2).max(160),
  fatherName: z.string().trim().max(160).optional().nullable(),
  motherName: z.string().trim().max(160).optional().nullable(),
  dob: z.coerce.date().optional().nullable(),
  gender: z.enum(["Male", "Female", "Other"]).optional().nullable(),
  maritalStatus: z.enum(["Single", "Married"]).optional().nullable(),
  occupation: z.string().trim().max(120).optional().nullable(),
  monthlyIncome: z.coerce.number().min(0).max(1_000_000_000).default(0),

  mobile: z.string().trim().regex(/^\d{10}$/, "Mobile must be 10 digits"),
  altMobile: z.string().trim().regex(/^\d{10}$/).optional().nullable().or(z.literal("")),
  email: z.string().trim().email().max(255).optional().nullable().or(z.literal("")),

  address: z.string().trim().max(400).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  state: z.string().trim().max(120).optional().nullable(),
  pincode: z.string().trim().regex(/^\d{6}$/).optional().nullable().or(z.literal("")),

  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}\d{4}[A-Z]$/, "PAN format is invalid")
    .optional()
    .nullable()
    .or(z.literal("")),
  aadhaar: aadhaarSchema.optional().nullable(),

  kyc: z.enum(["Verified", "Pending", "Rejected"]).default("Pending"),
  cibil: z.coerce.number().int().min(300).max(900).optional().nullable(),

  accountNo: z.string().trim().max(40).optional().nullable(),
  ifsc: z.string().trim().toUpperCase().max(20).optional().nullable(),
  branch: z.string().trim().max(120).optional().nullable(),

  assignedUserId: z.string().uuid().optional().nullable(),
  assignedTeamId: z.string().uuid().optional().nullable(),
  status: z.enum(["Active", "Follow Up", "Closed"]).default("Active"),
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(25),
  search: z.string().trim().max(120).optional(),
  bankId: z.string().uuid().optional(),
  status: z.enum(["Active", "Follow Up", "Closed"]).optional(),
});

/** Aadhaar never lands in a column in the clear. See README > Data protection. */
function aadhaarFields(raw: string | null | undefined) {
  if (!raw) return { aadhaarHash: null, aadhaarLast4: null };
  return {
    aadhaarHash: peppered(raw, env().AADHAAR_PEPPER),
    aadhaarLast4: raw.slice(-4),
  };
}

async function nextCustomerCode(): Promise<string> {
  const [row] = await getDb().select({ total: count() }).from(customers);
  return `CUS-${10000 + (row?.total ?? 0) + 1}`;
}

customersRouter.get("/", requirePermission(PERMISSIONS.customers.view), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const query = listQuery.parse(req.query);
    const db = getDb();

    const filters: SQL[] = [isNull(customers.deletedAt)];

    // Server-side scoping. Note this runs whether or not the client sent a
    // bankId filter — a filter can narrow the scope, never widen it.
    const scope = bankScope(ctx, customers.bankId);
    if (scope) filters.push(scope);

    if (query.bankId) {
      assertBankAccess(ctx, query.bankId);
      filters.push(eq(customers.bankId, query.bankId));
    }
    if (query.status) filters.push(eq(customers.status, query.status));
    if (query.search) {
      const needle = `%${query.search}%`;
      const match = or(
        ilike(customers.name, needle),
        ilike(customers.mobile, needle),
        ilike(customers.code, needle),
        ilike(customers.bankReferenceId, needle),
      );
      if (match) filters.push(match);
    }

    const where = and(...filters);
    const [{ total = 0 } = {}] = await db.select({ total: count() }).from(customers).where(where);

    const rows = await db
      .select()
      .from(customers)
      .where(where)
      .orderBy(desc(customers.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    res.json({
      data: rows,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    });
  } catch (error) {
    next(error);
  }
});

customersRouter.get("/:id", requirePermission(PERMISSIONS.customers.view), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const filters: SQL[] = [eq(customers.id, req.params.id as string), isNull(customers.deletedAt)];
    const scope = bankScope(ctx, customers.bankId);
    if (scope) filters.push(scope);

    const [row] = await getDb()
      .select()
      .from(customers)
      .where(and(...filters))
      .limit(1);

    // Out of scope and non-existent are indistinguishable by design.
    if (!row) throw notFound("Customer not found");
    res.json({ data: row });
  } catch (error) {
    next(error);
  }
});

customersRouter.post("/", requirePermission(PERMISSIONS.customers.create), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const input = customerInput.parse(req.body);
    const db = getDb();

    // An executive cannot create a customer under a bank they are not assigned
    // to, even by hand-crafting the payload.
    assertBankAccess(ctx, input.bankId);

    const [bank] = await db
      .select({ id: banks.id, name: banks.name })
      .from(banks)
      .where(and(eq(banks.id, input.bankId), isNull(banks.deletedAt)))
      .limit(1);
    if (!bank) throw notFound("Bank not found");

    const { aadhaar, ...rest } = input;
    const [created] = await db
      .insert(customers)
      .values({
        ...rest,
        code: await nextCustomerCode(),
        monthlyIncome: String(input.monthlyIncome),
        email: input.email || null,
        altMobile: input.altMobile || null,
        pan: input.pan || null,
        pincode: input.pincode || null,
        ...aadhaarFields(aadhaar),
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();

    await recordAudit(db, ctx, req, {
      action: "created",
      recordType: "customer",
      recordId: created?.id,
      bankId: input.bankId,
      summary: `Created customer ${created?.name} (${bank.name} / ${input.bankReferenceId})`,
    });

    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

customersRouter.patch("/:id", requirePermission(PERMISSIONS.customers.edit), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const id = req.params.id as string;
    const input = customerInput.partial().parse(req.body);
    const db = getDb();
    const { aadhaar, monthlyIncome, ...rest } = input;

    const filters: SQL[] = [eq(customers.id, id), isNull(customers.deletedAt)];
    const scope = bankScope(ctx, customers.bankId);
    if (scope) filters.push(scope);

    const [before] = await db
      .select()
      .from(customers)
      .where(and(...filters))
      .limit(1);
    if (!before) throw notFound("Customer not found");

    // Moving a customer to a different bank requires access to the destination
    // too, otherwise scoping could be escaped by reassignment.
    if (input.bankId && input.bankId !== before.bankId) {
      assertBankAccess(ctx, input.bankId);
    }

    const [after] = await db
      .update(customers)
      .set({
        ...rest,
        ...(monthlyIncome !== undefined ? { monthlyIncome: String(monthlyIncome) } : {}),
        ...(aadhaar !== undefined ? aadhaarFields(aadhaar) : {}),
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(eq(customers.id, id))
      .returning();

    await recordAudit(db, ctx, req, {
      action: "updated",
      recordType: "customer",
      recordId: id,
      bankId: after?.bankId,
      summary: `Updated customer ${after?.name}`,
      changes: diff(before as Record<string, unknown>, after as Record<string, unknown>),
    });

    res.json({ data: after });
  } catch (error) {
    next(error);
  }
});

customersRouter.delete("/:id", requirePermission(PERMISSIONS.customers.delete), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const id = req.params.id as string;

    const filters: SQL[] = [eq(customers.id, id), isNull(customers.deletedAt)];
    const scope = bankScope(ctx, customers.bankId);
    if (scope) filters.push(scope);

    const [row] = await getDb()
      .select({ id: customers.id })
      .from(customers)
      .where(and(...filters))
      .limit(1);
    if (!row) throw notFound("Customer not found");

    await softDelete(getDb(), ctx, req, "customer", id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/**
 * Pre-flight check used by the create form and by Excel import validation, so
 * the user learns about a clashing reference before submitting 500 rows.
 */
customersRouter.get(
  "/check/reference",
  requirePermission(PERMISSIONS.customers.view),
  async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const params = z
        .object({ bankId: z.string().uuid(), bankReferenceId: z.string().trim().min(1) })
        .parse(req.query);

      assertBankAccess(ctx, params.bankId);

      const [existing] = await getDb()
        .select({ id: customers.id, code: customers.code })
        .from(customers)
        .where(
          and(
            eq(customers.bankId, params.bankId),
            ilike(customers.bankReferenceId, params.bankReferenceId),
            isNull(customers.deletedAt),
          ),
        )
        .limit(1);

      if (existing) {
        throw conflict("This Bank Reference ID is already used for the selected bank", {
          existingCustomerCode: existing.code,
        });
      }
      res.json({ available: true });
    } catch (error) {
      next(error);
    }
  },
);
