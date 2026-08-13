import { Router, type RequestHandler } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { banks, customers, importBatches, importRows } from "../db/schema/index.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { peppered } from "../lib/password.js";
import { env } from "../config/env.js";
import { authOf, requireAuth, requirePermission } from "../middleware/auth.js";
import { assertBankAccess } from "../services/access.js";
import { recordAudit } from "../services/audit.js";

export const importsRouter = Router();
importsRouter.use(requireAuth);

/**
 * Built lazily. Reading env() at module scope evaluates it at import time,
 * before the process has necessarily loaded its configuration — which made this
 * module's import order load-bearing. It is now resolved on first request.
 */
let uploadMiddleware: ReturnType<typeof multer> | null = null;

function upload() {
  uploadMiddleware ??= multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env().MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    const ok = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
    ].includes(file.mimetype);
    if (!ok) {
      cb(new Error("Only .xlsx, .xls and .csv files are accepted"));
      return;
    }
    cb(null, true);
  },
  });
  return uploadMiddleware;
}

const singleFile: RequestHandler = (req, res, next) => upload().single("file")(req, res, next);

/** Column definitions drive both the template and the validator, so a template
 *  download can never drift out of sync with what the importer accepts. */
const CUSTOMER_COLUMNS = [
  { header: "Bank Code", key: "bankCode", width: 14, required: true },
  { header: "Bank Reference ID", key: "bankReferenceId", width: 22, required: true },
  { header: "Customer Name", key: "name", width: 26, required: true },
  { header: "Mobile", key: "mobile", width: 14, required: true },
  { header: "Email", key: "email", width: 26, required: false },
  { header: "PAN", key: "pan", width: 14, required: false },
  { header: "Aadhaar", key: "aadhaar", width: 18, required: false },
  { header: "Monthly Income", key: "monthlyIncome", width: 16, required: false },
  { header: "City", key: "city", width: 16, required: false },
  { header: "State", key: "state", width: 16, required: false },
  { header: "Pincode", key: "pincode", width: 12, required: false },
  { header: "Occupation", key: "occupation", width: 18, required: false },
  { header: "CIBIL", key: "cibil", width: 10, required: false },
] as const;

const rowSchema = z.object({
  bankCode: z.string().trim().min(1, "Bank Code is required"),
  bankReferenceId: z.string().trim().min(1, "Bank Reference ID is required").max(64),
  name: z.string().trim().min(2, "Customer Name must be at least 2 characters").max(160),
  mobile: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => /^\d{10}$/.test(v), "Mobile must be 10 digits"),
  email: z.string().trim().email("Email is not valid").max(255).optional().or(z.literal("")),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}\d{4}[A-Z]$/, "PAN format is invalid")
    .optional()
    .or(z.literal("")),
  aadhaar: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v === "" || /^\d{12}$/.test(v), "Aadhaar must be 12 digits")
    .optional(),
  monthlyIncome: z.coerce.number().min(0).max(1_000_000_000).optional(),
  city: z.string().trim().max(120).optional().or(z.literal("")),
  state: z.string().trim().max(120).optional().or(z.literal("")),
  pincode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Pincode must be 6 digits")
    .optional()
    .or(z.literal("")),
  occupation: z.string().trim().max(120).optional().or(z.literal("")),
  cibil: z.coerce.number().int().min(300).max(900).optional(),
});

const cell = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in (value as Record<string, unknown>)) {
    return String((value as { text: unknown }).text).trim();
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
};

