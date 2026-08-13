"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, CircleSlash, FileText, Plus, TrendingUp, Wallet } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { DetailRow } from "@/components/shared/detail-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { formatCurrency, formatDate } from "@/lib/format";
import { toast } from "sonner";
import { useReference } from "@/hooks/use-reference";
import { useResource, useRecord, useStats } from "@/hooks/use-api";
import { api, errorMessage } from "@/lib/api";
import { num } from "@/lib/types";
import type { Bank, Customer, Loan, LoanStatus } from "@/lib/types";

const loanTypes: string[] = [
  "Personal Loan",
  "Business Loan",
  "Gold Loan",
  "Vehicle Loan",
  "Home Loan",
  "Loan Against Property",
];

export default function LoansPage() {
  const { bankName, banks, employeeName } = useReference();
  const { data: customersList } = useResource<Customer>("/customers", { pageSize: 500 });
  const customerName = (id: string | null) =>
    customersList.find((c) => c.id === id)?.name ?? "Unknown";
  const { data: rows, loading, error, refresh } = useResource<Loan>("/loans");
  const [selected, setSelected] = React.useState<Loan | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({
    customerId: "",
    bankId: "",
    loanType: "Personal Loan",
    amount: "500000",
    tenure: "36",
    rate: "13.5",
  });

  const resolvedCustomerId = form.customerId || (customersList[0]?.id ?? "");
  const resolvedBankId = form.bankId || (banks[0]?.id ?? "");


  function updateStatus(loan: Loan, status: LoanStatus) {
    refresh();
    setSelected((prev) => (prev ? { ...prev, status } : prev));
    toast.success(`Marked ${status.toLowerCase()}`, {
      description: `${loan.id} · ${customerName(loan.customerId)}`,
    });
  }

  async function createLoan() {
    const customer = customersList.find((c) => c.id === resolvedCustomerId);
    if (!customer) {
      toast.error("Select a customer first");
      return;
    }
    try {
      const created = await api.create<Loan>("/loans", {
        customerId: customer.id,
        // The loan always belongs to the customer's bank; the backend rejects
        // a mismatch, so there is no point offering a free choice here.
        bankId: customer.bankId,
        loanType: form.loanType,
        amountRequested: Number(form.amount) || 0,
        interestRate: Number(form.rate) || 0,
        tenureMonths: Number(form.tenure) || 0,
        status: "Submitted",
        appliedOn: new Date().toISOString(),
      });
      setOpen(false);
      refresh();
      toast.success("Loan file created", { description: created.data.code });
    } catch (err) {
      toast.error("Could not create loan", { description: errorMessage(err) });
    }
  }

  const columns: Column<Loan>[] = [
    {
      key: "id",
      header: "Loan",
      sortValue: (row) => row.code,
      render: (row) => (
        <div>
          <p className="numeric font-medium">{row.code}</p>
          <p className="text-[11px] text-[var(--muted-foreground)]">{row.applicationNo}</p>
        </div>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      sortValue: (row) => customerName(row.customerId),
      render: (row) => (
        <Link
          href={`/customers/${row.customerId}`}
          onClick={(event) => event.stopPropagation()}
          className="font-medium text-[var(--primary)] hover:underline"
        >
          {customerName(row.customerId)}
        </Link>
      ),
      exportValue: (row) => customerName(row.customerId),
    },
    {
      key: "bank",
      header: "Bank",
      sortValue: (row) => bankName(row.bankId),
      render: (row) => bankName(row.bankId),
      exportValue: (row) => bankName(row.bankId),
    },
    { key: "type", header: "Type", sortValue: (row) => row.loanType },
    {
      key: "amountRequested",
      header: "Requested",
      align: "right",
      sortValue: (row) => num(row.amountRequested),
      render: (row) => <span className="numeric">{formatCurrency(num(row.amountRequested))}</span>,
      exportValue: (row) => num(row.amountRequested),
    },
    {
      key: "amountApproved",
      header: "Approved",
      align: "right",
      sortValue: (row) => num(row.amountApproved),
      render: (row) => (
        <span className="numeric font-medium">
          {num(row.amountApproved) ? formatCurrency(num(row.amountApproved)) : "—"}
        </span>
      ),
      exportValue: (row) => num(row.amountApproved),
    },
    {
      key: "interestRate",
      header: "Rate",
      align: "right",
      sortValue: (row) => num(row.interestRate),
      render: (row) => <span className="numeric">{num(row.interestRate)}%</span>,
      exportValue: (row) => num(row.interestRate),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (row) => row.status,
      render: (row) => <StatusBadge status={row.status} />,
      exportValue: (row) => row.status,
    },
    {
      key: "appliedOn",
      header: "Applied",
      sortValue: (row) => row.appliedOn,
      render: (row) => formatDate(row.appliedOn),
      exportValue: (row) => row.appliedOn,
    },
  ];

  const approved = rows.filter((row) => ["Approved", "Disbursed"].includes(row.status));
  const rejected = rows.filter((row) => row.status === "Rejected");
  const bookValue = approved.reduce((total, row) => total + num(row.amountApproved), 0);

  return (
    <>
      <PageHeader
        eyebrow="Loan tracking"
        title="Loan applications"
        description="Every application across lenders with sanction amounts, pricing, and current stage."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/bank-orders">Bank orders</Link>
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> New application
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Applications" value={String(rows.length)} icon={FileText} helper="in this book" />
        <StatCard
          label="Approved value"
          value={formatCurrency(bookValue, { compact: true })}
          icon={TrendingUp}
          accent="var(--success)"
          helper={`${approved.length} sanctioned`}
          index={1}
        />
        <StatCard
          label="Commission booked"
          value={formatCurrency(rows.reduce((total, row) => total + num(row.commission), 0))}
          icon={Wallet}
          accent="var(--info)"
          helper="gross, before TDS"
          index={2}
        />
        <StatCard
          label="Rejected files"
          value={String(rejected.length)}
          icon={CircleSlash}
          accent="var(--danger)"
          helper="reworkable with new lender"
          index={3}
        />
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        exportName="risenext-loans"
        searchPlaceholder="Search loan ID, application number, or customer"
        searchText={(row) =>
          `${row.code} ${row.applicationNo} ${customerName(row.customerId)} ${bankName(row.bankId)} ${row.loanType}`
        }
        filters={[
          {
            key: "status",
            label: "Status",
            options: ["Draft", "Submitted", "Under Review", "Approved", "Disbursed", "Rejected", "Closed"],
            value: (row) => row.status,
          },
          { key: "type", label: "Product", options: loanTypes, value: (row) => row.loanType },
          {
            key: "bank",
            label: "Bank",
            options: banks.map((bank) => bank.name),
            value: (row) => bankName(row.bankId),
          },
        ]}
        onRowClick={(row) => setSelected(row)}
      />

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-lg">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {selected.id} · {customerName(selected.customerId)}
                </DialogTitle>
                <DialogDescription>
                  {selected.loanType} with {bankName(selected.bankId)} · application{" "}
                  {selected.applicationNo}
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-x-6 sm:grid-cols-2">
                <div>
                  <DetailRow label="Requested" value={formatCurrency(num(selected.amountRequested))} mono />
                  <DetailRow
                    label="Approved"
                    value={num(selected.amountApproved) ? formatCurrency(num(selected.amountApproved)) : "—"}
                    mono
                  />
                  <DetailRow label="Interest rate" value={`${num(selected.interestRate)}%`} mono />
                  <DetailRow label="Tenure" value={`${selected.tenureMonths} months`} mono />
                </div>
                <div>
                  <DetailRow label="EMI" value={num(selected.emi) ? formatCurrency(num(selected.emi)) : "—"} mono />
                  <DetailRow label="Processing fee" value={formatCurrency(num(selected.processingFee))} mono />
                  <DetailRow label="Commission" value={formatCurrency(num(selected.commission))} mono />
                  <DetailRow label="Owner" value={employeeName(selected.assignedUserId)} />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg bg-[var(--secondary)] px-3 py-2">
                <span className="text-xs text-[var(--muted-foreground)]">
                  Applied {formatDate(selected.appliedOn)} · updated {formatDate(selected.updatedAt)}
                </span>
                <StatusBadge status={selected.status} />
              </div>

              <DialogFooter className="sm:justify-between">
                <Button variant="outline" asChild>
                  <Link href={`/customers/${selected.customerId}`}>Open customer</Link>
                </Button>
                <div className="flex gap-2">
                  <Button variant="destructive" onClick={() => updateStatus(selected, "Rejected")}>
                    <CircleSlash className="size-4" /> Reject
                  </Button>
                  <Button variant="success" onClick={() => updateStatus(selected, "Approved")}>
                    <CheckCircle2 className="size-4" /> Approve
                  </Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New loan application</DialogTitle>
            <DialogDescription>
              EMI is calculated on submit using the rate and tenure you enter.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Customer</Label>
              <Select
                value={resolvedCustomerId}
                onValueChange={(value) => setForm({ ...form, customerId: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {customersList.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.name} · {customer.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <Label>Product</Label>
              <Select
                value={form.loanType}
                onValueChange={(value) => setForm({ ...form, loanType: value as string })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {loanTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="l-amount">Loan amount</Label>
              <Input
                id="l-amount"
                value={num(form.amount)}
                onChange={(event) =>
                  setForm({ ...form, amount: event.target.value.replace(/\D/g, "") })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="l-tenure">Tenure (months)</Label>
              <Input
                id="l-tenure"
                value={form.tenure}
                onChange={(event) =>
                  setForm({ ...form, tenure: event.target.value.replace(/\D/g, "") })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="l-rate">Interest rate (%)</Label>
              <Input
                id="l-rate"
                value={form.rate}
                onChange={(event) => setForm({ ...form, rate: event.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createLoan}>Submit to bank</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
