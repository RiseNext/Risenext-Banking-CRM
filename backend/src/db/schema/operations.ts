import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { teams, users } from "./identity.js";
import { banks, customers } from "./domain.js";

/** Columns every operational table carries. Keeps the shape uniform for the
 *  scoped-CRUD factory, the recycle bin and the audit writer. */
const lifecycle = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: uuid("deleted_by"),
  purgeAfter: timestamp("purge_after", { withTimezone: true }),
};

const money = (name: string) => numeric(name, { precision: 16, scale: 2 });

/**
 * SERVICE PROVIDERS — third-party verification agencies. Required by the brief;
 * no equivalent existed in the frontend.
 */
export const serviceProviders = pgTable(
  "service_providers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    providerType: text("provider_type").notNull().default("Field Verification"),
    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    status: text("status").notNull().default("Active"),
    notes: text("notes"),
    ...lifecycle,
  },
  (t) => [
    uniqueIndex("service_providers_name_unique")
      .on(sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
    index("service_providers_status_idx").on(t.status),
    index("service_providers_deleted_idx").on(t.deletedAt),
  ],
);

/**
 * FUNDING SOURCES — own funds, another bank, or a configured external source.
 * `bankId` is set only when the source IS a bank, so scoping still works.
 */
export const fundingSources = pgTable(
  "funding_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    sourceType: text("source_type").notNull().default("own_funds"),
    bankId: uuid("bank_id").references(() => banks.id, { onDelete: "set null" }),
    accountRef: text("account_ref"),
    status: text("status").notNull().default("Active"),
    notes: text("notes"),
    ...lifecycle,
  },
  (t) => [
    uniqueIndex("funding_sources_name_unique")
      .on(sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
    index("funding_sources_bank_idx").on(t.bankId),
    index("funding_sources_deleted_idx").on(t.deletedAt),
  ],
);

/**
 * LOANS / FUNDING REQUESTS — mirrors the frontend `Loan` interface field for
 * field, with the brief's workflow columns added alongside rather than instead.
 */
export const loans = pgTable(
  "loans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    applicationNo: text("application_no"),

    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id, { onDelete: "restrict" }),

    loanType: text("loan_type").notNull(),
    amountRequested: money("amount_requested").notNull().default("0"),
    amountApproved: money("amount_approved").notNull().default("0"),
    interestRate: numeric("interest_rate", { precision: 6, scale: 3 }).notNull().default("0"),
    tenureMonths: integer("tenure_months").notNull().default(0),
    emi: money("emi").notNull().default("0"),
    processingFee: money("processing_fee").notNull().default("0"),
    commission: money("commission").notNull().default("0"),

    status: text("status").notNull().default("Draft"),
    appliedOn: timestamp("applied_on", { withTimezone: true }),

    /** Conditional verification, per the brief. False means the requesting bank
     *  handled it themselves; the reason is recorded on the verification row. */
    verificationRequired: boolean("verification_required").notNull().default(false),
    fundingSourceId: uuid("funding_source_id").references(() => fundingSources.id, {
      onDelete: "set null",
    }),

    assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
    assignedTeamId: uuid("assigned_team_id").references(() => teams.id, { onDelete: "set null" }),
    priority: text("priority").notNull().default("Normal"),
    dueDate: timestamp("due_date", { withTimezone: true }),

    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    notes: text("notes"),
    ...lifecycle,
  },
  (t) => [
    uniqueIndex("loans_code_unique").on(t.code).where(sql`${t.deletedAt} is null`),
    index("loans_customer_idx").on(t.customerId),
    index("loans_bank_idx").on(t.bankId),
    index("loans_status_idx").on(t.status),
    index("loans_assigned_user_idx").on(t.assignedUserId),
    index("loans_assigned_team_idx").on(t.assignedTeamId),
    index("loans_due_date_idx").on(t.dueDate),
    index("loans_deleted_idx").on(t.deletedAt),
  ],
);

/**
 * VERIFICATIONS — one row per loan. Exists even when not required, so the
 * record shows *that* the requesting bank handled it rather than leaving a gap.
 */
export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loanId: uuid("loan_id")
      .notNull()
      .references(() => loans.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id, { onDelete: "restrict" }),

    required: boolean("required").notNull().default(false),
    handledByBank: boolean("handled_by_bank").notNull().default(false),

    serviceProviderId: uuid("service_provider_id").references(() => serviceProviders.id, {
      onDelete: "set null",
    }),
    providerReference: text("provider_reference"),

    status: text("status").notNull().default("Pending"),
    result: text("result"),
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    notes: text("notes"),
    ...lifecycle,
  },
  (t) => [
    uniqueIndex("verifications_loan_unique").on(t.loanId).where(sql`${t.deletedAt} is null`),
    index("verifications_bank_idx").on(t.bankId),
    index("verifications_status_idx").on(t.status),
    index("verifications_provider_idx").on(t.serviceProviderId),
  ],
);

