"use client";

import * as React from "react";
import { ArrowDownLeft, ArrowUpRight, FileSpreadsheet, Plus, Scale } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/layout/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { exportTallyXml } from "@/lib/export";
import { toast } from "sonner";
import { useReference } from "@/hooks/use-reference";
import { useResource, useRecord, useStats } from "@/hooks/use-api";
import { api, errorMessage } from "@/lib/api";
import { num } from "@/lib/types";
import type { Bank, Disbursement, LedgerEntry } from "@/lib/types";

const categories: LedgerEntry["category"][] = [
  "Commission",
  "Disbursement",
  "Payout",
  "Expense",
  "Tax",
];

export default function LedgerPage() {
  const { data: rows, loading, error, refresh } = useResource<LedgerEntry>("/ledger");
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({
    particulars: "",
    party: "",
    category: "Commission" as LedgerEntry["category"],
    direction: "credit" as "credit" | "debit",
    amount: "",
    mode: "NEFT",
  });

  async function addEntry() {
    if (!form.particulars.trim()) {
      toast.error("Add a description for the voucher");
      return;
    }
    try {
      await api.create<LedgerEntry>("/ledger", {
        particulars: form.particulars.trim(),
        party: form.party || null,
        category: form.category,
        debit: form.direction === "debit" ? Number(form.amount) || 0 : 0,
        credit: form.direction === "credit" ? Number(form.amount) || 0 : 0,
        mode: form.mode || null,
        entryDate: new Date().toISOString(),
      });
      setOpen(false);
      refresh();
      toast.success("Voucher posted");
    } catch (err) {
      toast.error("Could not post voucher", { description: errorMessage(err) });
    }
  }

  const columns: Column<LedgerEntry>[] = [
    {
      key: "date",
      header: "Date",
      sortValue: (row) => row.entryDate,
      render: (row) => formatDate(row.entryDate),
      exportValue: (row) => row.entryDate,
    },
    {
      key: "voucherNo",
      header: "Voucher",
      sortValue: (row) => row.voucherNo,
      render: (row) => <span className="numeric text-xs">{row.voucherNo ?? "—"}</span>,
    },
    {
      key: "particulars",
      header: "Particulars",
      render: (row) => (
        <div className="max-w-[280px]">
          <p className="truncate text-[13px] font-medium">{row.particulars}</p>
          <p className="text-[11px] text-[var(--muted-foreground)]">
            {row.party ?? "—"} · {row.mode ?? "—"}
          </p>
        </div>
      ),
      exportValue: (row) => row.particulars,
    },
    {
      key: "category",
      header: "Category",
      sortValue: (row) => row.category,
      render: (row) => <Badge variant="outline">{row.category}</Badge>,
      exportValue: (row) => row.category,
    },
    {
      key: "debit",
      header: "Debit",
      align: "right",
      sortValue: (row) => num(row.debit),
      render: (row) =>
        num(row.debit) ? (
          <span className="numeric text-[var(--danger)]">{formatCurrency(num(row.debit))}</span>
        ) : (
          <span className="text-[var(--muted-foreground)]">—</span>
        ),
      exportValue: (row) => num(row.debit),
    },
    {
      key: "credit",
      header: "Credit",
      align: "right",
      sortValue: (row) => num(row.credit),
      render: (row) =>
        num(row.credit) ? (
          <span className="numeric text-[var(--success)]">{formatCurrency(num(row.credit))}</span>
        ) : (
          <span className="text-[var(--muted-foreground)]">—</span>
        ),
      exportValue: (row) => num(row.credit),
    },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      sortValue: (row) => num(row.balance),
      render: (row) => <span className="numeric font-medium">{formatCurrency(num(row.balance))}</span>,
      exportValue: (row) => num(row.balance),
    },
  ];

  const totalCredit = rows.reduce((total, row) => total + num(row.credit), 0);
  const totalDebit = rows.reduce((total, row) => total + num(row.debit), 0);

  return (
    <>
      <PageHeader
        eyebrow="Bank operations"
        title="Ledger"
        description="Single book of receipts, payouts, expenses, and tax entries for the DSA business."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                exportTallyXml(
                  "risenext-ledger-tally",
                  rows.map((row) => ({
                    date: row.entryDate,
                    narration: row.particulars,
                    party: row.party,
                    amount: num(row.credit) || num(row.debit),
                  })),
                );
                toast.success("Tally XML exported");
              }}
            >
              <FileSpreadsheet className="size-4" /> Export to Tally
            </Button>
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> New voucher
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Closing balance"
          value={formatCurrency(rows[0]?.balance ?? 0, { compact: true })}
          icon={Scale}
          helper="as on latest voucher"
        />
        <StatCard
          label="Total receipts"
          value={formatCurrency(totalCredit, { compact: true })}
          icon={ArrowDownLeft}
          accent="var(--success)"
          helper={`${rows.filter((row) => num(row.credit) > 0).length} credit entries`}
          index={1}
        />
        <StatCard
          label="Total payments"
          value={formatCurrency(totalDebit, { compact: true })}
          icon={ArrowUpRight}
          accent="var(--danger)"
          helper={`${rows.filter((row) => num(row.debit) > 0).length} debit entries`}
          index={2}
        />
        <StatCard
          label="Net movement"
          value={formatCurrency(totalCredit - totalDebit, { compact: true })}
          icon={Scale}
          accent="var(--info)"
          helper="receipts less payments"
          index={3}
        />
      </div>

      <SectionCard
        title="Category split"
        description="Where the money moved this period"
        contentClassName="grid gap-3 sm:grid-cols-3 xl:grid-cols-5"
      >
        {categories.map((category) => {
          const entries = rows.filter((row) => row.category === category);
          const value = entries.reduce((total, row) => total + num(row.credit) - num(row.debit), 0);
          return (
            <div key={category} className="rounded-lg border border-[var(--border)] p-3">
              <p className="text-[11px] text-[var(--muted-foreground)]">{category}</p>
              <p
                className="numeric text-lg font-semibold"
                style={{ color: value >= 0 ? "var(--success)" : "var(--danger)" }}
              >
                {formatCurrency(value, { compact: true })}
              </p>
              <p className="text-[11px] text-[var(--muted-foreground)]">{entries.length} entries</p>
            </div>
          );
        })}
      </SectionCard>

      <DataTable
        rows={rows}
        columns={columns}
        exportName="risenext-ledger"
        searchPlaceholder="Search narration, party, or voucher"
        searchText={(row) => `${row.voucherNo ?? "—"} ${row.particulars} ${row.party ?? "—"} ${row.category}`}
        filters={[
          { key: "category", label: "Category", options: categories, value: (row) => row.category },
          {
            key: "mode",
            label: "Mode",
            options: ["NEFT", "RTGS", "IMPS", "UPI", "Card", "Challan"],
            value: (row) => row.mode ?? "",
          },
        ]}
        pageSize={10}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New voucher</DialogTitle>
            <DialogDescription>
              Post a receipt or payment. The closing balance updates immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="v-narration">Narration</Label>
              <Input
                id="v-narration"
                value={form.particulars}
                onChange={(event) => setForm({ ...form, particulars: event.target.value })}
                placeholder="Commission received — Chola May cycle"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-party">Party</Label>
              <Input
                id="v-party"
                value={form.party}
                onChange={(event) => setForm({ ...form, party: event.target.value })}
                placeholder="Chola Finance"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-amount">Amount</Label>
              <Input
                id="v-amount"
                value={num(form.amount)}
                onChange={(event) =>
                  setForm({ ...form, amount: event.target.value.replace(/\D/g, "") })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Entry type</Label>
              <Select
                value={form.direction}
                onValueChange={(value) =>
                  setForm({ ...form, direction: value as "credit" | "debit" })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="credit">Receipt (credit)</SelectItem>
                  <SelectItem value="debit">Payment (debit)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select
                value={form.category}
                onValueChange={(value) =>
                  setForm({ ...form, category: value as LedgerEntry["category"] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Mode</Label>
              <Select value={form.mode} onValueChange={(value) => setForm({ ...form, mode: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["NEFT", "RTGS", "IMPS", "UPI", "Card", "Challan"].map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {mode}
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
            <Button onClick={addEntry}>Post voucher</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
