"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeftRight, CheckCircle2, CircleAlert, Clock3 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { DetailRow } from "@/components/shared/detail-row";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { useReference } from "@/hooks/use-reference";
import { useResource, useRecord, useStats } from "@/hooks/use-api";
import { api, errorMessage } from "@/lib/api";
import { num } from "@/lib/types";
import type { Bank, Customer, Disbursement, Loan, Transaction } from "@/lib/types";

export default function TransactionsPage() {
  const { bankName, banks } = useReference();
  const { data: customersList } = useResource<Customer>("/customers", { pageSize: 500 });
  const customerName = (id: string | null) =>
    customersList.find((c) => c.id === id)?.name ?? "Unknown";
  const { data: rows, loading, error, refresh } = useResource<Transaction>("/transactions");
  const [selected, setSelected] = React.useState<Transaction | null>(null);

  function settle(row: Transaction) {
    refresh();
    setSelected((prev) => (prev ? { ...prev, status: "Success" } : prev));
    toast.success("Transaction settled", { description: row.reference });
  }

  const columns: Column<Transaction>[] = [
    {
      key: "id",
      header: "Transaction",
      sortValue: (row) => row.code,
      render: (row) => (
        <div>
          <p className="numeric font-medium">{row.code}</p>
          <p className="numeric text-[11px] text-[var(--muted-foreground)]">{row.reference}</p>
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
    { key: "type", header: "Type", sortValue: (row) => row.txnType },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      sortValue: (row) => num(row.amount),
      render: (row) => <span className="numeric font-medium">{formatCurrency(num(row.amount))}</span>,
      exportValue: (row) => num(row.amount),
    },
    {
      key: "commission",
      header: "Commission",
      align: "right",
      sortValue: (row) => num(row.commission),
      render: (row) =>
        num(row.commission) ? (
          <span className="numeric">{formatCurrency(num(row.commission))}</span>
        ) : (
          <span className="text-[var(--muted-foreground)]">—</span>
        ),
      exportValue: (row) => num(row.commission),
    },
    {
      key: "createdAt",
      header: "Timestamp",
      sortValue: (row) => row.occurredAt,
      render: (row) => formatDateTime(row.occurredAt),
      exportValue: (row) => row.occurredAt,
    },
    {
      key: "status",
      header: "Status",
      sortValue: (row) => row.status,
      render: (row) => <StatusBadge status={row.status} />,
      exportValue: (row) => row.status,
    },
  ];

  const success = rows.filter((row) => row.status === "Success");
  const pending = rows.filter((row) => row.status === "Pending");
  const failed = rows.filter((row) => row.status === "Failed");

  return (
    <>
      <PageHeader
        eyebrow="Bank operations"
        title="Transactions"
        description="Every rupee that moved — disbursals, EMI collections, commission credits, and refunds."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Processed value"
          value={formatCurrency(success.reduce((total, row) => total + num(row.amount), 0), { compact: true })}
          icon={ArrowLeftRight}
          helper={`${success.length} successful`}
        />
        <StatCard
          label="Commission credited"
          value={formatCurrency(rows.reduce((total, row) => total + num(row.commission), 0))}
          icon={CheckCircle2}
          accent="var(--success)"
          helper="booked against files"
          index={1}
        />
        <StatCard
          label="Pending"
          value={String(pending.length)}
          icon={Clock3}
          accent="var(--warning)"
          helper="awaiting bank confirmation"
          index={2}
        />
        <StatCard
          label="Failed"
          value={String(failed.length)}
          icon={CircleAlert}
          accent="var(--danger)"
          helper="needs re-initiation"
          index={3}
        />
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        exportName="risenext-transactions"
        searchPlaceholder="Search reference, customer, or transaction ID"
        searchText={(row) =>
          `${row.code} ${row.reference} ${customerName(row.customerId)} ${bankName(row.bankId)} ${row.txnType}`
        }
        filters={[
          {
            key: "status",
            label: "Status",
            options: ["Success", "Pending", "Failed"],
            value: (row) => row.status,
          },
          {
            key: "type",
            label: "Type",
            options: ["Disbursement", "EMI Collection", "Commission", "Refund"],
            value: (row) => row.txnType,
          },
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
        <DialogContent className="max-w-md">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.id}</DialogTitle>
                <DialogDescription>
                  {selected.txnType} · {bankName(selected.bankId)}
                </DialogDescription>
              </DialogHeader>
              <div>
                <DetailRow label="Customer" value={customerName(selected.customerId)} />
                <DetailRow label="Loan" value={selected.loanId} mono />
                <DetailRow label="Amount" value={formatCurrency(num(selected.amount))} mono />
                <DetailRow
                  label="Commission"
                  value={num(selected.commission) ? formatCurrency(num(selected.commission)) : "—"}
                  mono
                />
                <DetailRow label="Reference" value={selected.reference} mono />
                <DetailRow label="Timestamp" value={formatDateTime(selected.occurredAt)} />
                <DetailRow label="Status" value={<StatusBadge status={selected.status} />} />
              </div>
              <DialogFooter className="sm:justify-between">
                <Button variant="outline" asChild>
                  <Link href={`/customers/${selected.customerId}`}>Open customer</Link>
                </Button>
                <Button
                  variant="success"
                  disabled={selected.status === "Success"}
                  onClick={() => settle(selected)}
                >
                  Mark successful
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
