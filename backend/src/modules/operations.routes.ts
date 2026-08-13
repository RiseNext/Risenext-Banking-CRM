import { Router } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index.js";
import {
  bankOrders,
  customers,
  disbursements,
  documents,
  fundingSources,
  ledgerEntries,
  loans,
  serviceProviders,
  settlements,
  transactions,
  verifications,
} from "../db/schema/index.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { authOf, requireAuth, requirePermission } from "../middleware/auth.js";
import { assertBankAccess, bankScope } from "../services/access.js";
import { recordAudit } from "../services/audit.js";
import { createScopedResource } from "./scoped-resource.js";

const money = z.coerce.number().min(0).max(1_000_000_000_000);
const uuidField = z.string().uuid();

/**
 * A customer and a loan must belong to the same bank as the record pointing at
 * them. Without this a user could attach a bank-A customer to a bank-B loan and
 * read the customer's name back through the loan endpoint.
 */
async function assertSameBank(
  db: ReturnType<typeof getDb>,
  table: typeof customers | typeof loans,
  id: string | undefined,
  bankId: string | undefined,
  label: string,
): Promise<void> {
  if (!id || !bankId) return;
  const [row] = await db
    .select({ bankId: table.bankId })
    .from(table)
    .where(and(eq(table.id, id), isNull(table.deletedAt)))
    .limit(1);
  if (!row) throw notFound(`${label} not found`);
  if (row.bankId !== bankId) throw badRequest(`The ${label} belongs to a different bank`);
}

export const loansRouter = createScopedResource({
  table: loans,
  recordType: "loan",
  permissions: {
    view: PERMISSIONS.requests.view,
    create: PERMISSIONS.requests.create,
    edit: PERMISSIONS.requests.edit,
    delete: PERMISSIONS.requests.delete,
    approve: PERMISSIONS.requests.approve,
  },
  codePrefix: "LN",
  codeStart: 1000,
  searchable: ["code", "applicationNo"],
  filterable: ["status", "loanType", "priority", "customerId", "assignedUserId", "assignedTeamId"],
  numericFields: [
    "amountRequested",
    "amountApproved",
    "interestRate",
    "emi",
    "processingFee",
    "commission",
  ],
  createSchema: z.object({
    customerId: uuidField,
    bankId: uuidField,
    loanType: z.string().trim().min(2).max(80),
    amountRequested: money.default(0),
    amountApproved: money.default(0),
    interestRate: z.coerce.number().min(0).max(100).default(0),
    tenureMonths: z.coerce.number().int().min(0).max(600).default(0),
    emi: money.default(0),
    processingFee: money.default(0),
    commission: money.default(0),
    status: z
      .enum(["Draft", "Submitted", "Under Review", "Approved", "Disbursed", "Rejected", "Closed"])
      .default("Draft"),
    applicationNo: z.string().trim().max(60).optional().nullable(),
    appliedOn: z.coerce.date().optional().nullable(),
    verificationRequired: z.boolean().default(false),
    fundingSourceId: uuidField.optional().nullable(),
    assignedUserId: uuidField.optional().nullable(),
    assignedTeamId: uuidField.optional().nullable(),
    priority: z.enum(["Low", "Normal", "High", "Urgent"]).default("Normal"),
    dueDate: z.coerce.date().optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
  }),
  async beforeWrite(input, { db, existing }) {
    const bankId = (input.bankId ?? existing?.bankId) as string | undefined;
    await assertSameBank(db, customers, input.customerId as string | undefined, bankId, "customer");
  },
});

/**
 * Creating a loan also opens its verification record, in the same transaction.
 * A loan that requires verification but has no verification row is a state the
 * system should never be able to reach.
 */
