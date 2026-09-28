"use client";

import type { ReactNode } from "react";
import {
  BellRing,
  BriefcaseMedical,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  History,
  IdCard,
  Landmark,
  LayoutDashboard,
  Settings,
  Stethoscope,
  Ticket,
} from "lucide-react";
import { AppShell, type NavItem } from "@/components/dashboard/app-shell";

// The ShifaWorks admin menu. `soon` items belong to later phases and are
// switched on as those phases land (see docs/ARCHITECTURE.md §13).
const nav: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/bookings", label: "Bookings", icon: CalendarCheck, anyOf: ["bookings.view_all"] },
  { href: "/admin/calendar", label: "Calendar", icon: CalendarDays, anyOf: ["bookings.view_all"] },
  { href: "/admin/services", label: "Services", icon: BriefcaseMedical, anyOf: ["services.view"] },
  { href: "/admin/providers", label: "Providers", icon: Stethoscope, anyOf: ["providers.view"] },
  { href: "/admin/availability", label: "Availability", icon: CalendarClock, anyOf: ["availability.manage_all", "availability.view"] },
  {
    href: "/admin/finance",
    label: "Finance",
    icon: Landmark,
    anyOf: ["payments.view", "finance.view", "expenses.view", "invoices.view"],
    exact: true,
    expandOnly: true,
    children: [
      { href: "/admin/payments", label: "Payments", anyOf: ["payments.view"] },
      { href: "/admin/finance/transactions", label: "Transactions", anyOf: ["finance.view"] },
      { href: "/admin/expenses", label: "Expenses", anyOf: ["expenses.view"] },
      { href: "/admin/invoices", label: "Invoices", anyOf: ["invoices.view"] },
    ],
  },
  {
    href: "/admin/staff",
    label: "Staff",
    icon: IdCard,
    anyOf: ["staff.view", "roles.view"],
    exact: true,
    expandOnly: true,
    children: [
      { href: "/admin/users", label: "Accounts & access", anyOf: ["staff.view"] },
      { href: "/admin/roles", label: "Roles & permissions", anyOf: ["roles.view"] },
    ],
  },
  {
    href: "/admin/notifications",
    label: "Notifications",
    icon: BellRing,
    anyOf: ["notifications.view", "notifications.manage_templates"],
    exact: true,
    children: [
      { href: "/admin/notifications", label: "Email log", anyOf: ["notifications.view"], exact: true },
      { href: "/admin/notifications/templates", label: "Templates", anyOf: ["notifications.manage_templates", "notifications.view"] },
    ],
  },
  { href: "/admin/check-in", label: "Check-in", icon: Ticket, anyOf: ["bookings.check_in"] },
  { href: "/admin/audit-logs", label: "Audit log", icon: History, anyOf: ["audit.view"] },
  { href: "/admin/settings", label: "Settings", icon: Settings, anyOf: ["settings.manage"] },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell area="admin" title="Admin" nav={nav}>
      {children}
    </AppShell>
  );
}
