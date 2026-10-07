"use client";

import { Suspense, useEffect, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, LogOut, Menu, PanelLeftClose, PanelLeftOpen, UserRound, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { homeAreaFor, type AppArea, type MeResponse, type PermissionKey } from "@booking/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe, usePermissions, homePathFor } from "@/lib/auth/hooks";
import { authedRequest } from "@/lib/auth/api";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export interface NavItem {
  /** May carry a query string (e.g. /admin/bookings?status=CONFIRMED). */
  href: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  /** Shown when the user holds ANY of these permissions (omit = always). */
  anyOf?: PermissionKey[];
  /** Exact path match only (area home links, "All" sub-items). */
  exact?: boolean;
  /** Not built yet: shown greyed out, not clickable. */
  soon?: boolean;
  /** Has children but no page of its own: label only toggles the group, never navigates. */
  expandOnly?: boolean;
  children?: NavItem[];
}

function canEnter(area: AppArea, me: MeResponse): boolean {
  if (area === "admin") return homeAreaFor(me) === "admin";
  return me.providerProfileId !== null;
}

function initials(me: MeResponse): string {
  return `${me.user.firstName[0] ?? ""}${me.user.lastName?.[0] ?? ""}`.toUpperCase() || "?";
}

function useSignOut() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return async function signOut() {
    // Best effort: lets the API drop its cached session and audit the sign-out.
    await authedRequest("/auth/logout", { method: "POST" }).catch(() => undefined);
    await getSupabaseBrowserClient().auth.signOut();
    queryClient.clear();
    router.replace("/login");
    router.refresh();
  };
}

function NavList({ nav, label, collapsed = false }: { nav: NavItem[]; label: string; collapsed?: boolean }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const { canAny } = usePermissions();

  const visible = (items: NavItem[]) => items.filter((i) => !i.anyOf || canAny(...i.anyOf));
  const isActive = (item: NavItem) => {
    const [path, query] = item.href.split("?");
    if (query) {
      const wanted = new URLSearchParams(query);
      return pathname === path && [...wanted].every(([k, v]) => search.get(k) === v);
    }
    if (item.exact) return pathname === path && (!item.children || search.size === 0);
    return pathname === path || pathname.startsWith(`${path}/`);
  };
  const hasActiveChild = (item: NavItem) => (item.children ?? []).some((c) => isActive(c));

  // Sections with children start expanded only when the current page is inside them.
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(nav.filter((i) => i.children && (isActive(i) || hasActiveChild(i))).map((i) => [i.href, true])),
  );

  const link = (item: NavItem, nested = false) => {
    const Icon = item.icon;
    const cls = cn(
      "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground",
      nested && "py-1.5 pl-9",
      collapsed && "justify-center px-2",
      item.soon ? "cursor-default opacity-50" : "transition-colors hover:bg-accent hover:text-foreground",
      !item.soon && isActive(item) && "bg-accent font-medium text-foreground",
    );
    const content = (
      <>
        {Icon && <Icon className="size-4 shrink-0" />}
        {!collapsed && <span className="truncate">{item.label}</span>}
        {item.soon && !nested && !collapsed && <span className="ml-auto text-[10px] uppercase tracking-wide">Soon</span>}
      </>
    );
    return item.soon ? (
      <span key={item.href} className={cls} title={item.label} aria-disabled="true">
        {content}
      </span>
    ) : (
      <Link key={item.href} href={item.href} title={collapsed ? item.label : undefined} aria-current={isActive(item) ? "page" : undefined} className={cls}>
        {content}
      </Link>
    );
  };

  return (
    <nav className="grid gap-0.5" aria-label={`${label} navigation`}>
      {visible(nav).map((item) => {
        const kids = item.children ? visible(item.children) : [];
        if (kids.length === 0) return <div key={item.href}>{link(item)}</div>;
        // Collapsed to an icon rail: no room for sub-items, so a section with children links straight to its
        // first child instead of its own href — some sections (e.g. Finance) have no page of their own at all.
        if (collapsed) return <div key={item.href}>{link({ ...item, href: kids[0]!.href })}</div>;

        const isOpen = openMap[item.href] ?? false;
        const Icon = item.icon;
        return (
          <div key={item.href} className="grid gap-0.5">
            <div
              className={cn(
                "flex items-center rounded-md text-sm text-muted-foreground",
                (hasActiveChild(item) || (!item.expandOnly && isActive(item))) && "bg-accent font-medium text-foreground",
              )}
            >
              {item.expandOnly ? (
                <button
                  type="button"
                  onClick={() => setOpenMap((m) => ({ ...m, [item.href]: !isOpen }))}
                  aria-expanded={isOpen}
                  className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left transition-colors hover:text-foreground"
                >
                  {Icon && <Icon className="size-4 shrink-0" />}
                  <span className="truncate">{item.label}</span>
                </button>
              ) : (
                <Link
                  href={item.href}
                  aria-current={isActive(item) ? "page" : undefined}
                  className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 transition-colors hover:text-foreground"
                >
                  {Icon && <Icon className="size-4 shrink-0" />}
                  <span className="truncate">{item.label}</span>
                </Link>
              )}
              <button
                type="button"
                onClick={() => setOpenMap((m) => ({ ...m, [item.href]: !isOpen }))}
                aria-expanded={isOpen}
                aria-label={`${isOpen ? "Collapse" : "Expand"} ${item.label}`}
                className="shrink-0 rounded-md p-2 pl-1 transition-colors hover:text-foreground"
              >
                <ChevronDown className={cn("size-4 transition-transform", isOpen && "rotate-180")} />
              </button>
            </div>
            {isOpen && kids.map((child) => link({ ...child, soon: child.soon ?? item.soon }, true))}
          </div>
        );
      })}
    </nav>
  );
}

