"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, ClipboardCheck, ListChecks, Send, TimerReset } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { DetailRow } from "@/components/shared/detail-row";
import { PipelineRail } from "@/components/shared/pipeline-rail";
import { SectionCard } from "@/components/layout/section-card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
import type { Bank, BankOrder, Customer, Loan, Verification } from "@/lib/types";

const stages: BankOrder["stage"][] = [
  "Login",
  "Credit Check",
  "Field Verification",
  "Sanction",
  "Disbursal Queue",
];

export default function BankOrdersPage() {
  const { bankName, banks } = useReference();
  const { data: customersList } = useResource<Customer>("/customers", { pageSize: 500 });
  const customerName = (id: string | null) =>
    customersList.find((c) => c.id === id)?.name ?? "Unknown";
  const { data: loansList } = useResource<Loan>("/loans", { pageSize: 500 });
  const loanById = (id: string | null) => loansList.find((l) => l.id === id);
  const { data: rows, loading, error, refresh } = useResource<BankOrder>("/bank-orders");
  const [selected, setSelected] = React.useState<BankOrder | null>(null);
  const [remark, setRemark] = React.useState("");

  function moveStage(order: BankOrder, stage: BankOrder["stage"]) {
    refresh();
    setSelected((prev) => (prev ? { ...prev, stage } : prev));
    toast.success("Stage updated", { description: `${order.id} moved to ${stage}` });
  }

  function saveRemark(order: BankOrder) {
    if (!remark.trim()) {
      toast.error("Add a remark before saving");
      return;
    }
    refresh();
    setSelected((prev) => (prev ? { ...prev, remarks: remark.trim() } : prev));
    setRemark("");
    toast.success("Remark saved to the file trail");
  }

  const columns: Column<BankOrder>[] = [
    {
      key: "id",
      header: "Order",
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
      render: (row) => customerName(row.customerId),
      exportValue: (row) => customerName(row.customerId),
    },
    {
      key: "bank",
      header: "Bank",
      sortValue: (row) => bankName(row.bankId),
      render: (row) => bankName(row.bankId),
      exportValue: (row) => bankName(row.bankId),
    },
    { key: "officer", header: "Bank officer" },
    {
      key: "stage",
      header: "Stage",
      sortValue: (row) => stages.indexOf(row.stage),
      render: (row) => <span className="text-[13px] font-medium">{row.stage}</span>,
      exportValue: (row) => row.stage,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      sortValue: (row) => loanById(row.loanId)?.amountRequested ?? 0,
      render: (row) => (
        <span className="numeric">
          {formatCurrency(loanById(row.loanId)?.amountRequested ?? 0, { compact: true })}
        </span>
      ),
      exportValue: (row) => loanById(row.loanId)?.amountRequested ?? 0,
    },
    {
      key: "sla",
      header: "SLA",
      sortValue: (row) => row.sla,
      render: (row) => {
        const overdue = Boolean(row.sla) && new Date(row.sla as string) < new Date() && row.status !== "Cleared";
        return (
          <span className={overdue ? "font-medium text-[var(--danger)]" : ""}>
            {formatDate(row.sla)}
          </span>
        );
      },
      exportValue: (row) => row.sla,
    },
    {
      key: "status",
      header: "Status",
      sortValue: (row) => row.status,
      render: (row) => <StatusBadge status={row.status} />,
      exportValue: (row) => row.status,
    },
  ];

  const board = stages.map((stage) => ({
    stage,
    items: rows.filter((row) => row.stage === stage),
  }));

  return (
    <>
      <PageHeader
        eyebrow="Bank operations"
        title="Bank orders"
        description="Files sitting with partner lenders — track the stage, the officer handling it, and the SLA clock."
        actions={
          <Button asChild>
            <Link href="/loans">
              <Send className="size-4" /> Submit new file
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open orders" value={String(rows.filter((r) => r.status !== "Cleared").length)} icon={ListChecks} helper="awaiting bank action" />
        <StatCard
          label="Cleared"
          value={String(rows.filter((r) => r.status === "Cleared").length)}
          icon={ClipboardCheck}
          accent="var(--success)"
          helper="ready for disbursal"
          index={1}
        />
        <StatCard
          label="On hold"
          value={String(rows.filter((r) => r.status === "On Hold").length)}
          icon={TimerReset}
          accent="var(--warning)"
          helper="needs customer input"
          index={2}
        />
        <StatCard
          label="Returned"
          value={String(rows.filter((r) => r.status === "Returned").length)}
          icon={ArrowRight}
          accent="var(--danger)"
          helper="rework with another lender"
          index={3}
        />
      </div>

      <SectionCard
        title="Stage board"
        description="Where each file sits in the lender workflow"
        contentClassName="grid gap-3 md:grid-cols-3 xl:grid-cols-5"
      >
        {board.map((column) => (
          <div key={column.stage} className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
            <div className="flex items-center justify-between pb-2">
              <p className="text-[11px] font-semibold">{column.stage}</p>
              <span className="numeric text-[11px] text-[var(--muted-foreground)]">
                {column.items.length}
              </span>
            </div>
            <div className="space-y-2">
              {column.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelected(item)}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] p-2.5 text-left transition-shadow hover:shadow-sm"
                >
                  <p className="truncate text-[13px] font-medium">{customerName(item.customerId)}</p>
                  <p className="text-[11px] text-[var(--muted-foreground)]">{bankName(item.bankId)}</p>
                  <div className="mt-1.5">
                    <StatusBadge status={item.status} />
                  </div>
                </button>
              ))}
              {!column.items.length && (
                <p className="py-4 text-center text-[11px] text-[var(--muted-foreground)]">
                  Nothing here
                </p>
              )}
            </div>
          </div>
        ))}
      </SectionCard>

      <DataTable
        rows={rows}
        columns={columns}
        exportName="risenext-bank-orders"
        searchPlaceholder="Search order ID, loan ID, customer, or officer"
        searchText={(row) =>
          `${row.code} ${row.loanId} ${customerName(row.customerId)} ${bankName(row.bankId)} ${row.officer}`
        }
        filters={[
          {
            key: "status",
            label: "Status",
            options: ["In Progress", "On Hold", "Cleared", "Returned"],
            value: (row) => row.status,
          },
          { key: "stage", label: "Stage", options: stages, value: (row) => row.stage },
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
                  {bankName(selected.bankId)} · handled by {selected.officer}
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <DetailRow label="Loan" value={selected.loanId} mono />
                  <DetailRow
                    label="Amount"
                    value={formatCurrency(loanById(selected.loanId)?.amountRequested ?? 0)}
                    mono
                  />
                  <DetailRow label="Submitted" value={formatDate(selected.submittedOn)} />
                  <DetailRow label="SLA" value={formatDate(selected.sla)} />
                  <DetailRow label="Status" value={<StatusBadge status={selected.status} />} />
                </div>
                <PipelineRail current={selected.stage} />
              </div>

              <div className="space-y-2 rounded-lg bg-[var(--secondary)] p-3">
                <p className="text-[11px] font-semibold">Latest remark</p>
                <p className="text-[13px]">{selected.remarks}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="remark">Add remark</Label>
                <Textarea
                  id="remark"
                  value={remark}
                  onChange={(event) => setRemark(event.target.value)}
                  placeholder="Call summary, pending item, or bank feedback"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Move to stage</Label>
                <Select
                  value={selected.stage}
                  onValueChange={(value) => moveStage(selected, value as BankOrder["stage"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((stage) => (
                      <SelectItem key={stage} value={stage}>
                        {stage}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <DialogFooter className="sm:justify-between">
                <Button variant="outline" asChild>
                  <Link href={`/customers/${selected.customerId}`}>Open customer</Link>
                </Button>
                <Button onClick={() => saveRemark(selected)}>Save remark</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
