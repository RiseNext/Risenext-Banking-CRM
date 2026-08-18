"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  Download,
  FileSpreadsheet,
  Plus,
  UploadCloud,
  UserPlus,
  Users,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatCard } from "@/components/shared/stat-card";
import { CustomerImportDialog } from "@/components/shared/customer-import-dialog";

import { formatCurrency, formatDate } from "@/lib/format";
import { initials } from "@/lib/utils";
import { toast } from "sonner";

import { useReference } from "@/hooks/use-reference";
import { useAuth } from "@/hooks/use-auth";
import {
  useResource,
} from "@/hooks/use-api";

import { api, errorMessage } from "@/lib/api";
import { num } from "@/lib/types";
import type {
  Customer,
  Loan,
} from "@/lib/types";

export default function CustomersPage() {
  const router = useRouter();

  const { can } = useAuth();

  const {
    bankName,
    banks,
    employeeName,
    employees,
  } = useReference();

  /* -------------------------------------------------------------------------- */
  /* Customer data                                                              */
  /* -------------------------------------------------------------------------- */

  const [search, setSearch] = React.useState("");

  const {
    data: rows,
    refresh,
  } = useResource<Customer>("/customers", {
    search,
    pageSize: 100,
  });

  const { data: allLoans } =
    useResource<Loan>("/loans", {
      pageSize: 500,
    });

  const loansForCustomer = React.useCallback(
    (customerId: string) =>
      allLoans.filter(
        (loan) => loan.customerId === customerId
      ),
    [allLoans]
  );

  /* -------------------------------------------------------------------------- */
  /* Dialog state                                                               */
  /* -------------------------------------------------------------------------- */

  const [open, setOpen] =
    React.useState(false);

  const [importOpen, setImportOpen] =
    React.useState(false);

  const [saving, setSaving] =
    React.useState(false);

  /* -------------------------------------------------------------------------- */
  /* Customer form                                                              */
  /* -------------------------------------------------------------------------- */

  const [form, setForm] = React.useState({
    name: "",
    mobile: "",
    email: "",
    pan: "",
    city: "Hyderabad",
    bankId: "",
    bankReferenceId: "",
    assignedTo: "",
    monthlyIncome: "45000",
  });

  const resolvedBankId =
    form.bankId ||
    (banks[0]?.id ?? "");

  const resolvedAssignedTo =
    form.assignedTo ||
    (employees[0]?.id ?? "");

  /* -------------------------------------------------------------------------- */
  /* Written form upload                                                       */
  /* -------------------------------------------------------------------------- */

  const manualFormInputRef =
    React.useRef<HTMLInputElement>(null);

  /* -------------------------------------------------------------------------- */
  /* Download draft application                                                */
  /* -------------------------------------------------------------------------- */

  function downloadDraftApplication() {
    const applicantName =
      form.name.trim() || "Customer";

    const safeName =
      applicantName
        .toLowerCase()
        .replace(/\s+/g, "-");

    const fileName = `${
      safeName || "customer"
    }-draft-application.html`;

    const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Customer Draft Application</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        margin: 32px;
        color: #111827;
      }

      h1 {
        margin-bottom: 8px;
      }

      .meta {
        margin: 12px 0;
        color: #374151;
      }

      .section {
        margin-top: 24px;
      }

      .row {
        display: flex;
        justify-content: space-between;
        padding: 8px 0;
        border-bottom: 1px solid #e5e7eb;
      }
    </style>
  </head>

  <body>
    <h1>Customer Draft Application</h1>

    <div class="meta">
      Applicant: ${applicantName}
    </div>

    <div class="meta">
      Prepared for verification and onboarding
    </div>

    <div class="section">
      <div class="row">
        <span>Customer name</span>
        <strong>${applicantName}</strong>
      </div>

      <div class="row">
        <span>Bank</span>
        <strong>
          ${bankName(resolvedBankId) || "—"}
        </strong>
      </div>

      <div class="row">
        <span>Mobile</span>
        <strong>
          ${form.mobile || "—"}
        </strong>
      </div>

      <div class="row">
        <span>Email</span>
        <strong>
          ${form.email || "—"}
        </strong>
      </div>

      <div class="row">
        <span>PAN</span>
        <strong>
          ${form.pan || "—"}
        </strong>
      </div>

      <div class="row">
        <span>Income</span>
        <strong>
          ${formatCurrency(
            num(form.monthlyIncome)
          )}
        </strong>
      </div>
    </div>

    <p>
      Use this draft for manual verification
      and re-upload the filled form when needed.
    </p>
  </body>
</html>`;

    const url = URL.createObjectURL(
      new Blob([html], {
        type: "text/html;charset=utf-8",
      })
    );

    const link =
      document.createElement("a");

    link.href = url;
    link.download = fileName;

    document.body.appendChild(link);

    link.click();

    document.body.removeChild(link);

    URL.revokeObjectURL(url);

    toast.success(
      "Draft application downloaded",
      {
        description:
          "The application form is ready for manual verification.",
      }
    );
  }

  /* -------------------------------------------------------------------------- */
  /* Written form upload                                                        */
  /* -------------------------------------------------------------------------- */

  function handleManualFormUpload(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file =
      event.target.files?.[0];

    if (!file) return;

    toast.success(
      "Written form uploaded",
      {
        description: `${file.name} has been queued for verification.`,
      }
    );

    event.target.value = "";
  }

  /* -------------------------------------------------------------------------- */
  /* Delete customer                                                            */
  /* -------------------------------------------------------------------------- */

  async function deleteCustomer(
    id: string
  ) {
    const confirmed = window.confirm(
      "Move this customer to the recycle bin?"
    );

    if (!confirmed) return;

    try {
      await api.remove(
        `/customers/${id}`
      );

      refresh();

      toast.success(
        "Customer moved to recycle bin"
      );
    } catch (error) {
      toast.error(
        "Could not delete",
        {
          description:
            errorMessage(error),
        }
      );
    }
  }

  /* -------------------------------------------------------------------------- */
  /* Add customer                                                               */
  /* -------------------------------------------------------------------------- */

  async function addCustomer() {
    if (
      !form.name.trim() ||
      form.mobile.length < 10
    ) {
      toast.error(
        "Missing details",
        {
          description:
            "Enter the full name and a 10 digit mobile number.",
        }
      );

      return;
    }

    if (!form.bankReferenceId.trim()) {
      toast.error(
        "Bank Reference ID is required",
        {
          description:
            "It must be unique within the selected bank.",
        }
      );

      return;
    }

    if (!resolvedBankId) {
      toast.error(
        "Bank is required",
        {
          description:
            "Please select a bank before adding the customer.",
        }
      );

      return;
    }

    setSaving(true);

    try {
      const created =
        await api.create<Customer>(
          "/customers",
          {
            bankId: resolvedBankId,

            bankReferenceId:
              form.bankReferenceId.trim(),

            name:
              form.name.trim(),

            mobile:
              form.mobile.trim(),

            email:
              form.email.trim() ||
              null,

            pan:
              form.pan
                .trim()
                .toUpperCase() ||
              null,

            city:
              form.city.trim() ||
              null,

            monthlyIncome:
              Number(
                num(form.monthlyIncome)
              ) || 0,

            assignedUserId:
              resolvedAssignedTo ||
              null,

            kyc: "Pending",

            status: "Active",
          }
        );

      setOpen(false);

      setForm({
        ...form,
        name: "",
        mobile: "",
        email: "",
        pan: "",
        bankReferenceId: "",
      });

      refresh();

      toast.success(
        "Customer added",
        {
          description: `${created.data.name} created as ${created.data.code}`,
        }
      );
    } catch (error) {
      toast.error(
        "Could not add customer",
        {
          description:
            errorMessage(error),
        }
      );
    } finally {
      setSaving(false);
    }
  }

  /* -------------------------------------------------------------------------- */
  /* Table columns                                                              */
  /* -------------------------------------------------------------------------- */

  const columns: Column<Customer>[] =
    [
      {
        key: "name",
        header: "Customer",

        sortValue: (row) =>
          row.name,

        render: (row) => (
          <div className="flex items-center gap-2.5">
            <Avatar className="size-8">
              <AvatarFallback>
                {initials(row.name)}
              </AvatarFallback>
            </Avatar>

            <div>
              <p className="font-medium">
                {row.name}
              </p>

              <p className="numeric text-[11px] text-[var(--muted-foreground)]">
                {row.id}
              </p>
            </div>
          </div>
        ),
      },

      {
        key: "mobile",
        header: "Contact",

        render: (row) => (
          <div>
            <p className="numeric text-[13px]">
              {row.mobile}
            </p>

            <p className="text-[11px] text-[var(--muted-foreground)]">
              {row.city}
            </p>
          </div>
        ),

        exportValue: (row) =>
          row.mobile,
      },

      {
        key: "bankId",
        header: "Bank",

        sortValue: (row) =>
          bankName(row.bankId),

        render: (row) =>
          bankName(row.bankId),

        exportValue: (row) =>
          bankName(row.bankId),
      },

      {
        key: "loans",
        header: "Loans",

        sortValue: (row) =>
          loansForCustomer(row.id)
            .length,

        render: (row) => {
          const count =
            loansForCustomer(
              row.id
            ).length;

          return (
            <Badge
              variant={
                count
                  ? "info"
                  : "neutral"
              }
            >
              {count} active
            </Badge>
          );
        },

        exportValue: (row) =>
          loansForCustomer(row.id)
            .length,
      },

      {
        key: "monthlyIncome",
        header: "Income",
        align: "right",

        sortValue: (row) =>
          num(row.monthlyIncome),

        render: (row) => (
          <span className="numeric">
            {formatCurrency(
              num(
                row.monthlyIncome
              )
            )}
          </span>
        ),

        exportValue: (row) =>
          num(row.monthlyIncome),
      },

      {
        key: "cibil",
        header: "CIBIL",
        align: "right",

        sortValue: (row) =>
          row.cibil ?? 0,

        render: (row) => {
          const cibil =
            row.cibil ?? 0;

          return (
            <span
              className="numeric font-medium"
              style={{
                color:
                  cibil >= 750
                    ? "var(--success)"
                    : cibil >= 680
                      ? "var(--warning)"
                      : "var(--danger)",
              }}
            >
              {cibil}
            </span>
          );
        },

        exportValue: (row) =>
          row.cibil ?? 0,
      },

      {
        key: "kyc",
        header: "KYC",

        render: (row) => (
          <StatusBadge
            status={row.kyc}
          />
        ),

        exportValue: (row) =>
          row.kyc,
      },

      {
        key: "assignedTo",
        header: "Owner",

        sortValue: (row) =>
          employeeName(
            row.assignedUserId
          ),

        render: (row) =>
          employeeName(
            row.assignedUserId
          ),

        exportValue: (row) =>
          employeeName(
            row.assignedUserId
          ),
      },

      {
        key: "createdAt",
        header: "Added",

        sortValue: (row) =>
          row.createdAt,

        render: (row) =>
          formatDate(
            row.createdAt
          ),

        exportValue: (row) =>
          row.createdAt,
      },

      /* ---------------------------------------------------------------------- */
      /* Actions                                                                 */
      /* ---------------------------------------------------------------------- */

      {
        key: "actions",
        header: "Actions",

        render: (row) => (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={(event) => {
                event.stopPropagation();

                router.push(
                  `/customers/${row.id}`
                );
              }}
            >
              View
            </Button>

            <Button
              size="sm"
              onClick={(event) => {
                event.stopPropagation();

                toast.info(
                  "Document upload",
                  {
                    description:
                      "Open the customer record to upload documents.",
                  }
                );

                router.push(
                  `/customers/${row.id}`
                );
              }}
            >
              Upload Docs
            </Button>

            <Button
              size="sm"
              variant="destructive"
              onClick={(event) => {
                event.stopPropagation();

                void deleteCustomer(
                  row.id
                );
              }}
            >
              Delete
            </Button>
          </div>
        ),
      },
    ];

  /* -------------------------------------------------------------------------- */
  /* Statistics                                                                 */
  /* -------------------------------------------------------------------------- */

  const verified =
    rows.filter(
      (row) =>
        row.kyc === "Verified"
    ).length;

  const followUps =
    rows.filter(
      (row) =>
        row.status === "Follow Up"
    ).length;

  const verificationPercentage =
    rows.length > 0
      ? Math.round(
          (verified /
            rows.length) *
            100
        )
      : 0;

  const averageIncome =
    rows.length > 0
      ? Math.round(
          rows.reduce(
            (
              total,
              row
            ) =>
              total +
              num(
                row.monthlyIncome
              ),
            0
          ) / rows.length
        )
      : 0;

  /* -------------------------------------------------------------------------- */
  /* Render                                                                     */
  /* -------------------------------------------------------------------------- */

  return (
    <>
      {/* ---------------------------------------------------------------------- */}
      {/* Page Header                                                             */}
      {/* ---------------------------------------------------------------------- */}

      <PageHeader
        eyebrow="Customer management"
        title="Customers"
        description="Every lead and borrower on the desk, with KYC state, assigned owner, and lender mapping."
        actions={
          <>
            <Button
              variant="outline"
              onClick={
                downloadDraftApplication
              }
            >
              <Download className="size-4" />
              Draft application
            </Button>

            <Button
              variant="outline"
              asChild
            >
              <Link href="/documents">
                Documents
              </Link>
            </Button>

            {can(
              "customers.import"
            ) && (
              <Button
                variant="outline"
                onClick={() =>
                  setImportOpen(
                    true
                  )
                }
              >
                <FileSpreadsheet className="size-4" />
                Import Excel
              </Button>
            )}

            <Button
              variant="outline"
              onClick={() =>
                manualFormInputRef.current?.click()
              }
            >
              <UploadCloud className="size-4" />
              Re-upload written form
            </Button>

            <Button
              onClick={() =>
                setOpen(true)
              }
            >
              <Plus className="size-4" />
              Add customer
            </Button>
          </>
        }
      />

      {/* ---------------------------------------------------------------------- */}
      {/* Hidden written form input                                              */}
      {/* ---------------------------------------------------------------------- */}

      <input
        ref={manualFormInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
        className="hidden"
        onChange={
          handleManualFormUpload
        }
      />

      {/* ---------------------------------------------------------------------- */}
      {/* Statistics                                                              */}
      {/* ---------------------------------------------------------------------- */}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total on desk"
          value={String(rows.length)}
          icon={Users}
          helper="in this view"
        />

        <StatCard
          label="KYC verified"
          value={String(verified)}
          icon={Users}
          accent="var(--success)"
          helper={`${verificationPercentage}% of book`}
          index={1}
        />

        <StatCard
          label="Follow ups due"
          value={String(followUps)}
          icon={Users}
          accent="var(--warning)"
          helper="callbacks pending"
          index={2}
        />

        <StatCard
          label="Avg. monthly income"
          value={formatCurrency(
            averageIncome
          )}
          icon={Users}
          accent="var(--info)"
          helper="declared by borrowers"
          index={3}
        />
      </div>

      {/* ---------------------------------------------------------------------- */}
      {/* Customer table                                                         */}
      {/* ---------------------------------------------------------------------- */}

      <DataTable
        rows={rows}
        columns={columns}
        exportName="risenext-customers"
        searchPlaceholder="Search by name, ID, mobile, or PAN"
        searchText={(row) =>
          `${row.name} ${row.id} ${row.mobile} ${row.pan ?? ""} ${row.city ?? ""}`
        }
        filters={[
          {
            key: "kyc",
            label: "KYC",
            options: [
              "Verified",
              "Pending",
              "Rejected",
            ],
            value: (row) =>
              row.kyc,
          },

          {
            key: "bank",
            label: "Bank",
            options:
              banks.map(
                (bank) =>
                  bank.name
              ),
            value: (row) =>
              bankName(
                row.bankId
              ),
          },

          {
            key: "status",
            label: "Status",
            options: [
              "Active",
              "Follow Up",
              "Closed",
            ],
            value: (row) =>
              row.status,
          },
        ]}
        onRowClick={(row) =>
          router.push(
            `/customers/${row.id}`
          )
        }
        emptyState={
          <EmptyState
            icon={UserPlus}
            title="No customers match this view"
            description="Adjust the filters, or add the borrower you just spoke to."
            action={
              <Button
                size="sm"
                onClick={() =>
                  setOpen(true)
                }
              >
                Add customer
              </Button>
            }
          />
        }
      />

      {/* ---------------------------------------------------------------------- */}
      {/* Add customer dialog                                                    */}
      {/* ---------------------------------------------------------------------- */}

      <Dialog
        open={open}
        onOpenChange={setOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Add customer
            </DialogTitle>

            <DialogDescription>
              Capture the basics now —
              KYC documents and loan
              details can follow.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            {/* Bank Reference ID */}

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="c-bankref">
                Bank Reference ID
              </Label>

              <Input
                id="c-bankref"
                value={
                  form.bankReferenceId
                }
                onChange={(event) =>
                  setForm({
                    ...form,
                    bankReferenceId:
                      event.target
                        .value,
                  })
                }
                placeholder="REF001"
              />

              <p className="text-[11px] text-[var(--muted-foreground)]">
                Must be unique for the
                selected bank. The same
                reference may be reused
                under a different bank.
              </p>
            </div>

            {/* Full name */}

            <div className="space-y-1.5">
              <Label htmlFor="c-name">
                Full name
              </Label>

              <Input
                id="c-name"
                value={form.name}
                onChange={(event) =>
                  setForm({
                    ...form,
                    name:
                      event.target
                        .value,
                  })
                }
                placeholder="As printed on PAN"
              />
            </div>

            {/* Mobile */}

            <div className="space-y-1.5">
              <Label htmlFor="c-mobile">
                Mobile
              </Label>

              <Input
                id="c-mobile"
                value={form.mobile}
                maxLength={10}
                inputMode="numeric"
                onChange={(event) =>
                  setForm({
                    ...form,
                    mobile:
                      event.target.value.replace(
                        /\D/g,
                        ""
                      ),
                  })
                }
                placeholder="10 digits"
              />
            </div>

            {/* Email */}

            <div className="space-y-1.5">
              <Label htmlFor="c-email">
                Email
              </Label>

              <Input
                id="c-email"
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm({
                    ...form,
                    email:
                      event.target
                        .value,
                  })
                }
                placeholder="optional"
              />
            </div>

            {/* PAN */}

            <div className="space-y-1.5">
              <Label htmlFor="c-pan">
                PAN
              </Label>

              <Input
                id="c-pan"
                value={form.pan}
                maxLength={10}
                onChange={(event) =>
                  setForm({
                    ...form,
                    pan:
                      event.target
                        .value
                        .toUpperCase(),
                  })
                }
                placeholder="ABCPK1234K"
              />
            </div>

            {/* Monthly income */}

            <div className="space-y-1.5">
              <Label htmlFor="c-income">
                Monthly income
              </Label>

              <Input
                id="c-income"
                value={num(
                  form.monthlyIncome
                )}
                inputMode="numeric"
                onChange={(event) =>
                  setForm({
                    ...form,
                    monthlyIncome:
                      event.target.value.replace(
                        /\D/g,
                        ""
                      ),
                  })
                }
              />
            </div>

            {/* Bank */}

            <div className="space-y-1.5">
              <Label>
                Bank
              </Label>

              <Select
                value={
                  resolvedBankId
                }
                onValueChange={(
                  value
                ) =>
                  setForm({
                    ...form,
                    bankId: value,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select bank" />
                </SelectTrigger>

                <SelectContent>
                  {banks.map(
                    (bank) => (
                      <SelectItem
                        key={bank.id}
                        value={bank.id}
                      >
                        {bank.name}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Assign employee */}

            <div className="space-y-1.5">
              <Label>
                Assign to
              </Label>

              <Select
                value={
                  resolvedAssignedTo
                }
                onValueChange={(
                  value
                ) =>
                  setForm({
                    ...form,
                    assignedTo:
                      value,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>

                <SelectContent>
                  {employees.map(
                    (employee) => (
                      <SelectItem
                        key={
                          employee.id
                        }
                        value={
                          employee.id
                        }
                      >
                        {employee.name}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setOpen(false)
              }
              disabled={saving}
            >
              Cancel
            </Button>

            <Button
              onClick={() => {
                void addCustomer();
              }}
              disabled={saving}
            >
              {saving
                ? "Adding..."
                : "Add customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------------------------- */}
      {/* Excel import                                                           */}
      {/* ---------------------------------------------------------------------- */}

      <CustomerImportDialog
        open={importOpen}
        onOpenChange={
          setImportOpen
        }
        onImported={refresh}
      />
    </>
  );
}
