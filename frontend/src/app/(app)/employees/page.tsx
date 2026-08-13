"use client";

import * as React from "react";
import { Award, Plus, ShieldCheck, UserCog, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { DetailRow } from "@/components/shared/detail-row";
import { SectionCard } from "@/components/layout/section-card";
import { EmployeeTargetChart } from "@/components/charts/employee-target-chart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
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
import { formatCurrency, formatDate } from "@/lib/format";
import { initials } from "@/lib/utils";
import { toast } from "sonner";
import { useReference } from "@/hooks/use-reference";
import { useResource, useRecord, useStats } from "@/hooks/use-api";
import { api, errorMessage } from "@/lib/api";
import { num } from "@/lib/types";
import type { Customer, Employee, Loan, Team } from "@/lib/types";

const permissions = [
  { key: "customers", label: "Create and edit customers" },
  { key: "documents", label: "Verify uploaded documents" },
  { key: "loans", label: "Submit files to banks" },
  { key: "ledger", label: "Post ledger vouchers" },
  { key: "settlements", label: "Close settlement invoices" },
  { key: "employees", label: "Manage team members" },
];

export default function EmployeesPage() {
  const { bankName, banks } = useReference();
  const { data: rows, loading, error, refresh } = useResource<Employee>("/users", {
    pageSize: 200,
  });
  const { data: customers } = useResource<Customer>("/customers", { pageSize: 500 });
  const { data: loans } = useResource<Loan>("/loans", { pageSize: 500 });
  const [selected, setSelected] = React.useState<Employee | null>(null);
  const [open, setOpen] = React.useState(false);
  const { data: roles } = useResource<{ id: string; name: string; level: number }>("/roles");
  const [form, setForm] = React.useState({
    name: "",
    email: "",
    phone: "",
    roleId: "",
    branch: "Hyderabad",
    target: "8000000",
  });

  const resolvedRoleId = form.roleId || (roles[0]?.id ?? "");

  // Only roles the signed-in user is allowed to assign are offered; the server

  async function addEmployee() {
    if (!form.name.trim() || !form.email.includes("@")) {
      toast.error("Missing details", { description: "Name and a valid work email are required." });
      return;
    }
    try {
      const created = await api.create<{ id: string; name: string }>("/users", {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone || null,
        employeeCode: `EMP-${Date.now().toString().slice(-6)}`,
        roleId: resolvedRoleId,
        branch: form.branch || null,
        status: "Active",
        target: Number(form.target) || 0,
      });
      setOpen(false);
      setForm({ ...form, name: "", email: "", phone: "" });
      refresh();
      toast.success("Team member added", { description: created.data.name });
    } catch (err) {
      // A 403 is the backend refusing to let you create a peer or a superior.
      toast.error("Could not add user", { description: errorMessage(err) });
    }
  }

  function toggleStatus(employee: Employee) {
    const status = employee.status === "Active" ? "Inactive" : "Active";
    refresh();
    setSelected((prev) => (prev ? { ...prev, status } : prev));
    toast.success(`Access ${status === "Active" ? "restored" : "revoked"}`, {
      description: employee.name,
    });
  }

  const columns: Column<Employee>[] = [
    {
      key: "name",
      header: "Employee",
      sortValue: (row) => row.name,
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8">
            <AvatarFallback style={{ background: `${(row.avatarColor ?? "#1d4ed8")}1a`, color: (row.avatarColor ?? "#1d4ed8") }}>
              {initials(row.name)}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium">{row.name}</p>
            <p className="numeric text-[11px] text-[var(--muted-foreground)]">{row.id}</p>
          </div>
        </div>
      ),
    },
    { key: "role", header: "Role", sortValue: (row) => row.roleName },
    { key: "branch", header: "Branch", sortValue: (row) => row.branch },
    {
      key: "assignedBanks",
      header: "Banks",
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.assignedBanks.slice(0, 2).map((bankId) => (
            <Badge key={bankId} variant="outline">
              {bankName(bankId)}
            </Badge>
          ))}
          {row.assignedBanks.length > 2 && (
            <Badge variant="neutral">+{row.assignedBanks.length - 2}</Badge>
          )}
        </div>
      ),
      exportValue: (row) => row.assignedBanks.map(bankName).join(" | "),
    },
    {
      key: "target",
      header: "Target",
      align: "right",
      sortValue: (row) => row.target,
      render: (row) => (
        <span className="numeric">
          {row.target ? formatCurrency(row.target, { compact: true }) : "—"}
        </span>
      ),
      exportValue: (row) => row.target,
    },
    {
      key: "achievement",
      header: "Achievement",
      sortValue: (row) => (row.target ? row.achieved / row.target : 0),
      render: (row) => {
        if (!row.target) return <span className="text-[var(--muted-foreground)]">—</span>;
        const percent = Math.round((row.achieved / row.target) * 100);
        return (
          <div className="flex w-32 items-center gap-2">
            <Progress
              value={percent}
              indicatorClassName={percent >= 100 ? "bg-[var(--success)]" : undefined}
            />
            <span className="numeric text-xs">{percent}%</span>
          </div>
        );
      },
      exportValue: (row) => (row.target ? Math.round((row.achieved / row.target) * 100) : 0),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (row) => row.status,
      render: (row) => <StatusBadge status={row.status} />,
      exportValue: (row) => row.status,
    },
  ];

  const active = rows.filter((row) => row.status === "Active");
  const chartRows = rows.filter((row) => row.target > 0).slice(0, 6);

  return (
    <>
      <PageHeader
        eyebrow="Records"
        title="Employees"
        description="Team members, the banks they can log files with, and how they are tracking against target."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" /> Add employee
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Team size" value={String(rows.length)} icon={Users} helper={`${active.length} active`} />
        <StatCard
          label="Combined target"
          value={formatCurrency(rows.reduce((total, row) => total + row.target, 0), { compact: true })}
          icon={Award}
          accent="var(--info)"
          helper="quarter to date"
          index={1}
        />
        <StatCard
          label="Achieved"
          value={formatCurrency(rows.reduce((total, row) => total + row.achieved, 0), { compact: true })}
          icon={Award}
          accent="var(--success)"
          helper="disbursed volume credited"
          index={2}
        />
        <StatCard
          label="Managers"
          value={String(rows.filter((row) => row.roleName === "Manager").length)}
          icon={UserCog}
          accent="var(--warning)"
          helper="with approval rights"
          index={3}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <SectionCard
          title="Target vs achieved"
          description="Volume credited against each team member"
          className="xl:col-span-2"
        >
          <EmployeeTargetChart rows={chartRows} />
        </SectionCard>

        <SectionCard
          title="Permissions"
          description="What each role can do in the workspace"
          contentClassName="space-y-2.5"
        >
          {permissions.map((permission, index) => (
            <div key={permission.key} className="flex items-center justify-between gap-3">
              <span className="text-[13px]">{permission.label}</span>
              <Switch
                defaultChecked={index < 4}
                onCheckedChange={(checked) =>
                  toast.success(checked ? "Permission granted" : "Permission revoked", {
                    description: permission.label,
                  })
                }
              />
            </div>
          ))}
          <p className="flex items-center gap-1.5 pt-1 text-[11px] text-[var(--muted-foreground)]">
            <ShieldCheck className="size-3.5" /> Super Admin always keeps full access.
          </p>
        </SectionCard>
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        exportName="risenext-employees"
        searchPlaceholder="Search name, email, or branch"
        searchText={(row) => `${row.name} ${row.id} ${row.email} ${row.branch} ${row.roleName}`}
        filters={[
          {
            key: "role",
            label: "Role",
            options: ["Super Admin", "Admin", "Manager", "Employee"],
            value: (row) => row.roleName,
          },
          { key: "status", label: "Status", options: ["Active", "Inactive"], value: (row) => row.status },
        ]}
        onRowClick={(row) => setSelected(row)}
      />

      <Dialog open={Boolean(selected)} onOpenChange={(value) => !value && setSelected(null)}>
        <DialogContent className="max-w-md">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.name}</DialogTitle>
                <DialogDescription>
                  {selected.roleName} · {selected.branch}
                </DialogDescription>
              </DialogHeader>
              <div>
                <DetailRow label="Employee ID" value={selected.id} mono />
                <DetailRow label="Email" value={selected.email} />
                <DetailRow label="Phone" value={selected.phone} mono />
                <DetailRow label="Joined" value={formatDate(selected.joinedOn)} />
                <DetailRow
                  label="Assigned banks"
                  value={selected.assignedBanks.map(bankName).join(", ")}
                />
                <DetailRow
                  label="Customers owned"
                  value={customers.filter((c) => c.assignedUserId === selected.id).length}
                  mono
                />
                <DetailRow
                  label="Files logged"
                  value={loans.filter((loan) => loan.assignedUserId === selected.id).length}
                  mono
                />
                <DetailRow label="Status" value={<StatusBadge status={selected.status} />} />
              </div>
              <DialogFooter className="sm:justify-between">
                <Button
                  variant="outline"
                  onClick={() =>
                    toast.info("Reset link sent", { description: `Emailed to ${selected.email}` })
                  }
                >
                  Send password reset
                </Button>
                <Button
                  variant={selected.status === "Active" ? "destructive" : "success"}
                  onClick={() => toggleStatus(selected)}
                >
                  {selected.status === "Active" ? "Revoke access" : "Restore access"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add employee</DialogTitle>
            <DialogDescription>
              They receive an invite email and can sign in with the role you pick.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="emp-name">Full name</Label>
              <Input
                id="emp-name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-email">Work email</Label>
              <Input
                id="emp-email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                placeholder="name@risenext.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-phone">Phone</Label>
              <Input
                id="emp-phone"
                value={form.phone}
                maxLength={10}
                onChange={(event) =>
                  setForm({ ...form, phone: event.target.value.replace(/\D/g, "") })
                }
              />
            </div>
            <div className="space-y-1.5">
  <Label htmlFor="emp-role">Role</Label>

  <Select
    value={resolvedRoleId}
    onValueChange={(value) =>
      setForm({ ...form, roleId: value })
    }
  >
    <SelectTrigger>
      <SelectValue placeholder="Select role" />
    </SelectTrigger>

    <SelectContent>
      {roles.map((role) => (
        <SelectItem key={role.id} value={role.id}>
          {role.name}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-target">Quarterly target</Label>
              <Input
                id="emp-target"
                value={form.target}
                onChange={(event) =>
                  setForm({ ...form, target: event.target.value.replace(/\D/g, "") })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={addEmployee}>Send invite</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
