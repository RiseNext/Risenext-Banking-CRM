"use client";

import * as React from "react";
import Link from "next/link";
import { Banknote, CircleAlert, Plus, RefreshCcw, Truck } from "lucide-react";
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
import type { Bank, Customer, Disbursement, Loan } from "@/lib/types";

export default function DisbursementPage() {
  const { bankName, banks } = useReference();
  const { data: customersList } = useResource<Customer>("/customers", { pageSize: 500 });
  const customerName = (id: string | null) =>
    customersList.find((c) => c.id === id)?.name ?? "Unknown";
  const { data: loans } = useResource<Loan>("/loans", { pageSize: 500 });
  const { data: rows, loading, error, refresh } = useResource<Disbursement>("/disbursements");
  const [selected, setSelected] = React.useState<Disbursement | null>(null);
  const [open, setOpen] = React.useState(false);
  const disbursableLoans = loans.filter((loan) =>
    ["Approved", "Disbursed"].includes(loan.status),
  );
  const [form, setForm] = React.useState({
    loanId: disbursableLoans[0]?.id ?? "",
    mode: "NEFT" as Disbursement["mode"],
    amount: String(disbursableLoans[0]?.amountApproved ?? 0),
    utr: "",
  });

  async function recordDisbursal() {
    const loan = loans.find((item) => item.id === form.loanId);
    if (!loan) {
      toast.error("Select a loan to disburse against");
      return;
    }
    try {
      await api.create<Disbursement>("/disbursements", {
        loanId: loan.id,
        customerId: loan.customerId,
        bankId: loan.bankId,
        amount: Number(form.amount) || num(loan.amountApproved),
        utr: form.utr.trim() || null,
        mode: form.mode,
        disbursedOn: new Date().toISOString(),
        status: "In Transit",
      });
      setOpen(false);
      refresh();
      toast.success("Disbursal recorded", { description: loan.code });
    } catch (err) {
      toast.error("Could not record disbursal", { description: errorMessage(err) });
    }
  }

  function markCredited(row: Disbursement) {
    refresh();
    setSelected((prev) => (prev ? { ...prev, status: "Credited" } : prev));
    toast.success("Marked as credited", { description: `${row.utr} confirmed in bank statement` });
  }

  function retry(row: Disbursement) {
    refresh();
    setSelected((prev) => (prev ? { ...prev, status: "In Transit" } : prev));
    toast.info("Re-initiated", { description: "Transfer resubmitted with corrected beneficiary." });
  }

  const columns: Column<Disbursement>[] = [
    {
      key: "id",
      header: "Disbursal",
      sortValue: (row) => row.code,
      render: (row) => (
        <div>
          <p className="numeric font-medium">{row.code}</p>
          <p className="numeric text-[11px] text-[var(--muted-foreground)]">{row.loanId}</p>
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
    {
      key: "amount",
      header: "Amount",
      align: "right",
      sortValue: (row) => num(row.amount),
      render: (row) => <span className="numeric font-medium">{formatCurrency(num(row.amount))}</span>,
      exportValue: (row) => num(row.amount),
    },
    { key: "mode", header: "Mode", sortValue: (row) => row.mode },
    {
      key: "utr",
      header: "UTR",
      render: (row) => <span className="numeric text-xs">{row.utr}</span>,
    },
    { key: "creditedTo", header: "Credited to" },
    {
      key: "disbursedOn",
      header: "Date",
      sortValue: (row) => row.disbursedOn,
      render: (row) => formatDate(row.disbursedOn),
      exportValue: (row) => row.disbursedOn,
    },
    {
      key: "status",
      header: "Status",
      sortValue: (row) => row.status,
      render: (row) => <StatusBadge status={row.status} />,
      exportValue: (row) => row.status,
    },
  ];

  const credited = rows.filter((row) => row.status === "Credited");
  const inTransit = rows.filter((row) => row.status === "In Transit");
  const failed = rows.filter((row) => row.status === "Failed");

  return (
    <>
      <PageHeader
        eyebrow="Bank operations"
        title="Disbursement"
        description="Money released by lenders against sanctioned files, matched to UTR references."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" /> Record disbursal
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total disbursed"
          value={formatCurrency(credited.reduce((total, row) => total + num(row.amount), 0), { compact: true })}
          icon={Banknote}
          accent="var(--success)"
          helper={`${credited.length} credited`}
        />
        <StatCard
          label="In transit"
          value={formatCurrency(inTransit.reduce((total, row) => total + num(row.amount), 0), { compact: true })}
          icon={Truck}
          accent="var(--info)"
          helper={`${inTransit.length} awaiting credit`}
          index={1}
        />
        <StatCard
          label="Failed transfers"
          value={String(failed.length)}
          icon={CircleAlert}
          accent="var(--danger)"
          helper="fix beneficiary and retry"
          index={2}
        />
        <StatCard
          label="Average ticket"
          value={formatCurrency(
            Math.round(rows.reduce((total, row) => total + num(row.amount), 0) / rows.length),
            { compact: true },
          )}
          icon={Banknote}
          helper="across all lenders"
          index={3}
        />
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        exportName="risenext-disbursements"
        searchPlaceholder="Search UTR, loan ID, or customer"
        searchText={(row) =>
          `${row.code} ${row.loanId} ${row.utr} ${customerName(row.customerId)} ${bankName(row.bankId)}`
        }
        filters={[
          {
            key: "status",
            label: "Status",
            options: ["Credited", "In Transit", "Failed"],
            value: (row) => row.status,
          },
          { key: "mode", label: "Mode", options: ["NEFT", "RTGS", "IMPS"], value: (row) => row.mode },
          {
            key: "bank",
            label: "Bank",
            options: banks.map((bank) => bank.name),
            value: (row) => bankName(row.bankId),
          },
        ]}
        onRowClick={(row) => setSelected(row)}
      />

      <Dialog open={Boolean(selected)} onOpenChange={(value) => !value && setSelected(null)}>
        <DialogContent className="max-w-md">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.id}</DialogTitle>
                <DialogDescription>
                  {customerName(selected.customerId)} · {bankName(selected.bankId)}
                </DialogDescription>
              </DialogHeader>
              <div>
                <DetailRow label="Amount" value={formatCurrency(num(selected.amount))} mono />
                <DetailRow label="Mode" value={selected.mode} />
                <DetailRow label="UTR" value={selected.utr} mono />
                <DetailRow label="Credited to" value={selected.creditedTo} mono />
                <DetailRow label="Disbursed on" value={formatDate(selected.disbursedOn)} />
                <DetailRow label="Status" value={<StatusBadge status={selected.status} />} />
              </div>
              <DialogFooter className="sm:justify-between">
                <Button variant="outline" asChild>
                  <Link href={`/customers/${selected.customerId}`}>Open customer</Link>
                </Button>
                {selected.status === "Failed" ? (
                  <Button onClick={() => retry(selected)}>
                    <RefreshCcw className="size-4" /> Re-initiate
                  </Button>
                ) : (
                  <Button
                    variant="success"
                    disabled={selected.status === "Credited"}
                    onClick={() => markCredited(selected)}
                  >
                    Mark credited
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record disbursal</DialogTitle>
            <DialogDescription>
              Log the transfer the bank confirmed so the ledger and settlement stay in sync.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Sanctioned loan</Label>
              <Select
                value={form.loanId}
                onValueChange={(value) => {
                  const loan = loans.find((item) => item.id === value);
                  setForm({ ...form, loanId: value, amount: String(loan?.amountApproved ?? 0) });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {disbursableLoans.map((loan) => (
                    <SelectItem key={loan.id} value={loan.id}>
                      {loan.id} · {customerName(loan.customerId)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-amount">Amount</Label>
              <Input
                id="d-amount"
                value={num(form.amount)}
                onChange={(event) =>
                  setForm({ ...form, amount: event.target.value.replace(/\D/g, "") })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Mode</Label>
              <Select
                value={form.mode}
                onValueChange={(value) =>
                  setForm({ ...form, mode: value as Disbursement["mode"] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NEFT">NEFT</SelectItem>
                  <SelectItem value="RTGS">RTGS</SelectItem>
                  <SelectItem value="IMPS">IMPS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="d-utr">UTR reference</Label>
              <Input
                id="d-utr"
                value={form.utr}
                onChange={(event) => setForm({ ...form, utr: event.target.value })}
                placeholder="CHOLN2405260119"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={recordDisbursal}>Save disbursal</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
