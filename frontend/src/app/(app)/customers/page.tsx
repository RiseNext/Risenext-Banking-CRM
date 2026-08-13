"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Plus, UserPlus, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { useResource, useRecord, useStats } from "@/hooks/use-api";
import { api, errorMessage } from "@/lib/api";
import { num } from "@/lib/types";
import type { Bank, Customer, Loan } from "@/lib/types";

export default function CustomersPage() {
  const { can } = useAuth();
  const { bankName, banks, employeeName, employees } = useReference();
  const [search, setSearch] = React.useState("");
  const { data: rows, total, loading, error, refresh } = useResource<Customer>("/customers", {
    search,
    pageSize: 100,
  });
  const { data: allLoans } = useResource<Loan>("/loans", { pageSize: 500 });
  const loansForCustomer = React.useCallback(
    (customerId: string) => allLoans.filter((l) => l.customerId === customerId),
    [allLoans],
  );
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
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
  const [saving, setSaving] = React.useState(false);

  const resolvedBankId = form.bankId || (banks[0]?.id ?? "");
  const resolvedAssignedTo = form.assignedTo || (employees[0]?.id ?? "");
  const [importOpen, setImportOpen] = React.useState(false);


async function deleteCustomer(id: string) {
  // Soft delete: the record moves to the recycle bin, it is not destroyed.
  if (!window.confirm("Move this customer to the recycle bin?")) return;
  try {
    await api.remove(`/customers/${id}`);
    refresh();
    toast.success("Customer moved to recycle bin");
  } catch (err) {
    toast.error("Could not delete", { description: errorMessage(err) });
  }
}
  async function addCustomer() {
    if (!form.name.trim() || form.mobile.length < 10) {
      toast.error("Missing details", {
        description: "Enter the full name and a 10 digit mobile number.",
      });
      return;
    }
    if (!form.bankReferenceId.trim()) {
      toast.error("Bank Reference ID is required", {
        description: "It must be unique within the selected bank.",
      });
      return;
    }
    setSaving(true);
    try {
      const created = await api.create<Customer>("/customers", {
        bankId: resolvedBankId,
        bankReferenceId: form.bankReferenceId.trim(),
        name: form.name.trim(),
        mobile: form.mobile.trim(),
        email: form.email || null,
        pan: form.pan.toUpperCase() || null,
        city: form.city || null,
        monthlyIncome: Number(num(form.monthlyIncome)) || 0,
        assignedUserId: resolvedAssignedTo || null,
        kyc: "Pending",
        status: "Active",
      });
      setOpen(false);
      setForm({ ...form, name: "", mobile: "", email: "", pan: "", bankReferenceId: "" });
      refresh();
      toast.success("Customer added", {
        description: `${created.data.name} created as ${created.data.code}`,
      });
    } catch (err) {
      // A 409 here is the per-bank Bank Reference ID rule firing server-side.
      toast.error("Could not add customer", { description: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<Customer>[] = [
    {
      key: "name",
      header: "Customer",
      sortValue: (row) => row.name,
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8">
            <AvatarFallback>{initials(row.name)}</AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium">{row.name}</p>
            <p className="numeric text-[11px] text-[var(--muted-foreground)]">{row.id}</p>
          </div>
        </div>
      ),
    },
    {
      key: "mobile",
      header: "Contact",
      render: (row) => (
        <div>
          <p className="numeric text-[13px]">{row.mobile}</p>
          <p className="text-[11px] text-[var(--muted-foreground)]">{row.city}</p>
        </div>
      ),
      exportValue: (row) => row.mobile,
    },
    {
      key: "bankId",
      header: "Bank",
      sortValue: (row) => bankName(row.bankId),
      render: (row) => bankName(row.bankId),
      exportValue: (row) => bankName(row.bankId),
    },
    {
      key: "loans",
      header: "Loans",
      sortValue: (row) => loansForCustomer(row.id).length,
      render: (row) => {
        const count = loansForCustomer(row.id).length;
        return <Badge variant={count ? "info" : "neutral"}>{count} active</Badge>;
      },
      exportValue: (row) => loansForCustomer(row.id).length,
    },
    {
      key: "monthlyIncome",
      header: "Income",
      align: "right",
      sortValue: (row) => num(row.monthlyIncome),
      render: (row) => <span className="numeric">{formatCurrency(num(row.monthlyIncome))}</span>,
      exportValue: (row) => num(row.monthlyIncome),
    },
    {
      key: "cibil",
      header: "CIBIL",
      align: "right",
      sortValue: (row) => (row.cibil ?? 0),
      render: (row) => (
        <span
          className="numeric font-medium"
          style={{
            color:
              (row.cibil ?? 0) >= 750
                ? "var(--success)"
                : (row.cibil ?? 0) >= 680
                  ? "var(--warning)"
                  : "var(--danger)",
          }}
        >
          {(row.cibil ?? 0)}
        </span>
      ),
      exportValue: (row) => (row.cibil ?? 0),
    },
    {
      key: "kyc",
      header: "KYC",
      render: (row) => <StatusBadge status={row.kyc} />,
      exportValue: (row) => row.kyc,
    },
    {
      key: "assignedTo",
      header: "Owner",
      sortValue: (row) => employeeName(row.assignedUserId),
      render: (row) => employeeName(row.assignedUserId),
      exportValue: (row) => employeeName(row.assignedUserId),
    },
    {
      key: "createdAt",
      header: "Added",
      sortValue: (row) => row.createdAt,
      render: (row) => formatDate(row.createdAt),
      exportValue: (row) => row.createdAt,
    },
    {
  key: "actions",
  header: "Actions",
  render: (row) => (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={(e) => {
          e.stopPropagation();
          router.push(`/customers/${row.id}`);
        }}
      >
        View
      </Button>
<Button
  size="sm"
  onClick={(e) => {
    e.stopPropagation();
  }}
>
  Upload Docs
</Button>
      <Button
        size="sm"
        variant="destructive"
        onClick={(e) => {
          e.stopPropagation();
          deleteCustomer(row.id);
        }}
      >
        Delete
      </Button>
    </div>
  ),
}

  ];

  const verified = rows.filter((row) => row.kyc === "Verified").length;
  const followUps = rows.filter((row) => row.status === "Follow Up").length;

  return (
    <>
      <PageHeader
        eyebrow="Customer management"
        title="Customers"
        description="Every lead and borrower on the desk, with KYC state, assigned owner, and lender mapping."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/documents">Documents</Link>
            </Button>
            {can("customers.import") && (
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <FileSpreadsheet className="size-4" /> Import Excel
              </Button>
            )}
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> Add customer
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total on desk" value={String(rows.length)} icon={Users} helper="in this view" />
        <StatCard
          label="KYC verified"
          value={String(verified)}
          icon={Users}
          accent="var(--success)"
          helper={`${Math.round((verified / rows.length) * 100)}% of book`}
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
            Math.round(rows.reduce((total, row) => total + num(row.monthlyIncome), 0) / rows.length),
          )}
          icon={Users}
          accent="var(--info)"
          helper="declared by borrowers"
          index={3}
        />
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        exportName="risenext-customers"
        searchPlaceholder="Search by name, ID, mobile, or PAN"
        searchText={(row) => `${row.name} ${row.id} ${row.mobile} ${row.pan} ${row.city}`}
        filters={[
          { key: "kyc", label: "KYC", options: ["Verified", "Pending", "Rejected"], value: (row) => row.kyc },
          {
            key: "bank",
            label: "Bank",
            options: banks.map((bank) => bank.name),
            value: (row) => bankName(row.bankId),
          },
          {
            key: "status",
            label: "Status",
            options: ["Active", "Follow Up", "Closed"],
            value: (row) => row.status,
          },
        ]}
        onRowClick={(row) => router.push(`/customers/${row.id}`)}
        emptyState={
          <EmptyState
            icon={UserPlus}
            title="No customers match this view"
            description="Adjust the filters, or add the borrower you just spoke to."
            action={
              <Button size="sm" onClick={() => setOpen(true)}>
                Add customer
              </Button>
            }
          />
        }
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add customer</DialogTitle>
            <DialogDescription>
              Capture the basics now — KYC documents and loan details can follow.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="c-bankref">Bank Reference ID</Label>
              <Input
                id="c-bankref"
                value={form.bankReferenceId}
                onChange={(event) => setForm({ ...form, bankReferenceId: event.target.value })}
                placeholder="REF001"
              />
              <p className="text-[11px] text-[var(--muted-foreground)]">
                Must be unique for the selected bank. The same reference may be reused under a
                different bank.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="c-name">Full name</Label>
              <Input
                id="c-name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="As printed on PAN"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-mobile">Mobile</Label>
              <Input
                id="c-mobile"
                value={form.mobile}
                maxLength={10}
                onChange={(event) =>
                  setForm({ ...form, mobile: event.target.value.replace(/\D/g, "") })
                }
                placeholder="10 digits"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-email">Email</Label>
              <Input
                id="c-email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                placeholder="optional"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-pan">PAN</Label>
              <Input
                id="c-pan"
                value={form.pan}
                maxLength={10}
                onChange={(event) => setForm({ ...form, pan: event.target.value.toUpperCase() })}
                placeholder="ABCPK1234K"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-income">Monthly income</Label>
              <Input
                id="c-income"
                value={num(form.monthlyIncome)}
                onChange={(event) =>
                  setForm({ ...form, monthlyIncome: event.target.value.replace(/\D/g, "") })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Bank</Label>
              <Select value={resolvedBankId} onValueChange={(value) => setForm({ ...form, bankId: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {banks.map((bank) => (
                    <SelectItem key={bank.id} value={bank.id}>
                      {bank.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Assign to</Label>
              <Select
                value={resolvedAssignedTo}
                onValueChange={(value) => setForm({ ...form, assignedTo: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={addCustomer}>Add customer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CustomerImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={refresh}
      />
    </>
  );
}
