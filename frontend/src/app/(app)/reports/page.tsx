"use client";

import * as React from "react";
import { FileSpreadsheet, FileText, Filter, RotateCcw, Table2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { SectionCard } from "@/components/layout/section-card";
import { TrendChart } from "@/components/charts/trend-chart";
import { LoanStatusChart } from "@/components/charts/loan-status-chart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/format";
import { exportCsv, exportTallyXml, downloadFile } from "@/lib/export";
import { toast } from "sonner";
import { useReference } from "@/hooks/use-reference";
import { useResource, useRecord, useStats } from "@/hooks/use-api";
import { api, errorMessage } from "@/lib/api";
import { num } from "@/lib/types";
import type { Bank, Customer, Employee, Loan } from "@/lib/types";

export default function ReportsPage() {
  const { bankName, banks, employeeName, employees } = useReference();
  const { data: customersList } = useResource<Customer>("/customers", { pageSize: 500 });
  const customerName = (id: string | null) =>
    customersList.find((c) => c.id === id)?.name ?? "Unknown";
  const { data: loans } = useResource<Loan>("/loans", { pageSize: 500 });
  const loanStatusBreakdown = () =>
    loans.reduce<Record<string, number>>((acc, l) => {
      acc[l.status] = (acc[l.status] ?? 0) + 1;
      return acc;
    }, {});
  const monthlyTrend: { month: string; logins: number; disbursed: number; commission: number }[] =
    [];
  const [from, setFrom] = React.useState("2024-01-05");
  const [to, setTo] = React.useState("2024-05-31");
  const [bank, setBank] = React.useState("All");
  const [employee, setEmployee] = React.useState("All");
  const [status, setStatus] = React.useState("All");
  const [applied, setApplied] = React.useState(0);

  const rows = React.useMemo(() => {
    return loans.filter((loan) => {
      const inRange = (loan.appliedOn ?? loan.createdAt) >= from && (loan.appliedOn ?? loan.createdAt) <= to;
      const matchesBank = bank === "All" || bankName(loan.bankId) === bank;
      const matchesEmployee = employee === "All" || employeeName(loan.assignedUserId) === employee;
      const matchesStatus = status === "All" || loan.status === status;
      return inRange && matchesBank && matchesEmployee && matchesStatus;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, bank, employee, status, applied]);

  const exportRows = rows.map((loan, index) => ({
    "Sr No": index + 1,
    Customer: customerName(loan.customerId),
    Bank: bankName(loan.bankId),
    "Loan Type": loan.loanType,
    Amount: num(loan.amountApproved) || num(loan.amountRequested),
    Status: loan.status,
    Employee: employeeName(loan.assignedUserId),
    Commission: num(loan.commission),
    "Applied On": (loan.appliedOn ?? loan.createdAt),
  }));

  function exportExcel() {
    const header = Object.keys(exportRows[0] ?? { Report: "empty" });
    const body = exportRows
      .map((row) => header.map((key) => String((row as Record<string, unknown>)[key] ?? "")))
      .map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
      .join("");
    const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8" /></head><body><table border="1"><thead><tr>${header
      .map((cell) => `<th>${cell}</th>`)
      .join("")}</tr></thead><tbody>${body}</tbody></table></body></html>`;
    downloadFile("risenext-loan-report.xls", html, "application/vnd.ms-excel");
    toast.success("Excel exported", { description: `${exportRows.length} rows` });
  }

  function exportPdf() {
    const win = window.open("", "_blank");
    if (!win) {
      toast.error("Popup blocked", { description: "Allow popups to generate the PDF." });
      return;
    }
    const header = Object.keys(exportRows[0] ?? { Report: "empty" });
    win.document.write(`<html><head><title>Rise Next loan report</title>
      <style>
        body{font-family:system-ui,sans-serif;padding:28px;color:#0f1c30}
        h1{font-size:18px;margin:0 0 4px}
        p{font-size:12px;color:#5c7291;margin:0 0 16px}
        table{width:100%;border-collapse:collapse;font-size:11px}
        th{background:#eef2f8;text-align:left;padding:6px;border:1px solid #dfe5ee}
        td{padding:6px;border:1px solid #dfe5ee}
      </style></head><body>
      <h1>Rise Next Banking Services — Loan report</h1>
      <p>${formatDate(from)} to ${formatDate(to)} · ${exportRows.length} records</p>
      <table><thead><tr>${header.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead>
      <tbody>${exportRows
        .map(
          (row) =>
            `<tr>${header
              .map((key) => `<td>${String((row as Record<string, unknown>)[key] ?? "")}</td>`)
              .join("")}</tr>`,
        )
        .join("")}</tbody></table></body></html>`);
    win.document.close();
    win.print();
    toast.success("PDF ready", { description: "Print dialog opened for the report." });
  }

  function reset() {
    setFrom("2024-01-05");
    setTo("2024-05-31");
    setBank("All");
    setEmployee("All");
    setStatus("All");
    setApplied((prev) => prev + 1);
    toast.info("Filters cleared");
  }

  const totalValue = rows.reduce(
    (total, loan) => total + (num(loan.amountApproved) || num(loan.amountRequested)),
    0,
  );
  const totalCommission = rows.reduce((total, loan) => total + num(loan.commission), 0);

  return (
    <>
      <PageHeader
        eyebrow="Records"
        title="Reports and export"
        description="Slice the book by period, lender, employee, or status — then push it to Excel, CSV, PDF, or Tally."
      />

      <SectionCard
        title="Report filters"
        description="Everything below reacts to these settings"
        contentClassName="grid gap-3 md:grid-cols-3 xl:grid-cols-6"
        action={
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw className="size-3.5" /> Reset
          </Button>
        }
      >
        <div className="space-y-1.5">
          <Label htmlFor="r-from">From</Label>
          <Input id="r-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r-to">To</Label>
          <Input id="r-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Bank</Label>
          <Select value={bank} onValueChange={setBank}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All banks</SelectItem>
              {banks.map((item) => (
                <SelectItem key={item.id} value={item.name}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Employee</Label>
          <Select value={employee} onValueChange={setEmployee}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All employees</SelectItem>
              {employees.map((item) => (
                <SelectItem key={item.id} value={item.name}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All statuses</SelectItem>
              {["Draft", "Submitted", "Under Review", "Approved", "Disbursed", "Rejected", "Closed"].map(
                (item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button
            className="w-full"
            onClick={() => {
              setApplied((prev) => prev + 1);
              toast.success("Filters applied", { description: `${rows.length} records matched` });
            }}
          >
            <Filter className="size-4" /> Apply
          </Button>
        </div>
      </SectionCard>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Records" value={String(rows.length)} icon={Table2} helper="in this report" />
        <StatCard
          label="Report value"
          value={formatCurrency(totalValue, { compact: true })}
          icon={FileSpreadsheet}
          accent="var(--success)"
          helper="sanctioned or requested"
          index={1}
        />
        <StatCard
          label="Commission"
          value={formatCurrency(totalCommission)}
          icon={FileText}
          accent="var(--info)"
          helper="gross for this slice"
          index={2}
        />
        <StatCard
          label="Approval rate"
          value={`${rows.length ? Math.round((rows.filter((r) => ["Approved", "Disbursed"].includes(r.status)).length / rows.length) * 100) : 0}%`}
          icon={Filter}
          accent="var(--warning)"
          helper="of files in range"
          index={3}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <SectionCard title="Volume trend" description="Disbursals against commission" className="xl:col-span-2">
          <TrendChart rows={monthlyTrend} />
        </SectionCard>
        <SectionCard title="Status mix" description="Whole book, all periods">
          <LoanStatusChart data={loanStatusBreakdown()} />
        </SectionCard>
      </div>

      <SectionCard
        title="Loan report"
        description={`${rows.length} records from ${formatDate(from)} to ${formatDate(to)}`}
        contentClassName="px-0 pb-0"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="success" size="sm" onClick={exportExcel}>
              Excel
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                exportCsv("risenext-loan-report", exportRows);
                toast.success("CSV exported", { description: `${exportRows.length} rows` });
              }}
            >
              CSV
            </Button>
            <Button variant="destructive" size="sm" onClick={exportPdf}>
              PDF
            </Button>
            <Button
              variant="navy"
              size="sm"
              onClick={() => {
                exportTallyXml(
                  "risenext-loan-report-tally",
                  rows.map((loan) => ({
                    date: (loan.appliedOn ?? loan.createdAt),
                    narration: `${customerName(loan.customerId)} · ${loan.loanType}`,
                    party: bankName(loan.bankId),
                    amount: num(loan.commission),
                  })),
                );
                toast.success("Tally XML exported");
              }}
            >
              Tally XML
            </Button>
          </div>
        }
      >
        <Table>
          <TableHeader className="bg-[color-mix(in_oklab,var(--secondary)_70%,transparent)]">
            <TableRow>
              <TableHead>Sr</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Bank</TableHead>
              <TableHead>Loan type</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Employee</TableHead>
              <TableHead className="text-right">Commission</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((loan, index) => (
              <TableRow key={loan.id}>
                <TableCell className="numeric text-[var(--muted-foreground)]">{index + 1}</TableCell>
                <TableCell className="font-medium">{customerName(loan.customerId)}</TableCell>
                <TableCell>{bankName(loan.bankId)}</TableCell>
                <TableCell>{loan.loanType}</TableCell>
                <TableCell className="numeric text-right">
                  {formatCurrency(num(loan.amountApproved) || num(loan.amountRequested))}
                </TableCell>
                <TableCell>
                  <StatusBadge status={loan.status} />
                </TableCell>
                <TableCell>{employeeName(loan.assignedUserId)}</TableCell>
                <TableCell className="numeric text-right">
                  {num(loan.commission) ? formatCurrency(num(loan.commission)) : "—"}
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-sm text-[var(--muted-foreground)]">
                  Nothing matched this range. Widen the dates or clear a filter.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </SectionCard>
    </>
  );
}
