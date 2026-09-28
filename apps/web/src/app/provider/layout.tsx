"use client";

import type { ReactNode } from "react";
import { CalendarCheck, CalendarDays, Clock, LayoutDashboard, UserRound } from "lucide-react";
import { AppShell, type NavItem } from "@/components/dashboard/app-shell";

// Providers only ever see their own records.
const nav: NavItem[] = [
  { href: "/provider", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/provider/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/provider/appointments", label: "My appointments", icon: CalendarCheck },
  { href: "/provider/availability", label: "My availability", icon: Clock },
  { href: "/provider/profile", label: "My profile", icon: UserRound },
];

export default function ProviderLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell area="provider" title="Provider" nav={nav}>
      {children}
    </AppShell>
  );
}