function CenteredMessage({ title, detail, action }: { title: string; detail?: string; action: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="font-medium">{title}</p>
      {detail && <p className="max-w-sm text-sm text-muted-foreground">{detail}</p>}
      {action}
    </div>
  );
}

export function AppShell({
  area,
  title,
  nav,
  children,
}: {
  area: AppArea;
  title: string;
  nav: NavItem[];
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: me, isPending, error } = useMe();
  const signOut = useSignOut();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Remembered per browser, not per account — a UI preference, not user data.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("sidebar-collapsed") === "1");
    } catch {
      /* private browsing / storage blocked: default to expanded */
    }
  }, []);
  const toggleCollapsed = () =>
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("sidebar-collapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });

  const home = me ? homePathFor(me) : null;
  const allowed = me ? canEnter(area, me) : false;
  useEffect(() => {
    if (me && !allowed && home) router.replace(home);
  }, [me, allowed, home, router]);
  useEffect(() => setMobileOpen(false), [pathname]);

  if (me && !home) {
    return (
      <CenteredMessage
        title="Your account has no dashboard access yet"
        detail="Ask an administrator to assign you a role (or link your provider profile)."
        action={
          <Button variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
        }
      />
    );
  }
  if (isPending || (me && !allowed)) {
    return (
      <div className="flex min-h-dvh">
        <div className="hidden w-64 border-r p-4 md:block">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="flex-1 space-y-4 p-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }
  if (error || !me) {
    return (
      <CenteredMessage
        title="We couldn't load your account."
        detail={error?.message}
        action={
          <Button variant="outline" onClick={() => void signOut()}>
            Sign in again
          </Button>
        }
      />
    );
  }

  const mobileNavList = (
    <Suspense>
      <NavList nav={nav} label={title} />
    </Suspense>
  );
  const desktopNavList = (
    <Suspense>
      <NavList nav={nav} label={title} collapsed={collapsed} />
    </Suspense>
  );

  return (
    <div className="flex min-h-dvh">
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col gap-6 overflow-y-auto border-r bg-card p-4 transition-[width] duration-200 md:flex",
          collapsed ? "w-[4.5rem]" : "w-64",
        )}
      >
        <div className={cn("flex items-center gap-2", collapsed ? "flex-col" : "justify-between")}>
          <Link
            href={home ?? "/"}
            title={collapsed ? me.organization.name : undefined}
            className={cn("flex min-w-0 items-center gap-2 text-base font-semibold tracking-tight", collapsed ? "justify-center px-0" : "px-3")}
          >
            {me.organization.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- Supabase public URL
              <img src={me.organization.logoUrl} alt="" className="size-7 shrink-0 rounded object-contain" />
            ) : (
              collapsed && <span className="flex size-7 shrink-0 items-center justify-center rounded bg-primary text-xs font-semibold text-primary-foreground">{me.organization.name[0]}</span>
            )}
            {!collapsed && <span className="truncate">{me.organization.name}</span>}
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
            onClick={toggleCollapsed}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </Button>
        </div>
        {desktopNavList}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((o) => !o)}
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
          <span className="text-sm font-medium text-muted-foreground">{title}</span>
          <div className="ml-auto flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 px-2">
                  {me.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Supabase public URL
                    <img src={me.avatarUrl} alt="" className="size-8 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                      {initials(me)}
                    </span>
                  )}
                  <span className="hidden text-sm sm:inline">{me.user.firstName}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="font-medium">
                    {me.user.firstName} {me.user.lastName}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{me.user.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {area !== "provider" && (
                  <DropdownMenuItem asChild>
                    <Link href="/account/profile">
                      <UserRound className="size-4" /> Profile
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => void signOut()}>
                  <LogOut className="size-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-72 gap-0 p-0 md:hidden">
            <SheetHeader className="flex-row items-center gap-2 space-y-0 border-b">
              {me.organization.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- Supabase public URL
                <img src={me.organization.logoUrl} alt="" className="size-6 shrink-0 rounded object-contain" />
              )}
              <SheetTitle className="truncate text-base">{me.organization.name}</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto p-3">{mobileNavList}</div>
          </SheetContent>
        </Sheet>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
