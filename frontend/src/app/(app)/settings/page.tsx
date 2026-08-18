"use client";

import * as React from "react";
import {
  Building2,
  KeyRound,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/layout/section-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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

import { useAuth } from "@/hooks/use-auth";
import { initials } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { toast } from "sonner";
import { useReference } from "@/hooks/use-reference";

const alertPrefs = [
  {
    key: "sla",
    label: "SLA breach warnings",
    description: "When a file crosses the lender SLA",
  },
  {
    key: "disbursal",
    label: "Disbursal credited",
    description: "Every time money hits the borrower account",
  },
  {
    key: "settlement",
    label: "Settlement received",
    description: "When a lender clears an invoice",
  },
  {
    key: "kyc",
    label: "KYC rejections",
    description: "When a document fails verification",
  },
  {
    key: "digest",
    label: "Daily digest email",
    description: "One summary at 8:00 PM",
  },
];

const sessions = [
  {
    device: "Chrome · Windows",
    location: "Hyderabad, IN",
    lastActive: "2024-05-26",
    current: true,
  },
  {
    device: "Safari · iPhone",
    location: "Hyderabad, IN",
    lastActive: "2024-05-25",
    current: false,
  },
  {
    device: "Edge · Windows",
    location: "Vijayawada, IN",
    lastActive: "2024-05-20",
    current: false,
  },
];

export default function SettingsPage() {
  const { banks } = useReference();

  const { user } = useAuth();

  const { user, updateUser } = useAuth();


  /* -------------------------------------------------------------------------- */
  /* Profile state                                                               */
  /* -------------------------------------------------------------------------- */

  const [name, setName] = React.useState(user?.name ?? "");
  const [email, setEmail] = React.useState(user?.email ?? "");

  const [phone, setPhone] = React.useState("9876543210");

  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(
    (user as any)?.avatarUrl ?? null

  const [phone, setPhone] = React.useState(user?.phone ?? "");

  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(
    user?.avatarUrl ?? null

  );

  const [avatarFile, setAvatarFile] = React.useState<File | null>(null);

  const avatarInputRef = React.useRef<HTMLInputElement | null>(null);

  /* -------------------------------------------------------------------------- */
  /* Keep local profile fields synced when auth user becomes available           */
  /* -------------------------------------------------------------------------- */

  React.useEffect(() => {
    if (!user) return;

    setName(user.name ?? "");
    setEmail(user.email ?? "");

    setAvatarUrl((user as any)?.avatarUrl ?? null);

    setPhone(user.phone ?? "");
    setAvatarUrl(user.avatarUrl ?? null);

  }, [user]);

  /* -------------------------------------------------------------------------- */
  /* Avatar upload                                                               */
  /* -------------------------------------------------------------------------- */

  function handleAvatarClick() {
    avatarInputRef.current?.click();
  }

  function handleAvatarChange(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];

    if (!file) return;

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    if (!allowedTypes.includes(file.type)) {
      toast.error("Invalid image", {
        description:
          "Please choose a JPG, PNG, or WEBP image.",
      });

      event.target.value = "";
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image is too large", {
        description:
          "Please choose an image smaller than 2 MB.",
      });

      event.target.value = "";
      return;
    }

    /*
     * Revoke the previous temporary object URL before
     * creating a new one.
     */
    if (
      avatarUrl &&
      avatarUrl.startsWith("blob:")
    ) {
      URL.revokeObjectURL(avatarUrl);
    }


    const previewUrl = URL.createObjectURL(file);

    setAvatarFile(file);
    setAvatarUrl(previewUrl);

    toast.success("Photo selected", {
      description:
        "Click Save changes to apply it.",
    });

    const reader = new FileReader();
    reader.onload = () => {
      const previewUrl = typeof reader.result === "string" ? reader.result : null;
      if (!previewUrl) {
        toast.error("Could not read image", {
          description: "Please try a different image file.",
        });
        return;
      }

      setAvatarFile(file);
      setAvatarUrl(previewUrl);

      toast.success("Photo selected", {
        description:
          "Click Save changes to apply it.",
      });
    };
    reader.readAsDataURL(file);

  }

  /* -------------------------------------------------------------------------- */
  /* Remove avatar                                                               */
  /* -------------------------------------------------------------------------- */

  function handleRemoveAvatar() {
    if (
      avatarUrl &&
      avatarUrl.startsWith("blob:")
    ) {
      URL.revokeObjectURL(avatarUrl);
    }

    setAvatarFile(null);
    setAvatarUrl(null);

    if (avatarInputRef.current) {
      avatarInputRef.current.value = "";
    }

    toast.success("Photo removed", {
      description:
        "Click Save changes to apply the change.",
    });
  }

  /* -------------------------------------------------------------------------- */
  /* Cleanup temporary avatar object URL                                         */
  /* -------------------------------------------------------------------------- */

  React.useEffect(() => {
    return () => {
      if (
        avatarUrl &&
        avatarUrl.startsWith("blob:")
      ) {
        URL.revokeObjectURL(avatarUrl);
      }
    };
  }, [avatarUrl]);

  /* -------------------------------------------------------------------------- */
  /* Save profile                                                                */
  /* -------------------------------------------------------------------------- */

  async function saveProfile() {
    try {

      /*
       * At this stage this keeps the same behavior as your
       * existing frontend demo.
       *
       * When the backend is connected, this is the correct
       * place to call your profile update API and upload
       * avatarFile.
       */

      console.log("Profile changes:", {
        name,
        email,
        phone,
        avatarFile,
      });

      toast.success("Settings saved", {
        description:
          "Changes applied to this workspace.",

      if (!user) {
        toast.error("No active session", {
          description: "Sign in again and try saving the profile.",
        });
        return;
      }

      const nextUser = {
        ...user,
        name,
        email,
        phone: phone || null,
        avatarUrl: avatarUrl || null,
      };

      updateUser(nextUser);

      toast.success("Settings saved", {
        description:
          "Your profile changes are now stored for this session and after reload.",

      });
    } catch (error) {
      console.error(error);

      toast.error("Unable to save settings", {
        description:
          "Please try again.",
      });
    }
  }

  /* -------------------------------------------------------------------------- */
  /* Password                                                                    */
  /* -------------------------------------------------------------------------- */

  function handlePasswordUpdate() {
    toast.success("Password updated", {
      description:
        "Sign in again on other devices.",
    });
  }

  /* -------------------------------------------------------------------------- */
  /* Export workspace                                                            */
  /* -------------------------------------------------------------------------- */

  function handleExportRequest() {
    toast.success("Export queued", {
      description:
        "You'll get an email when it's ready.",
    });
  }

  /* -------------------------------------------------------------------------- */
  /* Reset demo data                                                             */
  /* -------------------------------------------------------------------------- */

  function handleResetData() {
    window.location.reload();
  }

  return (
    <>
      {/* ---------------------------------------------------------------------- */}
      {/* Page Header                                                             */}
      {/* ---------------------------------------------------------------------- */}

      <PageHeader
        eyebrow="Account"
        title="Settings"
        description="Your profile, the company record used on invoices, alerts, and security."
        actions={
          <Button onClick={saveProfile}>
            <Save className="size-4" />
            Save changes
          </Button>
        }
      />

      {/* ---------------------------------------------------------------------- */}
      {/* Settings Tabs                                                           */}
      {/* ---------------------------------------------------------------------- */}

      <Tabs defaultValue="profile">
        <TabsList className="flex-wrap">
          <TabsTrigger value="profile">
            Profile
          </TabsTrigger>

          <TabsTrigger value="company">
            Company
          </TabsTrigger>

          <TabsTrigger value="banks">
            Bank access
          </TabsTrigger>

          <TabsTrigger value="alerts">
            Alerts
          </TabsTrigger>

          <TabsTrigger value="security">
            Security
          </TabsTrigger>
        </TabsList>

        {/* ==================================================================== */}
        {/* PROFILE                                                               */}
        {/* ==================================================================== */}

        <TabsContent value="profile">
          <div className="grid gap-4 lg:grid-cols-3">
            <SectionCard
              title="Your profile"
              description="Shown to your team on every record"
              className="lg:col-span-2"
            >
              {/* Avatar section */}
              <div className="flex items-center gap-4 pb-4">
                <Avatar className="size-14">
                  {avatarUrl && (
                    <AvatarImage
                      src={avatarUrl}
                      alt={
                        name ||
                        "Profile photo"
                      }
                    />
                  )}

                  <AvatarFallback className="text-base">
                    {initials(name || "RN")}
                  </AvatarFallback>
                </Avatar>

                <div className="space-y-1">
                  <div className="flex gap-2">
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={
                        handleAvatarChange
                      }
                    />

                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      onClick={
                        handleAvatarClick
                      }
                    >
                      Change photo
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={
                        handleRemoveAvatar
                      }
                      disabled={
                        !avatarUrl &&
                        !avatarFile
                      }
                    >
                      Remove
                    </Button>
                  </div>

                  <p className="text-[11px] text-[var(--muted-foreground)]">
                    Signed in as{" "}
                    {user?.role?.name ??
                      "User"}{" "}
                    ·{" "}
                    {user?.role?.name ??
                      "User"}
                  </p>
                </div>
              </div>

              <Separator />

              {/* Profile fields */}
              <div className="grid gap-3 pt-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="s-name">
                    Full name
                  </Label>

                  <Input
                    id="s-name"
                    value={name}
                    onChange={(event) =>
                      setName(
                        event.target.value
                      )
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="s-email">
                    Work email
                  </Label>

                  <Input
                    id="s-email"
                    type="email"
                    value={email}
                    onChange={(event) =>
                      setEmail(
                        event.target.value
                      )
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="s-phone">
                    Phone
                  </Label>

                  <Input
                    id="s-phone"
                    value={phone}
                    maxLength={10}
                    inputMode="numeric"
                    onChange={(event) =>
                      setPhone(
                        event.target.value.replace(
                          /\D/g,
                          ""
                        )
                      )
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>
                    Default landing page
                  </Label>

                  <Select defaultValue="dashboard">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>

                    <SelectContent>
                      <SelectItem value="dashboard">
                        Dashboard
                      </SelectItem>

                      <SelectItem value="customers">
                        Customers
                      </SelectItem>

                      <SelectItem value="bank-orders">
                        Bank orders
                      </SelectItem>

                      <SelectItem value="reports">
                        Reports
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </SectionCard>

            {/* Preferences */}
            <SectionCard
              title="Preferences"
              description="How the workspace behaves for you"
              contentClassName="space-y-4"
            >
              {[
                {
                  label: "Compact tables",
                  description:
                    "Fit more rows on screen",
                },
                {
                  label:
                    "Show amounts in lakhs",
                  description:
                    "Use ₹ L and ₹ Cr formatting",
                },
                {
                  label:
                    "Open records in dialog",
                  description:
                    "Instead of a full page",
                },
              ].map((item, index) => (
                <div
                  key={item.label}
                  className="flex items-start justify-between gap-3"
                >
                  <div>
                    <p className="text-[13px] font-medium">
                      {item.label}
                    </p>

                    <p className="text-[11px] text-[var(--muted-foreground)]">
                      {item.description}
                    </p>
                  </div>

                  <Switch
                    defaultChecked={
                      index !== 0
                    }
                  />
                </div>
              ))}
            </SectionCard>
          </div>
        </TabsContent>

        {/* ==================================================================== */}
        {/* COMPANY                                                               */}
        {/* ==================================================================== */}

        <TabsContent value="company">
          <div className="grid gap-4 lg:grid-cols-3">
            <SectionCard
              title="Company record"
              description="Printed on invoices and settlement statements"
              className="lg:col-span-2"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="co-name">
                    Registered name
                  </Label>

                  <Input
                    id="co-name"
                    defaultValue="Rise Next Banking Services Pvt Ltd"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="co-gst">
                    GSTIN
                  </Label>

                  <Input
                    id="co-gst"
                    defaultValue="36AABCR1234M1Z5"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="co-pan">
                    PAN
                  </Label>

                  <Input
                    id="co-pan"
                    defaultValue="AABCR1234M"
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="co-address">
                    Registered address
                  </Label>

                  <Textarea
                    id="co-address"
                    defaultValue="4th Floor, Trendset Towers, Road No 2, Banjara Hills, Hyderabad, Telangana 500034"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="co-phone">
                    Support phone
                  </Label>

                  <Input
                    id="co-phone"
                    defaultValue="040 4455 6677"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="co-email">
                    Billing email
                  </Label>

                  <Input
                    id="co-email"
                    type="email"
                    defaultValue="accounts@risenext.com"
                  />
                </div>
              </div>
            </SectionCard>

            {/* Invoice numbering */}
            <SectionCard
              title="Invoice numbering"
              description="Applies to new settlement invoices"
              contentClassName="space-y-3"
            >
              <div className="space-y-1.5">
                <Label htmlFor="inv-prefix">
                  Prefix
                </Label>

                <Input
                  id="inv-prefix"
                  defaultValue="RN/24-25/"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="inv-next">
                  Next number
                </Label>

                <Input
                  id="inv-next"
                  defaultValue="046"
                />
              </div>

              <div className="space-y-1.5">
                <Label>
                  TDS rate
                </Label>

                <Select defaultValue="5">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>
                    <SelectItem value="2">
                      2% (194C)
                    </SelectItem>

                    <SelectItem value="5">
                      5% (194H)
                    </SelectItem>

                    <SelectItem value="10">
                      10% (194J)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <p className="rounded-md bg-[var(--secondary)] px-3 py-2 text-[11px] text-[var(--muted-foreground)]">
                Next invoice will be
                raised as RN/24-25/046.
              </p>
            </SectionCard>
          </div>
        </TabsContent>

        {/* ==================================================================== */}
        {/* BANK ACCESS                                                           */}
        {/* ==================================================================== */}

        <TabsContent value="banks">
          <SectionCard
            title="Bank access"
            description="Turn a lender off to stop new files being logged against it"
            contentClassName="px-0 pb-0"
          >
            <Table>
              <TableHeader className="bg-[color-mix(in_oklab,var(--secondary)_70%,transparent)]">
                <TableRow>
                  <TableHead>
                    Bank
                  </TableHead>

                  <TableHead>
                    Vendor ID
                  </TableHead>

                  <TableHead>
                    Settlement cycle
                  </TableHead>

                  <TableHead>
                    SPOC
                  </TableHead>

                  <TableHead>
                    Status
                  </TableHead>

                  <TableHead className="text-right">
                    Logging enabled
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {banks.map((bank) => (
                  <TableRow key={bank.id}>
                    <TableCell>
                      <span className="flex items-center gap-2 font-medium">
                        <span
                          className="grid size-7 place-items-center rounded-md text-[10px] font-bold text-white"
                          style={{
                            background:
                              bank.accentColor ??
                              "#1d4ed8",
                          }}
                        >
                          {bank.logoText}
                        </span>

                        {bank.name}
                      </span>
                    </TableCell>

                    <TableCell className="numeric text-xs">
                      {bank.vendorId}
                    </TableCell>

                    <TableCell>
                      {bank.settlementCycle}
                    </TableCell>

                    <TableCell>
                      {bank.spocName}

                      <span className="numeric block text-[11px] text-[var(--muted-foreground)]">
                        {bank.spocPhone}
                      </span>
                    </TableCell>

                    <TableCell>
                      <StatusBadge
                        status={bank.status}
                      />
                    </TableCell>

                    <TableCell className="text-right">
                      <Switch
                        defaultChecked={
                          bank.status ===
                          "Active"
                        }
                        onCheckedChange={(
                          checked
                        ) =>
                          toast.success(
                            checked
                              ? "Logging enabled"
                              : "Logging paused",
                            {
                              description:
                                bank.name,
                            }
                          )
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>
        </TabsContent>

        {/* ==================================================================== */}
        {/* ALERTS                                                                */}
        {/* ==================================================================== */}

        <TabsContent value="alerts">
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard
              title="Alert preferences"
              description="Choose what lands in your notifications"
              contentClassName="space-y-4"
            >
              {alertPrefs.map(
                (pref, index) => (
                  <div
                    key={pref.key}
                    className="flex items-start justify-between gap-3"
                  >
                    <div>
                      <p className="text-[13px] font-medium">
                        {pref.label}
                      </p>

                      <p className="text-[11px] text-[var(--muted-foreground)]">
                        {pref.description}
                      </p>
                    </div>

                    <Switch
                      defaultChecked={
                        index < 4
                      }
                      onCheckedChange={(
                        checked
                      ) =>
                        toast.success(
                          checked
                            ? "Alert on"
                            : "Alert off",
                          {
                            description:
                              pref.label,
                          }
                        )
                      }
                    />
                  </div>
                )
              )}
            </SectionCard>

            <SectionCard
              title="Delivery channels"
              description="Where alerts are sent"
              contentClassName="space-y-4"
            >
              {[
                {
                  label:
                    "In-app notifications",
                  value: "Always on",
                  locked: true,
                },
                {
                  label: "Email",
                  value:
                    email ||
                    "admin@risenext.com",
                  locked: false,
                },
                {
                  label: "SMS",
                  value: phone,
                  locked: false,
                },
                {
                  label: "WhatsApp",
                  value:
                    "Not connected",
                  locked: false,
                },
              ].map((channel) => (
                <div
                  key={channel.label}
                  className="flex items-center justify-between gap-3"
                >
                  <div>
                    <p className="text-[13px] font-medium">
                      {channel.label}
                    </p>

                    <p className="numeric text-[11px] text-[var(--muted-foreground)]">
                      {channel.value}
                    </p>
                  </div>

                  {channel.locked ? (
                    <Badge variant="success">
                      On
                    </Badge>
                  ) : (
                    <Switch
                      defaultChecked={
                        channel.label !==
                        "WhatsApp"
                      }
                    />
                  )}
                </div>
              ))}
            </SectionCard>
          </div>
        </TabsContent>

        {/* ==================================================================== */}
        {/* SECURITY                                                              */}
        {/* ==================================================================== */}

        <TabsContent value="security">
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Password */}
            <SectionCard
              title="Password"
              description="Use at least 10 characters"
              contentClassName="space-y-3"
            >
              <div className="space-y-1.5">
                <Label htmlFor="pw-current">
                  Current password
                </Label>

                <Input
                  id="pw-current"
                  type="password"
                  autoComplete="current-password"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pw-new">
                  New password
                </Label>

                <Input
                  id="pw-new"
                  type="password"
                  placeholder="New password"
                  autoComplete="new-password"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pw-confirm">
                  Confirm password
                </Label>

                <Input
                  id="pw-confirm"
                  type="password"
                  placeholder="Repeat new password"
                  autoComplete="new-password"
                />
              </div>

              <Button
                className="w-full"
                onClick={
                  handlePasswordUpdate
                }
              >
                <KeyRound className="size-4" />
                Update password
              </Button>
            </SectionCard>

            {/* Active sessions */}
            <SectionCard
              title="Active sessions"
              description="Sign out anything you don't recognise"
              className="lg:col-span-2"
              contentClassName="px-0 pb-0"
            >
              <Table>
                <TableHeader className="bg-[color-mix(in_oklab,var(--secondary)_70%,transparent)]">
                  <TableRow>
                    <TableHead>
                      Device
                    </TableHead>

                    <TableHead>
                      Location
                    </TableHead>

                    <TableHead>
                      Last active
                    </TableHead>

                    <TableHead className="text-right">
                      Action
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {sessions.map(
                    (session) => (
                      <TableRow
                        key={
                          session.device
                        }
                      >
                        <TableCell className="font-medium">
                          {session.device}

                          {session.current && (
                            <Badge
                              variant="success"
                              className="ml-2"
                            >
                              This device
                            </Badge>
                          )}
                        </TableCell>

                        <TableCell>
                          {session.location}
                        </TableCell>

                        <TableCell>
                          {formatDate(
                            session.lastActive
                          )}
                        </TableCell>

                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={
                              session.current
                            }
                            onClick={() =>
                              toast.success(
                                "Session ended",
                                {
                                  description:
                                    session.device,
                                }
                              )
                            }
                          >
                            Sign out
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  )}
                </TableBody>
              </Table>
            </SectionCard>

            {/* Two factor authentication */}
            <SectionCard
              title="Two factor authentication"
              description="Extra step at sign in"
              contentClassName="space-y-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] font-medium">
                    Authenticator app
                  </p>

                  <p className="text-[11px] text-[var(--muted-foreground)]">
                    Six digit code from Google
                    Authenticator
                  </p>
                </div>

                <Switch
                  onCheckedChange={(
                    checked
                  ) =>
                    toast.success(
                      checked
                        ? "2FA enabled"
                        : "2FA disabled",
                      {
                        description:
                          "Applies from your next sign in.",
                      }
                    )
                  }
                />
              </div>

              <p className="flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
                <ShieldCheck className="size-3.5" />
                Recommended for Admin and
                Super Admin roles.
              </p>
            </SectionCard>

            {/* Danger zone */}
            <SectionCard
              title="Danger zone"
              description="These actions affect the whole workspace"
              className="lg:col-span-2"
              contentClassName="space-y-3"
            >
              {/* Export */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] p-3">
                <div>
                  <p className="text-[13px] font-medium">
                    Export all workspace data
                  </p>

                  <p className="text-[11px] text-[var(--muted-foreground)]">
                    Customers, loans, documents
                    index, and ledger as a single
                    archive
                  </p>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={
                    handleExportRequest
                  }
                >
                  <Building2 className="size-3.5" />
                  Request export
                </Button>
              </div>

              {/* Reset demo */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-3">
                <div>
                  <p className="text-[13px] font-medium">
                    Reset demo data
                  </p>

                  <p className="text-[11px] text-[var(--muted-foreground)]">
                    Restores the sample
                    customers, loans, and ledger
                    entries
                  </p>
                </div>

                <Button
                  variant="destructive"
                  size="sm"
                  onClick={
                    handleResetData
                  }
                >
                  <Trash2 className="size-3.5" />
                  Reset data
                </Button>
              </div>
            </SectionCard>
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
