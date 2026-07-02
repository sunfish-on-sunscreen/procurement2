"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Layers,
  Clock,
  Zap,
  Upload,
  FileText,
  BookOpen,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
};

const navItems: NavItem[] = [
  { href: "/spend-overview", label: "Spend Overview", icon: LayoutDashboard },
  { href: "/supplier-classification", label: "Supplier Classification", icon: Layers },
  { href: "/process-health", label: "Process Health Monitoring", icon: Clock },
  { href: "/action-dashboard", label: "Action Dashboard", icon: Zap },
  { href: "/import", label: "Import", icon: Upload, adminOnly: true },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/methodology", label: "Methodology", icon: BookOpen },
];

// Shared by any future feature that wants the same persisted state.
const STORAGE_KEY = "dashboard_sidebar_collapsed";

// Tiny localStorage-backed store read via useSyncExternalStore — hydration-safe
// (server snapshot = expanded) and avoids set-state-in-effect (banned by lint).
const listeners = new Set<() => void>();

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function subscribeCollapsed(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function setCollapsed(next: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function Sidebar({ role }: { role: "ADMIN" | "VIEWER" }) {
  const pathname = usePathname();
  const items = navItems.filter((item) => !item.adminOnly || role === "ADMIN");

  // SSR renders expanded; the persisted value is applied on the client after
  // hydration (the width transition smooths the one-time adjustment).
  const collapsed = useSyncExternalStore(
    subscribeCollapsed,
    readCollapsed,
    () => false,
  );

  const toggle = () => setCollapsed(!collapsed);

  return (
    <aside
      className={cn(
        // `sticky top-0 h-screen self-start` keeps the sidebar pinned in the
        // viewport while the page (window) scrolls — without introducing a new
        // scroll container, so the page-level sticky table headers / report TOC
        // still pin to the window as before.
        "sticky top-0 flex h-screen shrink-0 flex-col self-start border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-in-out",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div
        className={cn(
          "flex h-14 items-center border-b border-sidebar-border px-3",
          collapsed ? "justify-center" : "justify-between",
        )}
      >
        {!collapsed && (
          <span className="truncate font-semibold">📊 Procurement Analytics</span>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
        {items.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                collapsed && "justify-center px-2",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