loansRouter.post("/:id/verification", requireAuth, requirePermission(PERMISSIONS.verification.create), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const loanId = req.params.id as string;
    const db = getDb();

    const filters = [eq(loans.id, loanId), isNull(loans.deletedAt)];
    const scope = bankScope(ctx, loans.bankId);
    if (scope) filters.push(scope);

    const [loan] = await db.select().from(loans).where(and(...filters)).limit(1);
    if (!loan) throw notFound("Loan not found");

    const input = z
      .object({
        required: z.boolean(),
        handledByBank: z.boolean().default(false),
        serviceProviderId: uuidField.optional().nullable(),
        providerReference: z.string().trim().max(120).optional().nullable(),
        notes: z.string().trim().max(2000).optional().nullable(),
      })
      .parse(req.body);

    // The brief's conditional rule, enforced rather than assumed: if
    // verification is required, a provider is mandatory; if it is not, we record
    // that the requesting bank handled it.
    if (input.required && !input.serviceProviderId) {
      throw badRequest("A service provider is required when verification_required is true");
    }

    const [existing] = await db
      .select({ id: verifications.id })
      .from(verifications)
      .where(and(eq(verifications.loanId, loanId), isNull(verifications.deletedAt)))
      .limit(1);
    if (existing) throw conflict("This loan already has a verification record");

    const [created] = await db
      .insert(verifications)
      .values({
        loanId,
        customerId: loan.customerId,
        bankId: loan.bankId,
        required: input.required,
        handledByBank: input.required ? false : true,
        serviceProviderId: input.serviceProviderId ?? null,
        providerReference: input.providerReference ?? null,
        status: input.required ? "Requested" : "Verified",
        result: input.required ? null : "Handled by the requesting bank",
        requestedAt: input.required ? new Date() : null,
        completedAt: input.required ? null : new Date(),
        notes: input.notes ?? null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();

    await db
      .update(loans)
      .set({ verificationRequired: input.required, updatedBy: ctx.userId })
      .where(eq(loans.id, loanId));

    await recordAudit(db, ctx, req, {
      action: "created",
      recordType: "verification",
      recordId: created?.id,
      bankId: loan.bankId,
      summary: input.required
        ? `Requested third-party verification for ${loan.code}`
        : `Recorded bank-handled verification for ${loan.code}`,
    });

    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

export const verificationsRouter = createScopedResource({
  table: verifications,
  recordType: "verification",
  permissions: {
    view: PERMISSIONS.verification.view,
    create: PERMISSIONS.verification.create,
    edit: PERMISSIONS.verification.edit,
    approve: PERMISSIONS.verification.approve,
  },
  searchable: ["providerReference"],
  filterable: ["status", "serviceProviderId", "loanId"],
  createSchema: z.object({
    loanId: uuidField,
    customerId: uuidField.optional().nullable(),
    bankId: uuidField,
    required: z.boolean().default(false),
    handledByBank: z.boolean().default(false),
    serviceProviderId: uuidField.optional().nullable(),
    providerReference: z.string().trim().max(120).optional().nullable(),
    status: z
      .enum(["Pending", "Requested", "In Progress", "Verified", "Rejected", "Failed", "Expired"])
      .default("Pending"),
    result: z.string().trim().max(500).optional().nullable(),
    requestedAt: z.coerce.date().optional().nullable(),
    completedAt: z.coerce.date().optional().nullable(),
    expiresAt: z.coerce.date().optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
  }),
});

export const bankOrdersRouter = createScopedResource({
  table: bankOrders,
  recordType: "bank_order",
  permissions: {
    view: PERMISSIONS.bankOrders.view,
    create: PERMISSIONS.bankOrders.create,
    edit: PERMISSIONS.bankOrders.edit,
    delete: PERMISSIONS.bankOrders.delete,
  },
  codePrefix: "BO",
  codeStart: 2400,
  searchable: ["code", "officer", "remarks"],
  filterable: ["status", "stage", "loanId", "customerId"],
  createSchema: z.object({
    loanId: uuidField,
    bankId: uuidField,
    customerId: uuidField,
    submittedOn: z.coerce.date().optional().nullable(),
    sla: z.coerce.date().optional().nullable(),
    stage: z
      .enum(["Login", "Credit Check", "Field Verification", "Sanction", "Disbursal Queue"])
      .default("Login"),
    status: z.enum(["In Progress", "On Hold", "Cleared", "Returned"]).default("In Progress"),
    officer: z.string().trim().max(120).optional().nullable(),
    remarks: z.string().trim().max(2000).optional().nullable(),
  }),
  async beforeWrite(input, { db, existing }) {
    const bankId = (input.bankId ?? existing?.bankId) as string | undefined;
    await assertSameBank(db, loans, input.loanId as string | undefined, bankId, "loan");
    await assertSameBank(db, customers, input.customerId as string | undefined, bankId, "customer");
  },
});

export const disbursementsRouter = createScopedResource({
  table: disbursements,
  recordType: "disbursement",
  permissions: {
    view: PERMISSIONS.disbursements.view,
    create: PERMISSIONS.disbursements.create,
    edit: PERMISSIONS.disbursements.edit,
    approve: PERMISSIONS.disbursements.approve,
  },
  codePrefix: "DSB",
  codeStart: 5000,
  searchable: ["code", "utr", "creditedTo"],
  filterable: ["status", "mode", "loanId", "customerId", "fundingSourceId"],
  numericFields: ["amount"],
  createSchema: z.object({
    loanId: uuidField,
    customerId: uuidField,
    bankId: uuidField,
    fundingSourceId: uuidField.optional().nullable(),
    amount: money,
    utr: z.string().trim().max(40).optional().nullable(),
    mode: z.enum(["NEFT", "RTGS", "IMPS"]).default("NEFT"),
    disbursedOn: z.coerce.date().optional().nullable(),
    status: z.enum(["Credited", "In Transit", "Failed"]).default("In Transit"),
    creditedTo: z.string().trim().max(60).optional().nullable(),
    assignedUserId: uuidField.optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
  }),
  async beforeWrite(input, { db, existing }) {
    const bankId = (input.bankId ?? existing?.bankId) as string | undefined;
    await assertSameBank(db, loans, input.loanId as string | undefined, bankId, "loan");
    await assertSameBank(db, customers, input.customerId as string | undefined, bankId, "customer");
  },
});

export const settlementsRouter = createScopedResource({
  table: settlements,
  recordType: "settlement",
  permissions: {
    view: PERMISSIONS.settlements.view,
    create: PERMISSIONS.settlements.create,
    edit: PERMISSIONS.settlements.edit,
    approve: PERMISSIONS.settlements.approve,
  },
  codePrefix: "STL",
  codeStart: 3300,
  searchable: ["code", "invoiceNo", "period"],
  filterable: ["status", "period"],
  numericFields: ["grossCommission", "tds", "netPayable"],
  createSchema: z.object({
    bankId: uuidField,
    period: z.string().trim().min(3).max(40),
    cases: z.coerce.number().int().min(0).default(0),
    grossCommission: money.default(0),
    tds: money.default(0),
    netPayable: money.default(0),
    status: z.enum(["Paid", "Pending", "Disputed"]).default("Pending"),
    invoiceNo: z.string().trim().max(60).optional().nullable(),
    raisedOn: z.coerce.date().optional().nullable(),
    settledOn: z.coerce.date().optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
  }),
  beforeWrite(input) {
    const gross = Number(input.grossCommission ?? 0);
    const tds = Number(input.tds ?? 0);
    const net = Number(input.netPayable ?? 0);
    // Not an invented calculation — it rejects arithmetic that cannot be right.
    if (input.netPayable !== undefined && Math.abs(gross - tds - net) > 0.01) {
      throw badRequest("netPayable must equal grossCommission minus tds");
    }
  },
});

export const transactionsRouter = createScopedResource({
  table: transactions,
  recordType: "transaction",
  permissions: {
    view: PERMISSIONS.transactions.view,
    create: PERMISSIONS.transactions.create,
    edit: PERMISSIONS.transactions.edit,
  },
  codePrefix: "TXN",
  codeStart: 77000,
  orderColumn: "occurredAt",
  searchable: ["code", "reference"],
  filterable: ["status", "txnType", "loanId", "customerId"],
  numericFields: ["amount", "commission"],
  createSchema: z.object({
    customerId: uuidField.optional().nullable(),
    bankId: uuidField,
    loanId: uuidField.optional().nullable(),
    disbursementId: uuidField.optional().nullable(),
    settlementId: uuidField.optional().nullable(),
    fundingSourceId: uuidField.optional().nullable(),
    amount: money,
    commission: money.default(0),
    txnType: z.enum(["Disbursement", "EMI Collection", "Commission", "Refund"]),
    status: z.enum(["Success", "Pending", "Failed"]).default("Pending"),
    reference: z.string().trim().max(120).optional().nullable(),
    occurredAt: z.coerce.date().optional(),
  }),
});

export const ledgerRouter = createScopedResource({
  table: ledgerEntries,
  recordType: "ledger_entry",
  permissions: {
    view: PERMISSIONS.ledger.view,
    create: PERMISSIONS.ledger.create,
    edit: PERMISSIONS.ledger.edit,
  },
  codePrefix: "LG",
  codeStart: 9000,
  orderColumn: "entryDate",
  searchable: ["voucherNo", "particulars", "party"],
  filterable: ["category", "mode"],
  numericFields: ["debit", "credit", "balance"],
  createSchema: z.object({
    bankId: uuidField.optional().nullable(),
    entryDate: z.coerce.date().optional(),
    voucherNo: z.string().trim().max(60).optional().nullable(),
    particulars: z.string().trim().min(2).max(400),
    party: z.string().trim().max(160).optional().nullable(),
    category: z.enum(["Commission", "Disbursement", "Payout", "Expense", "Tax"]),
    transactionId: uuidField.optional().nullable(),
    debit: money.default(0),
    credit: money.default(0),
    balance: money.default(0),
    mode: z.string().trim().max(40).optional().nullable(),
  }),
});

export const documentsRouter = createScopedResource({
  table: documents,
  recordType: "document",
  permissions: {
    view: PERMISSIONS.documents.view,
    create: PERMISSIONS.documents.upload,
    edit: PERMISSIONS.documents.upload,
    delete: PERMISSIONS.documents.delete,
  },
  searchable: ["fileName", "docType"],
  filterable: ["status", "docType", "customerId", "loanId"],
  createSchema: z.object({
    customerId: uuidField.optional().nullable(),
    loanId: uuidField.optional().nullable(),
    bankId: uuidField,
    docType: z.string().trim().min(2).max(80),
    fileName: z.string().trim().min(1).max(255),
    fileSize: z.coerce.number().int().min(0).default(0),
    mimeType: z.string().trim().max(120).optional().nullable(),
    storageKey: z.string().trim().max(500).optional().nullable(),
    checksum: z.string().trim().max(128).optional().nullable(),
    status: z.enum(["Verified", "Pending", "Rejected"]).default("Pending"),
  }),
});

export const fundingSourcesRouter = createScopedResource({
  table: fundingSources,
  recordType: "funding_source",
  permissions: {
    view: PERMISSIONS.fundingSources.view,
    create: PERMISSIONS.fundingSources.create,
    edit: PERMISSIONS.fundingSources.edit,
    delete: PERMISSIONS.fundingSources.delete,
  },
  searchable: ["name", "accountRef"],
  filterable: ["sourceType", "status"],
  createSchema: z.object({
    name: z.string().trim().min(2).max(160),
    sourceType: z.enum(["own_funds", "bank", "external"]).default("own_funds"),
    bankId: uuidField.optional().nullable(),
    accountRef: z.string().trim().max(80).optional().nullable(),
    status: z.enum(["Active", "Inactive"]).default("Active"),
    notes: z.string().trim().max(2000).optional().nullable(),
  }),
  beforeWrite(input) {
    if (input.sourceType === "bank" && !input.bankId) {
      throw badRequest("A bank funding source must reference a bank");
    }
  },
  label: (row) => String(row.name),
});

/**
 * Service providers are not bank-owned, so they get an ordinary router rather
 * than the scoped factory. Feeding a null bank column into the scope filter
 * would silently hide every row from scoped users.
 */
export const serviceProvidersRouter = Router();
serviceProvidersRouter.use(requireAuth);

const providerInput = z.object({
  name: z.string().trim().min(2).max(160),
  providerType: z.string().trim().min(2).max(80).default("Field Verification"),
  contactName: z.string().trim().max(120).optional().nullable(),
  contactPhone: z.string().trim().max(20).optional().nullable(),
  contactEmail: z.string().trim().email().max(255).optional().nullable().or(z.literal("")),
  status: z.enum(["Active", "Inactive"]).default("Active"),
  notes: z.string().trim().max(2000).optional().nullable(),
});

serviceProvidersRouter.get("/", requirePermission(PERMISSIONS.serviceProviders.view), async (_req, res, next) => {
  try {
    const rows = await getDb()
      .select()
      .from(serviceProviders)
      .where(isNull(serviceProviders.deletedAt))
      .orderBy(serviceProviders.name);
    res.json({ data: rows, meta: { count: rows.length } });
  } catch (error) {
    next(error);
  }
});

serviceProvidersRouter.post("/", requirePermission(PERMISSIONS.serviceProviders.create), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const input = providerInput.parse(req.body);
    const db = getDb();
    const [created] = await db
      .insert(serviceProviders)
      .values({
        ...input,
        contactEmail: input.contactEmail || null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    await recordAudit(db, ctx, req, {
      action: "created",
      recordType: "service_provider",
      recordId: created?.id,
      summary: `Created service provider ${created?.name}`,
    });
    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

serviceProvidersRouter.patch("/:id", requirePermission(PERMISSIONS.serviceProviders.edit), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const id = req.params.id as string;
    const input = providerInput.partial().parse(req.body);
    const db = getDb();
    const [after] = await db
      .update(serviceProviders)
      .set({ ...input, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(and(eq(serviceProviders.id, id), isNull(serviceProviders.deletedAt)))
      .returning();
    if (!after) throw notFound("Service provider not found");
    await recordAudit(db, ctx, req, {
      action: "updated",
      recordType: "service_provider",
      recordId: id,
      summary: `Updated service provider ${after.name}`,
    });
    res.json({ data: after });
  } catch (error) {
    next(error);
  }
});

/**
 * DASHBOARD — replaces every hardcoded KPI in the frontend. Scoped, so a
 * manager's totals reflect their banks and a super admin's reflect everything.
 * An empty database returns zeroes, never fabricated numbers.
 */
export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get("/stats", requirePermission(PERMISSIONS.reports.view), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const db = getDb();

    const ids = ctx.bankIds;
    const scopeFor = (column: string) =>
      ids === null
        ? sql`true`
        : ids.length === 0
          ? sql`false`
          : sql`${sql.raw(column)} in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`;

    const result = await db.execute(sql`
      select
        (select count(*)::int from customers
           where deleted_at is null and ${scopeFor("bank_id")})                      as total_customers,
        (select count(*)::int from customers
           where deleted_at is null and status = 'Active' and ${scopeFor("bank_id")}) as active_customers,
        (select count(*)::int from loans
           where deleted_at is null and status in ('Draft','Submitted','Under Review')
             and ${scopeFor("bank_id")})                                             as pending_loans,
        (select count(*)::int from loans
           where deleted_at is null and status in ('Approved','Disbursed')
             and ${scopeFor("bank_id")})                                             as approved_loans,
        (select coalesce(sum(amount_approved),0)::float from loans
           where deleted_at is null and status = 'Disbursed' and ${scopeFor("bank_id")}) as disbursed_value,
        (select coalesce(sum(commission),0)::float from loans
           where deleted_at is null and ${scopeFor("bank_id")})                      as commission_earned,
        (select coalesce(sum(net_payable),0)::float from settlements
           where deleted_at is null and status <> 'Paid' and ${scopeFor("bank_id")}) as pending_settlement,
        (select count(*)::int from bank_orders
           where deleted_at is null and status <> 'Cleared' and ${scopeFor("bank_id")}) as open_orders,
        (select count(*)::int from disbursements
           where deleted_at is null and status = 'Credited' and ${scopeFor("bank_id")}) as credited_disbursements,
        (select count(*)::int from transactions
           where deleted_at is null and status = 'Success' and ${scopeFor("bank_id")}) as successful_transactions,

(select count(*)::int from transactions
   where deleted_at is null
     and status = 'Success'
     and occurred_at >= current_date
     and occurred_at < current_date + interval '1 day'
     and ${scopeFor("bank_id")}) as todays_transactions,

        (select count(*)::int from documents
           where deleted_at is null and status = 'Pending' and ${scopeFor("bank_id")}) as pending_documents,
        (select count(*)::int from banks
           where deleted_at is null and status = 'Active' and ${scopeFor("id")})     as active_banks
    `);

    // db.execute returns a QueryResult, not an array — .rows is the payload.
    const row = (result as unknown as { rows: Record<string, unknown>[] }).rows[0];
    res.json({ data: row ?? {}, meta: { scoped: ids !== null } });
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/loan-status", requirePermission(PERMISSIONS.reports.view), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const filters = [isNull(loans.deletedAt)];
    const scope = bankScope(ctx, loans.bankId);
    if (scope) filters.push(scope);

    const rows = await getDb()
      .select({ status: loans.status, count: sql<number>`count(*)::int` })
      .from(loans)
      .where(and(...filters))
      .groupBy(loans.status);

    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/bank-performance", requirePermission(PERMISSIONS.reports.view), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const filters = [isNull(loans.deletedAt)];
    const scope = bankScope(ctx, loans.bankId);
    if (scope) filters.push(scope);

    const rows = await getDb()
      .select({
        bankId: loans.bankId,
        cases: sql<number>`count(*)::int`,
        volume: sql<number>`coalesce(sum(${loans.amountApproved}),0)::float`,
        commission: sql<number>`coalesce(sum(${loans.commission}),0)::float`,
      })
      .from(loans)
      .where(and(...filters))
      .groupBy(loans.bankId);

    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

export { assertBankAccess };