/** GET /api/imports/template/customers */
importsRouter.get(
  "/template/customers",
  requirePermission(PERMISSIONS.customers.import),
  async (_req, res, next) => {
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Customers");
      sheet.columns = CUSTOMER_COLUMNS.map((c) => ({
        header: c.required ? `${c.header} *` : c.header,
        key: c.key,
        width: c.width,
      }));
      sheet.getRow(1).font = { bold: true };
      sheet.addRow({
        bankCode: "BNK-01",
        bankReferenceId: "REF001",
        name: "Example Customer",
        mobile: "9876543210",
        email: "customer@example.com",
        pan: "ABCPK1234K",
        monthlyIncome: 45000,
        city: "Hyderabad",
        state: "Telangana",
        pincode: "500001",
      });

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader("Content-Disposition", 'attachment; filename="customer-import-template.xlsx"');
      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/imports/customers — upload, validate, stage. Nothing is written to
 * the customers table here; rows land in import_rows with a status and errors.
 */
importsRouter.post(
  "/customers",
  requirePermission(PERMISSIONS.customers.import),
  singleFile,
  async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const file = req.file;
      if (!file) throw badRequest("No file uploaded");

      const db = getDb();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
      const sheet = workbook.worksheets[0];
      if (!sheet) throw badRequest("The workbook contains no sheets");

      const headerRow = sheet.getRow(1);
      const headerMap = new Map<number, string>();
      headerRow.eachCell((c, colNumber) => {
        const label = cell(c.value).replace(/\s*\*$/, "");
        const column = CUSTOMER_COLUMNS.find(
          (def) => def.header.toLowerCase() === label.toLowerCase(),
        );
        if (column) headerMap.set(colNumber, column.key);
      });

      const missing = CUSTOMER_COLUMNS.filter(
        (c) => c.required && ![...headerMap.values()].includes(c.key),
      );
      if (missing.length) {
        throw badRequest(
          `The file is missing required columns: ${missing.map((m) => m.header).join(", ")}`,
        );
      }

      // Bank codes the caller may actually write to. An executive importing a
      // file that references someone else's bank gets those rows rejected —
      // not silently reassigned, and not imported.
      const bankRows = await db
        .select({ id: banks.id, code: banks.code })
        .from(banks)
        .where(isNull(banks.deletedAt));
      const bankByCode = new Map(bankRows.map((b) => [b.code.toUpperCase(), b]));

      const existingRefs = new Set(
        (
          await db
            .select({ bankId: customers.bankId, ref: customers.bankReferenceId })
            .from(customers)
            .where(isNull(customers.deletedAt))
        ).map((r) => `${r.bankId}:${r.ref.toUpperCase()}`),
      );

      const seenInFile = new Set<string>();
      const staged: {
        rowNumber: number;
        raw: Record<string, string>;
        normalised: Record<string, unknown> | null;
        status: string;
        errors: { field: string; message: string }[] | null;
      }[] = [];

      for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber);
        const raw: Record<string, string> = {};
        headerMap.forEach((key, colNumber) => {
          raw[key] = cell(row.getCell(colNumber).value);
        });
        if (Object.values(raw).every((v) => v === "")) continue;

        const errors: { field: string; message: string }[] = [];
        const parsed = rowSchema.safeParse(raw);

        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            errors.push({ field: String(issue.path[0] ?? "row"), message: issue.message });
          }
          staged.push({ rowNumber, raw, normalised: null, status: "invalid", errors });
          continue;
        }

        const bank = bankByCode.get(parsed.data.bankCode.toUpperCase());
        if (!bank) {
          errors.push({ field: "bankCode", message: `Unknown bank code ${parsed.data.bankCode}` });
        } else {
          try {
            assertBankAccess(ctx, bank.id);
          } catch {
            errors.push({
              field: "bankCode",
              message: `You are not assigned to bank ${parsed.data.bankCode}`,
            });
          }
        }

        const refKey = bank
          ? `${bank.id}:${parsed.data.bankReferenceId.toUpperCase()}`
          : `?:${parsed.data.bankReferenceId.toUpperCase()}`;

        let status = errors.length ? "invalid" : "valid";
        if (!errors.length && existingRefs.has(refKey)) {
          status = "duplicate";
          errors.push({
            field: "bankReferenceId",
            message: "This Bank Reference ID already exists for that bank",
          });
        } else if (!errors.length && seenInFile.has(refKey)) {
          status = "duplicate";
          errors.push({
            field: "bankReferenceId",
            message: "This Bank Reference ID appears more than once in the file",
          });
        } else if (status === "valid") {
          seenInFile.add(refKey);
        }

        staged.push({
          rowNumber,
          raw,
          normalised: bank ? { ...parsed.data, bankId: bank.id } : null,
          status,
          errors: errors.length ? errors : null,
        });
      }

      if (staged.length === 0) throw badRequest("The file contains no data rows");

      const counts = {
        total: staged.length,
        valid: staged.filter((r) => r.status === "valid").length,
        invalid: staged.filter((r) => r.status === "invalid").length,
        duplicate: staged.filter((r) => r.status === "duplicate").length,
      };

      const batch = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(importBatches)
          .values({
            importType: "customers",
            fileName: file.originalname,
            fileSize: file.size,
            status: "previewed",
            totalRows: counts.total,
            validRows: counts.valid,
            invalidRows: counts.invalid,
            duplicateRows: counts.duplicate,
            createdBy: ctx.userId,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          })
          .returning();

        await tx.insert(importRows).values(
          staged.map((r) => ({
            batchId: created!.id,
            rowNumber: r.rowNumber,
            raw: r.raw as never,
            normalised: r.normalised as never,
            status: r.status,
            errors: r.errors as never,
          })),
        );
        return created!;
      });

      res.status(201).json({
        data: {
          batchId: batch.id,
          fileName: batch.fileName,
          ...counts,
          preview: staged.slice(0, 50),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/** GET /api/imports/:batchId — full preview for the confirm screen. */
importsRouter.get("/:batchId", requirePermission(PERMISSIONS.customers.import), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const batchId = req.params.batchId as string;
    const db = getDb();

    const [batch] = await db.select().from(importBatches).where(eq(importBatches.id, batchId)).limit(1);
    if (!batch) throw notFound("Import batch not found");
    // A batch belongs to whoever uploaded it.
    if (batch.createdBy !== ctx.userId) throw forbidden("This import belongs to another user");

    const rows = await db
      .select()
      .from(importRows)
      .where(eq(importRows.batchId, batchId))
      .orderBy(importRows.rowNumber);

    res.json({ data: { batch, rows } });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/imports/:batchId/confirm — inserts ONLY rows staged as valid.
 * Runs in one transaction: either the whole confirmed set lands, or none of it.
 */
importsRouter.post(
  "/:batchId/confirm",
  requirePermission(PERMISSIONS.customers.import, PERMISSIONS.customers.create),
  async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const batchId = req.params.batchId as string;
      const db = getDb();

      const [batch] = await db
        .select()
        .from(importBatches)
        .where(eq(importBatches.id, batchId))
        .limit(1);
      if (!batch) throw notFound("Import batch not found");
      if (batch.createdBy !== ctx.userId) throw forbidden("This import belongs to another user");
      if (batch.status === "imported") throw conflict("This batch has already been imported");
      if (batch.expiresAt < new Date()) throw conflict("This batch has expired. Re-upload the file.");

      const valid = await db
        .select()
        .from(importRows)
        .where(and(eq(importRows.batchId, batchId), eq(importRows.status, "valid")))
        .orderBy(importRows.rowNumber);

      if (valid.length === 0) throw badRequest("There are no valid rows to import");

      const imported = await db.transaction(async (tx) => {
        const [{ total = 0 } = {}] = await tx
          .select({ total: sql<number>`count(*)::int` })
          .from(customers);
        let sequence = total;
        let inserted = 0;

        for (const row of valid) {
          const data = row.normalised as Record<string, unknown>;
          const bankId = String(data.bankId);
          // Re-checked at confirm time: bank access could have been revoked
          // between upload and confirmation.
          assertBankAccess(ctx, bankId);

          sequence += 1;
          const aadhaar = data.aadhaar ? String(data.aadhaar) : "";
          const [created] = await tx
            .insert(customers)
            .values({
              code: `CUS-${10000 + sequence}`,
              bankId,
              bankReferenceId: String(data.bankReferenceId),
              name: String(data.name),
              mobile: String(data.mobile),
              email: data.email ? String(data.email) : null,
              pan: data.pan ? String(data.pan) : null,
              aadhaarHash: aadhaar ? peppered(aadhaar, env().AADHAAR_PEPPER) : null,
              aadhaarLast4: aadhaar ? aadhaar.slice(-4) : null,
              monthlyIncome: String(data.monthlyIncome ?? 0),
              city: data.city ? String(data.city) : null,
              state: data.state ? String(data.state) : null,
              pincode: data.pincode ? String(data.pincode) : null,
              occupation: data.occupation ? String(data.occupation) : null,
              cibil: data.cibil ? Number(data.cibil) : null,
              kyc: "Pending",
              status: "Active",
              createdBy: ctx.userId,
              updatedBy: ctx.userId,
            })
            .returning({ id: customers.id });

          await tx
            .update(importRows)
            .set({ status: "imported", createdRecordId: created!.id })
            .where(eq(importRows.id, row.id));
          inserted += 1;
        }

        await tx
          .update(importBatches)
          .set({
            status: "imported",
            importedRows: inserted,
            confirmedAt: new Date(),
            confirmedBy: ctx.userId,
          })
          .where(eq(importBatches.id, batchId));

        await recordAudit(tx as never, ctx, req, {
          action: "imported",
          recordType: "customer",
          recordId: batchId,
          summary: `Imported ${inserted} customer(s) from ${batch.fileName}`,
          metadata: {
            batchId,
            totalRows: batch.totalRows,
            skipped: batch.totalRows - inserted,
          },
        });

        return inserted;
      });

      res.json({
        data: {
          batchId,
          imported,
          skipped: batch.totalRows - imported,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);
