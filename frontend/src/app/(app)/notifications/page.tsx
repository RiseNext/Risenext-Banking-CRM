"use client";

import * as React from "react";
import Link from "next/link";
import { Bell, BellOff, CheckCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/layout/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useReference } from "@/hooks/use-reference";
import { useResource, useRecord, useStats } from "@/hooks/use-api";
import { api, errorMessage } from "@/lib/api";
import { num } from "@/lib/types";
import type { ActivityItem, NotificationItem, Team } from "@/lib/types";

const tone: Record<NotificationItem["severity"], string> = {
  info: "var(--info)",
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
};

function AlertList({
  rows,
  onToggle,
}: {
  rows: NotificationItem[];
  onToggle: (id: string) => void;
}) {
  if (!rows.length) {
    return (
      <EmptyState
        icon={BellOff}
        title="Nothing to read here"
        description="New alerts about SLAs, settlements, and KYC land in this list."
      />
    );
  }

  return (
    <ul className="divide-y divide-[var(--border)]">
      {rows.map((item) => (
        <li key={item.id} className="flex gap-3 py-3.5">
          <span
            className="mt-1.5 size-2 shrink-0 rounded-full"
            style={{ background: tone[item.severity] }}
          />
          <div className="min-w-0 flex-1">
            <p className={cn("text-[13px]", item.read ? "font-medium" : "font-semibold")}>
              {item.title}
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">{item.message}</p>
            <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
              {formatDateTime(item.createdAt)} · {relativeTime(item.createdAt)}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onToggle(item.id)}>
            {item.read ? "Mark unread" : "Mark read"}
          </Button>
        </li>
      ))}
    </ul>
  );
}

export default function NotificationsPage() {
  const { data: rows, loading, error, refresh } = useResource<NotificationItem>("/notifications");
  const activity: ActivityItem[] = [];
  const [items, setItems] = React.useState<NotificationItem[]>(rows);

  const markAll = React.useCallback(() => {
    setItems((prev) => prev.map((item) => ({ ...item, read: true })));
    toast.success("All caught up", { description: "Every alert marked as read." });
  }, []);

  const toggle = React.useCallback((id: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, read: !item.read } : item)));
  }, []);

  const unread = items.filter((item) => !item.read);
  const critical = items.filter(
    (item) => item.severity === "danger" || item.severity === "warning",
  );

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Notifications"
        description="Alerts raised by lenders, the system, and your own team."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/settings">Alert settings</Link>
            </Button>
            <Button onClick={markAll} disabled={!unread.length}>
              <CheckCheck className="size-4" /> Mark all read
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <SectionCard
          title="Alerts"
          description={`${unread.length} unread of ${items.length}`}
          className="xl:col-span-2"
          contentClassName="pt-0"
          action={
            <Badge variant={unread.length ? "warning" : "success"}>
              <Bell className="size-3" /> {unread.length ? "Action needed" : "Clear"}
            </Badge>
          }
        >
          <Tabs defaultValue="all">
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="unread">Unread</TabsTrigger>
              <TabsTrigger value="critical">Critical</TabsTrigger>
            </TabsList>
            <TabsContent value="all">
              <AlertList rows={items} onToggle={toggle} />
            </TabsContent>
            <TabsContent value="unread">
              <AlertList rows={unread} onToggle={toggle} />
            </TabsContent>
            <TabsContent value="critical">
              <AlertList rows={critical} onToggle={toggle} />
            </TabsContent>
          </Tabs>
        </SectionCard>

        <SectionCard
          title="Team activity"
          description="Recent actions across the workspace"
          contentClassName="pt-0"
        >
          <ul className="divide-y divide-[var(--border)]">
            {activity.map((item) => (
              <li key={item.id} className="py-3">
                <p className="text-[13px] font-medium">{item.title}</p>
                <p className="text-xs text-[var(--muted-foreground)]">{item.description}</p>
                <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                  {item.actor} · {relativeTime(item.at)}
                </p>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </>
  );
}