export const bankOrders = pgTable(
  "bank_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    loanId: uuid("loan_id")
      .notNull()
      .references(() => loans.id, { onDelete: "restrict" }),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),

    submittedOn: timestamp("submitted_on", { withTimezone: true }),
    sla: timestamp("sla", { withTimezone: true }),
    stage: text("stage").notNull().default("Login"),
    status: text("status").notNull().default("In Progress"),
    officer: text("officer"),
    remarks: text("remarks"),
    ...lifecycle,
  },
  (t) => [
    uniqueIndex("bank_orders_code_unique").on(t.code).where(sql`${t.deletedAt} is null`),
    index("bank_orders_loan_idx").on(t.loanId),
    index("bank_orders_bank_idx").on(t.bankId),
    index("bank_orders_status_idx").on(t.status),
    index("bank_orders_sla_idx").on(t.sla),
  ],
);

export const disbursements = pgTable(
  "disbursements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    loanId: uuid("loan_id")
      .notNull()
      .references(() => loans.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id, { onDelete: "restrict" }),
    fundingSourceId: uuid("funding_source_id").references(() => fundingSources.id, {
      onDelete: "set null",
    }),

    amount: money("amount").notNull().default("0"),
    utr: text("utr"),
    mode: text("mode").notNull().default("NEFT"),
    disbursedOn: timestamp("disbursed_on", { withTimezone: true }),
    status: text("status").notNull().default("In Transit"),
    creditedTo: text("credited_to"),

    assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    notes: text("notes"),
    ...lifecycle,
  },
  (t) => [
    uniqueIndex("disbursements_code_unique").on(t.code).where(sql`${t.deletedAt} is null`),
    // A UTR is a bank's own unique payment reference; a duplicate almost always
    // means a double-entry, so it is rejected rather than silently accepted.
    uniqueIndex("disbursements_utr_unique")
      .on(sql`upper(${t.utr})`)
      .where(sql`${t.deletedAt} is null and ${t.utr} is not null`),
    index("disbursements_loan_idx").on(t.loanId),
    index("disbursements_bank_idx").on(t.bankId),
    index("disbursements_status_idx").on(t.status),
  ],
);

export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id, { onDelete: "restrict" }),
    period: text("period").notNull(),
    cases: integer("cases").notNull().default(0),
    grossCommission: money("gross_commission").notNull().default("0"),
    tds: money("tds").notNull().default("0"),
    netPayable: money("net_payable").notNull().default("0"),
    status: text("status").notNull().default("Pending"),
    invoiceNo: text("invoice_no"),
    raisedOn: timestamp("raised_on", { withTimezone: true }),
    settledOn: timestamp("settled_on", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    notes: text("notes"),
    ...lifecycle,
  },
  (t) => [
    uniqueIndex("settlements_code_unique").on(t.code).where(sql`${t.deletedAt} is null`),
    uniqueIndex("settlements_bank_period_unique")
      .on(t.bankId, sql`lower(${t.period})`)
      .where(sql`${t.deletedAt} is null`),
    index("settlements_status_idx").on(t.status),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "restrict" }),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id, { onDelete: "restrict" }),
    loanId: uuid("loan_id").references(() => loans.id, { onDelete: "restrict" }),
    disbursementId: uuid("disbursement_id").references(() => disbursements.id, {
      onDelete: "set null",
    }),
    settlementId: uuid("settlement_id").references(() => settlements.id, { onDelete: "set null" }),
    fundingSourceId: uuid("funding_source_id").references(() => fundingSources.id, {
      onDelete: "set null",
    }),

    amount: money("amount").notNull().default("0"),
    commission: money("commission").notNull().default("0"),
    txnType: text("txn_type").notNull(),
    status: text("status").notNull().default("Pending"),
    reference: text("reference"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    ...lifecycle,
  },
  (t) => [
    uniqueIndex("transactions_code_unique").on(t.code),
    index("transactions_customer_idx").on(t.customerId),
    index("transactions_bank_idx").on(t.bankId),
    index("transactions_loan_idx").on(t.loanId),
    index("transactions_status_idx").on(t.status),
    index("transactions_occurred_idx").on(t.occurredAt),
  ],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    entryDate: timestamp("entry_date", { withTimezone: true }).notNull().defaultNow(),
    voucherNo: text("voucher_no"),
    particulars: text("particulars").notNull(),
    party: text("party"),
    category: text("category").notNull(),
    bankId: uuid("bank_id").references(() => banks.id, { onDelete: "set null" }),
    transactionId: uuid("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    debit: money("debit").notNull().default("0"),
    credit: money("credit").notNull().default("0"),
    /** Running balance is stored for display parity with the frontend, but it is
     *  recomputed inside the same transaction that inserts the row. */
    balance: money("balance").notNull().default("0"),
    mode: text("mode"),
    ...lifecycle,
  },
  (t) => [
    uniqueIndex("ledger_entries_code_unique").on(t.code),
    index("ledger_entries_date_idx").on(t.entryDate),
    index("ledger_entries_category_idx").on(t.category),
    index("ledger_entries_bank_idx").on(t.bankId),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
    loanId: uuid("loan_id").references(() => loans.id, { onDelete: "cascade" }),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id, { onDelete: "restrict" }),

    docType: text("doc_type").notNull(),
    fileName: text("file_name").notNull(),
    fileSize: integer("file_size").notNull().default(0),
    mimeType: text("mime_type"),
    /** Object-store key. No file bytes are kept in Postgres. */
    storageKey: text("storage_key"),
    checksum: text("checksum"),

    status: text("status").notNull().default("Pending"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    verifiedBy: uuid("verified_by").references(() => users.id, { onDelete: "set null" }),
    ...lifecycle,
  },
  (t) => [
    index("documents_customer_idx").on(t.customerId),
    index("documents_loan_idx").on(t.loanId),
    index("documents_bank_idx").on(t.bankId),
    index("documents_status_idx").on(t.status),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    message: text("message").notNull(),
    severity: text("severity").notNull().default("info"),
    read: boolean("read").notNull().default(false),
    linkHref: text("link_href"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId),
    index("notifications_read_idx").on(t.userId, t.read),
  ],
);

