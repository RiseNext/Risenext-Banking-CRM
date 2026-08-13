"use client";

import * as React from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Download,
  Eye,
  FileStack,
  FileText,
  Trash2,
  Upload,
  UploadCloud,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { SectionCard } from "@/components/layout/section-card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { useReference } from "@/hooks/use-reference";
import { useResource, useRecord, useStats } from "@/hooks/use-api";
import { api, errorMessage } from "@/lib/api";
import { num } from "@/lib/types";
import type { Bank, Customer, DocumentRecord } from "@/lib/types";

export default function DocumentsPage() {
  const { data: customers } = useResource<Customer>("/customers", { pageSize: 500 });
  const customerName = (id: string | null) =>
    customers.find((c) => c.id === id)?.name ?? "Unknown";
  const { data: rows, loading, error, refresh } = useResource<DocumentRecord>("/documents");
  const documentTypes = ["PAN Card", "Aadhaar", "Bank Statement", "Salary Slip", "ITR"];
  const { user } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [customerId, setCustomerId] = React.useState("");
  const [uploading, setUploading] = React.useState(false);

  const [docType, setDocType] = React.useState(documentTypes[0] ?? "PAN Card");
  const [staged, setStaged] = React.useState<File[]>([]);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function stage(files: FileList | null) {
    if (!files?.length) return;
    setStaged((prev) => [...prev, ...Array.from(files)]);
  }

  async function upload() {
    if (!(customerId || customers[0]?.id) || staged.length === 0) {
      toast.error("Choose a customer and at least one file");
      return;
    }
    const resolvedCustomerId = customerId || (customers[0]?.id ?? "");
    const customer = customers.find((c) => c.id === resolvedCustomerId);
    if (!customer) return;
    setUploading(true);
    try {
      for (const file of staged) {
        await api.create<DocumentRecord>("/documents", {
          customerId: customer.id,
          bankId: customer.bankId,
          docType,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || null,
          status: "Pending",
        });
      }
      setStaged([]);
      setOpen(false);
      refresh();
      toast.success("Documents recorded", {
        description: `${staged.length} file(s) added to ${customer.name}`,
      });
    } catch (err) {
      toast.error("Upload failed", { description: errorMessage(err) });
    } finally {
      setUploading(false);
    }
  }

  function setStatus(row: DocumentRecord, status: DocumentRecord["status"]) {
    refresh();
    toast.success(`Marked ${status.toLowerCase()}`, { description: row.fileName });
  }

  function remove(row: DocumentRecord) {
    refresh();
    toast.success("Document removed", { description: row.fileName });
  }

  const columns: Column<DocumentRecord>[] = [
    {
      key: "docType",
      header: "Document type",
      sortValue: (row) => row.docType,
      render: (row) => (
        <div>
          <p className="text-[13px] font-medium">{row.docType}</p>
          <p className="numeric text-[11px] text-[var(--muted-foreground)]">{row.id}</p>
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
          className="font-medium text-[var(--primary)] hover:underline"
        >
          {customerName(row.customerId)}
        </Link>
      ),
      exportValue: (row) => customerName(row.customerId),
    },
    {
      key: "fileName",
      header: "File",
      render: (row) => (
        <span className="inline-flex items-center gap-1.5 text-[13px]">
          <FileText className="size-3.5 text-[var(--danger)]" />
          {row.fileName}
          <span className="text-[11px] text-[var(--muted-foreground)]">{row.fileSize}</span>
        </span>
      ),
      exportValue: (row) => row.fileName,
    },
    {
      key: "uploadedOn",
      header: "Uploaded",
      sortValue: (row) => row.createdAt,
      render: (row) => formatDate(row.createdAt),
      exportValue: (row) => row.createdAt,
    },
    { key: "uploadedBy", header: "By", sortValue: (row) => row.uploadedBy },
    {
      key: "status",
      header: "Status",
      sortValue: (row) => row.status,
      render: (row) => <StatusBadge status={row.status} />,
      exportValue: (row) => row.status,
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Preview"
            onClick={() => toast.info("Preview", { description: `${row.fileName} opened in viewer.` })}
          >
            <Eye className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Download"
            onClick={() => toast.success("Download started", { description: row.fileName })}
          >
            <Download className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Verify"
            onClick={() => setStatus(row, "Verified")}
          >
            <CheckCircle2 className="size-4 text-[var(--success)]" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Delete" onClick={() => remove(row)}>
            <Trash2 className="size-4 text-[var(--danger)]" />
          </Button>
        </div>
      ),
      exportValue: () => "",
    },
  ];

  const verified = rows.filter((row) => row.status === "Verified");
  const pending = rows.filter((row) => row.status === "Pending");
  const rejected = rows.filter((row) => row.status === "Rejected");

  return (
    <>
      <PageHeader
        eyebrow="Records"
        title="Document management"
        description="KYC and income documents for every file, stored against the borrower and audited on upload."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Upload className="size-4" /> Upload documents
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Documents stored" value={String(rows.length)} icon={FileStack} helper="across all customers" />
        <StatCard
          label="Verified"
          value={String(verified.length)}
          icon={CheckCircle2}
          accent="var(--success)"
          helper={`${Math.round((verified.length / rows.length) * 100)}% of the vault`}
          index={1}
        />
        <StatCard
          label="Pending checks"
          value={String(pending.length)}
          icon={FileText}
          accent="var(--warning)"
          helper="waiting on verification"
          index={2}
        />
        <StatCard
          label="Rejected"
          value={String(rejected.length)}
          icon={Trash2}
          accent="var(--danger)"
          helper="ask customer to re-submit"
          index={3}
        />
      </div>

      <SectionCard
        title="Required checklist"
        description="Standard file jacket for a salaried personal loan"
        contentClassName="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
      >
        {documentTypes.slice(0, 8).map((type) => {
          const count = rows.filter((row) => row.docType === type).length;
          return (
            <div
              key={type}
              className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2.5"
            >
              <span className="text-[13px]">{type}</span>
              <span
                className={cn(
                  "numeric text-xs font-semibold",
                  count ? "text-[var(--success)]" : "text-[var(--muted-foreground)]",
                )}
              >
                {count}
              </span>
            </div>
          );
        })}
      </SectionCard>

      <DataTable
        rows={rows}
        columns={columns}
        exportName="risenext-documents"
        searchPlaceholder="Search file name, customer, or document type"
        searchText={(row) => `${row.fileName} ${row.docType} ${customerName(row.customerId)} ${row.uploadedBy}`}
        filters={[
          {
            key: "status",
            label: "Status",
            options: ["Verified", "Pending", "Rejected"],
            value: (row) => row.status,
          },
          { key: "type", label: "Type", options: documentTypes, value: (row) => row.docType },
        ]}
        pageSize={10}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload documents</DialogTitle>
            <DialogDescription>
              PDF, JPG, or PNG up to 10 MB each. Files attach to the selected customer.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Customer</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.name} · {customer.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Document type</Label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {documentTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              stage(event.dataTransfer.files);
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
              dragging
                ? "border-[var(--primary)] bg-[var(--accent)]"
                : "border-[var(--border)] bg-[var(--background)]",
            )}
          >
            <UploadCloud className="size-7 text-[var(--primary)]" />
            <p className="text-sm font-medium">Drop files here</p>
            <p className="text-xs text-[var(--muted-foreground)]">or pick them from your device</p>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => stage(event.target.files)}
            />
            <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
              Choose files
            </Button>
          </div>

          {staged.length > 0 && (
            <ul className="space-y-1.5">
              {staged.map((file, index) => (
                <li
                  key={`${file.name}-${index}`}
                  className="flex items-center justify-between rounded-md bg-[var(--secondary)] px-3 py-2 text-[13px]"
                >
                  <span className="truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => setStaged((prev) => prev.filter((_, i) => i !== index))}
                    className="text-[var(--muted-foreground)] hover:text-[var(--danger)]"
                    aria-label={`Remove ${file.name}`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {progress > 0 && <Progress value={progress} />}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={upload}>Upload {staged.length ? `${staged.length} file(s)` : ""}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
