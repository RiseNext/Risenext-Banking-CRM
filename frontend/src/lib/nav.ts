import {
  Banknote,
  Bell,
  Building2,
  FileStack,
  FileText,
  Gauge,
  HandCoins,
  Landmark,
  ListChecks,
  Receipt,
  Settings,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: typeof Gauge;
  badge?: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const navSections: NavSection[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: Gauge },
      { label: "Customers", href: "/customers", icon: Users },
      { label: "Loans", href: "/loans", icon: FileText },
    ],
  },
  {
    title: "Bank operations",
    items: [
      { label: "Bank orders", href: "/bank-orders", icon: ListChecks },
      { label: "Disbursement", href: "/disbursement", icon: Banknote },
      { label: "Settlements", href: "/settlements", icon: HandCoins },
      { label: "Ledger", href: "/ledger", icon: Receipt },
      { label: "Transactions", href: "/transactions", icon: Wallet },
    ],
  },
  {
    title: "Records",
    items: [
      { label: "Documents", href: "/documents", icon: FileStack },
      { label: "Reports", href: "/reports", icon: Landmark },
      { label: "Banks", href: "/banks", icon: Building2 },
      { label: "Employees", href: "/employees", icon: Users },
    ],
  },
  {
    title: "Account",
    items: [
      { label: "Notifications", href: "/notifications", icon: Bell },
      { label: "Recycle bin", href: "/recycle-bin", icon: Trash2 },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

export const flatNav = navSections.flatMap((section) => section.items);