/** Every reassignment is kept, so "who had this and when" is answerable. */
export const assignmentHistory = pgTable(
  "assignment_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recordType: text("record_type").notNull(),
    recordId: uuid("record_id").notNull(),
    bankId: uuid("bank_id"),
    fromUserId: uuid("from_user_id").references(() => users.id, { onDelete: "set null" }),
    toUserId: uuid("to_user_id").references(() => users.id, { onDelete: "set null" }),
    fromTeamId: uuid("from_team_id").references(() => teams.id, { onDelete: "set null" }),
    toTeamId: uuid("to_team_id").references(() => teams.id, { onDelete: "set null" }),
    reason: text("reason"),
    assignedBy: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("assignment_history_record_idx").on(t.recordType, t.recordId),
    index("assignment_history_to_user_idx").on(t.toUserId),
  ],
);

export const loansRelations = relations(loans, ({ one, many }) => ({
  customer: one(customers, { fields: [loans.customerId], references: [customers.id] }),
  bank: one(banks, { fields: [loans.bankId], references: [banks.id] }),
  fundingSource: one(fundingSources, {
    fields: [loans.fundingSourceId],
    references: [fundingSources.id],
  }),
  verification: one(verifications),
  bankOrders: many(bankOrders),
  disbursements: many(disbursements),
  transactions: many(transactions),
}));

export const verificationsRelations = relations(verifications, ({ one }) => ({
  loan: one(loans, { fields: [verifications.loanId], references: [loans.id] }),
  provider: one(serviceProviders, {
    fields: [verifications.serviceProviderId],
    references: [serviceProviders.id],
  }),
}));

export const disbursementsRelations = relations(disbursements, ({ one }) => ({
  loan: one(loans, { fields: [disbursements.loanId], references: [loans.id] }),
  bank: one(banks, { fields: [disbursements.bankId], references: [banks.id] }),
  customer: one(customers, { fields: [disbursements.customerId], references: [customers.id] }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  loan: one(loans, { fields: [transactions.loanId], references: [loans.id] }),
  bank: one(banks, { fields: [transactions.bankId], references: [banks.id] }),
  disbursement: one(disbursements, {
    fields: [transactions.disbursementId],
    references: [disbursements.id],
  }),
}));

export const loanStatuses = [
  "Draft",
  "Submitted",
  "Under Review",
  "Approved",
  "Disbursed",
  "Rejected",
  "Closed",
] as const;

export const loanTypes = [
  "Personal Loan",
  "Business Loan",
  "Gold Loan",
  "Vehicle Loan",
  "Home Loan",
  "Loan Against Property",
] as const;

export const verificationStatuses = [
  "Pending",
  "Requested",
  "In Progress",
  "Verified",
  "Rejected",
  "Failed",
  "Expired",
] as const;

export const bankOrderStages = [
  "Login",
  "Credit Check",
  "Field Verification",
  "Sanction",
  "Disbursal Queue",
] as const;

export const bankOrderStatuses = ["In Progress", "On Hold", "Cleared", "Returned"] as const;
export const disbursementModes = ["NEFT", "RTGS", "IMPS"] as const;
export const disbursementStatuses = ["Credited", "In Transit", "Failed"] as const;
export const settlementStatuses = ["Paid", "Pending", "Disputed"] as const;
export const transactionTypes = ["Disbursement", "EMI Collection", "Commission", "Refund"] as const;
export const transactionStatuses = ["Success", "Pending", "Failed"] as const;
export const ledgerCategories = [
  "Commission",
  "Disbursement",
  "Payout",
  "Expense",
  "Tax",
] as const;
export const fundingSourceTypes = ["own_funds", "bank", "external"] as const;
