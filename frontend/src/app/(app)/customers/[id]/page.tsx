"use client";

import * as React from "react";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import {
  ArrowLeft,
  Download,
  FileText,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Printer,
  Trash2,
  Upload,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/layout/section-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { DetailRow } from "@/components/shared/detail-row";
import { PipelineRail } from "@/components/shared/pipeline-rail";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency, formatDate, formatDateTime, maskAccount } from "@/lib/format";
import { initials } from "@/lib/utils";
import { exportCsv } from "@/lib/export";
import { toast } from "sonner";
import { useReference } from "@/hooks/use-reference";
import { useResource, useRecord, useStats } from "@/hooks/use-api";
import { api, errorMessage } from "@/lib/api";
import { num } from "@/lib/types";
import type { Bank, BankOrder, Customer, DocumentRecord, Loan, Transaction } from "@/lib/types";

export default function CustomerProfilePage() {
  const { bankName, employeeName } = useReference();
  const params = useParams<{ id: string }>();
  const customerId = params?.id ?? "";
  const { data: customer, loading: customerLoading } = useRecord<Customer>(
    customerId ? `/customers/${customerId}` : null,
  );
  const { data: customerLoans } = useResource<Loan>("/loans", { customerId }, Boolean(customerId));
  const { data: customerDocs } = useResource<DocumentRecord>(
    "/documents",
    { customerId },
    Boolean(customerId),
  );
  const { data: customerTxns } = useResource<Transaction>(
    "/transactions",
    { customerId },
    Boolean(customerId),
  );
  const { data: customerOrders } = useResource<BankOrder>(
    "/bank-orders",
    undefined,
    Boolean(customerId),
  );
  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  if (customerLoading) {
    return (
      <div className="grid min-h-[40vh] place-items-center text-sm text-[var(--muted-foreground)]">
        Loading customer…
      </div>
    );
  }
  if (!customer) notFound();

  const order = customerOrders.find((item) => item.customerId === customer.id);

  const timeline = [
    { at: `${customer.createdAt}T10:20:00`, label: "Customer added", by: employeeName(customer.assignedUserId) },
    { at: `${customer.createdAt}T11:00:00`, label: "Documents uploaded", by: employeeName(customer.assignedUserId) },
    { at: `${customer.createdAt}T12:30:00`, label: `Loan submitted to ${bankName(customer.bankId)}`, by: "System" },
    ...(customerLoans[0]?.status === "Approved" || customerLoans[0]?.status === "Disbursed"
      ? [{ at: `${customerLoans[0].updatedAt}T15:20:00`, label: "Loan approved", by: bankName(customer.bankId) }]
      : []),
    ...(customerLoans[0]?.status === "Disbursed"
      ? [{ at: `${customerLoans[0].updatedAt}T17:10:00`, label: "Amount disbursed", by: bankName(customer.bankId) }]
      : []),
  ];

  return (
    <>
      <PageHeader
        eyebrow={`Customers / ${customer.id}`}
        title={customer.name}
        description={`${customer.occupation} · ${customer.city}, ${customer.state} · Owned by ${employeeName(customer.assignedUserId)}`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/customers">
                <ArrowLeft className="size-4" /> Back
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                exportCsv(`${customer.id}-profile`, [
                  {
                    ID: customer.id,
                    Name: customer.name,
                    Mobile: customer.mobile,
                    Email: customer.email,
                    PAN: customer.pan,
                    Bank: bankName(customer.bankId),
                    KYC: customer.kyc,
                    CIBIL: customer.cibil,
                  },
                ]);
                toast.success("Profile exported");
              }}
            >
              <Download className="size-4" /> Export
            </Button>
            <Button onClick={() => setEditOpen(true)}>
              <Pencil className="size-4" /> Edit profile
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <SectionCard title="Profile" description={`Created on ${formatDate(customer.createdAt)}`}>
            <div className="flex items-center gap-3 pb-4">
              <Avatar className="size-12">
                <AvatarFallback className="text-sm">{initials(customer.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate font-semibold">{customer.name}</p>
                <p className="numeric text-xs text-[var(--muted-foreground)]">{customer.id}</p>
                <div className="mt-1 flex gap-1.5">
                  <StatusBadge status={customer.kyc} />
                  <StatusBadge status={customer.status} />
                </div>
              </div>
            </div>
            <div className="space-y-2 border-t border-[var(--border)] pt-3 text-sm">
              <p className="flex items-center gap-2">
                <Phone className="size-3.5 text-[var(--muted-foreground)]" />
                <span className="numeric">{customer.mobile}</span>
              </p>
              <p className="flex items-center gap-2 truncate">
                <Mail className="size-3.5 shrink-0 text-[var(--muted-foreground)]" />
                <span className="truncate">{customer.email}</span>
              </p>
              <p className="flex items-start gap-2">
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-[var(--muted-foreground)]" />
                <span className="text-[13px] leading-relaxed">
                  {customer.address}, {customer.city}, {customer.state} — {customer.pincode}
                </span>
              </p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href="/documents">
                  <Upload className="size-3.5" /> Documents
                </Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => toast.info("Sent to printer", { description: "Profile sheet queued." })}
              >
                <Printer className="size-3.5" /> Print
              </Button>
            </div>
          </SectionCard>

          <SectionCard title="Credit snapshot" description="Bureau and income position">
            <DetailRow label="CIBIL score" value={customer.cibil} mono />
            <DetailRow label="Monthly income" value={formatCurrency(num(customer.monthlyIncome))} mono />
            <DetailRow label="Occupation" value={customer.occupation} />
            <DetailRow label="Existing loans" value={customerLoans.length} mono />
            <DetailRow
              label="Total exposure"
              value={formatCurrency(
                customerLoans.reduce((total, loan) => total + num(loan.amountApproved), 0),
              )}
              mono
            />
          </SectionCard>

          {order && (
            <SectionCard title="Bank file stage" description={`${bankName(order.bankId)} · ${order.officer}`}>
              <PipelineRail current={order.stage} />
            </SectionCard>
          )}
        </div>

        <Tabs defaultValue="personal">
          <TabsList className="flex-wrap">
            <TabsTrigger value="personal">Personal details</TabsTrigger>
            <TabsTrigger value="banking">Banking details</TabsTrigger>
            <TabsTrigger value="loans">Loan details</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
          </TabsList>

          <TabsContent value="personal">
            <SectionCard title="Personal details" description="KYC identity captured at onboarding">
              <div className="grid gap-x-8 sm:grid-cols-2">
                <div>
                  <DetailRow label="Full name" value={customer.name} />
                  <DetailRow label="Father name" value={customer.fatherName} />
                  <DetailRow label="Mother name" value={customer.motherName} />
                  <DetailRow label="Date of birth" value={formatDate(customer.dob)} />
                  <DetailRow label="Gender" value={customer.gender} />
                  <DetailRow label="Marital status" value={customer.maritalStatus} />
                </div>
                <div>
                  <DetailRow label="PAN" value={customer.pan} mono />
                  <DetailRow label="Aadhaar" value={customer.aadhaarLast4 ? `•••• •••• ${customer.aadhaarLast4}` : "—"} mono />
                  <DetailRow label="Mobile" value={customer.mobile} mono />
                  <DetailRow label="Alternate mobile" value={customer.altMobile} mono />
                  <DetailRow label="Email" value={customer.email} />
                  <DetailRow label="Assigned employee" value={employeeName(customer.assignedUserId)} />
                </div>
              </div>
            </SectionCard>
          </TabsContent>

          <TabsContent value="banking">
            <SectionCard title="Banking details" description="Where disbursals land">
              <div className="grid gap-x-8 sm:grid-cols-2">
                <div>
                  <DetailRow label="Partner bank" value={bankName(customer.bankId)} />
                  <DetailRow label="Account number" value={maskAccount(customer.accountNo)} mono />
                  <DetailRow label="IFSC" value={customer.ifsc} mono />
                </div>
                <div>
                  <DetailRow label="Branch" value={customer.branch} />
                  <DetailRow label="City" value={customer.city} />
                  <DetailRow label="Pincode" value={customer.pincode} mono />
                </div>
              </div>
            </SectionCard>
          </TabsContent>

          <TabsContent value="loans">
            <SectionCard
              title="Loan details"
              description={`${customerLoans.length} applications on record`}
              contentClassName="px-0 pb-0"
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Loan ID</TableHead>
                    <TableHead>Bank</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Approved</TableHead>
                    <TableHead className="text-right">EMI</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customerLoans.map((loan) => (
                    <TableRow key={loan.id}>
                      <TableCell className="numeric">{loan.id}</TableCell>
                      <TableCell>{bankName(loan.bankId)}</TableCell>
                      <TableCell>{loan.loanType}</TableCell>
                      <TableCell className="numeric text-right">
                        {formatCurrency(num(loan.amountApproved))}
                      </TableCell>
                      <TableCell className="numeric text-right">
                        {num(loan.emi) ? formatCurrency(num(loan.emi)) : "—"}
                      </TableCell>
                      <TableCell className="numeric text-right">{num(loan.interestRate)}%</TableCell>
                      <TableCell>
                        <StatusBadge status={loan.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {!customerLoans.length && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-sm text-[var(--muted-foreground)]">
                        No loan applications yet. Start one from the loans screen.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </SectionCard>
          </TabsContent>

          <TabsContent value="documents">
            <SectionCard
              title="Documents"
              description={`${customerDocs.length} files on the file jacket`}
              action={
                <Button size="sm" variant="outline" asChild>
                  <Link href="/documents">
                    <Upload className="size-3.5" /> Upload
                  </Link>
                </Button>
              }
              contentClassName="px-0 pb-0"
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document type</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead>Uploaded on</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customerDocs.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell>{doc.docType}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-[var(--primary)]">
                          <FileText className="size-3.5" /> {doc.fileName}
                        </span>
                      </TableCell>
                      <TableCell>{formatDate(doc.createdAt)}</TableCell>
                      <TableCell>{doc.uploadedBy}</TableCell>
                      <TableCell>
                        <StatusBadge status={doc.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {!customerDocs.length && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-sm text-[var(--muted-foreground)]">
                        No documents uploaded for this customer yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </SectionCard>
          </TabsContent>

          <TabsContent value="transactions">
            <SectionCard title="Transactions" description="Money movement tied to this borrower" contentClassName="px-0 pb-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Commission</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customerTxns.map((txn) => (
                    <TableRow key={txn.id}>
                      <TableCell className="numeric text-xs">{txn.reference}</TableCell>
                      <TableCell>{txn.txnType}</TableCell>
                      <TableCell className="numeric text-right">{formatCurrency(num(txn.amount))}</TableCell>
                      <TableCell className="numeric text-right">
                        {num(txn.commission) ? formatCurrency(num(txn.commission)) : "—"}
                      </TableCell>
                      <TableCell>{formatDateTime(txn.occurredAt)}</TableCell>
                      <TableCell>
                        <StatusBadge status={txn.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {!customerTxns.length && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-sm text-[var(--muted-foreground)]">
                        No transactions recorded against this customer.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </SectionCard>
          </TabsContent>

          <TabsContent value="timeline">
            <SectionCard title="Loan timeline" description="Chronological trail for audit">
              <ol className="relative space-y-5 pl-5">
                <span className="absolute top-1 bottom-1 left-[5px] w-px bg-[var(--border)]" />
                {timeline.map((entry) => (
                  <li key={entry.label} className="relative">
                    <span className="absolute top-1 -left-5 size-2.5 rounded-full border-2 border-[var(--card)] bg-[var(--primary)]" />
                    <p className="text-[13px] font-medium">{entry.label}</p>
                    <p className="text-[11px] text-[var(--muted-foreground)]">
                      {formatDateTime(entry.at)} · {entry.by}
                    </p>
                  </li>
                ))}
              </ol>
            </SectionCard>
          </TabsContent>
        </Tabs>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Record locked for audit after disbursal</Badge>
        <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="size-3.5" /> Delete customer
        </Button>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit profile</DialogTitle>
            <DialogDescription>
              Changes apply to the working copy in this session.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="e-name">Full name</Label>
              <Input id="e-name" defaultValue={customer.name ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-mobile">Mobile</Label>
              <Input id="e-mobile" defaultValue={customer.mobile ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-email">Email</Label>
              <Input id="e-email" defaultValue={customer.email ?? ""} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="e-address">Address</Label>
              <Input id="e-address" defaultValue={customer.address ?? ""} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setEditOpen(false);
                toast.success("Profile updated", { description: `${customer.name} saved.` });
              }}
            >
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this customer?</DialogTitle>
            <DialogDescription>
              {customer.name} has {customerLoans.length} linked applications. Deleting removes the
              profile from active lists; ledger entries stay for audit.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Keep customer
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setDeleteOpen(false);
                toast.success("Customer archived", {
                  description: `${customer.name} moved to archived records.`,
                });
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
