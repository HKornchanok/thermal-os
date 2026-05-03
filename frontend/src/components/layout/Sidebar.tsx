import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  Bot,
  ChevronsLeft,
  ChevronsRight,
  Cpu,
  LayoutDashboard,
  ListChecks,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

// Six entries from DESIGN.md §1C component tree, in the exact order
// they appear there.
const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/machines", label: "Machines", icon: Cpu },
  { href: "/energy", label: "Energy", icon: Zap },
  { href: "/decisions", label: "AI Decisions", icon: ListChecks },
  { href: "/compare", label: "Before/After", icon: ArrowLeftRight },
  { href: "/chat", label: "AI Assistant", icon: Bot },
];

const STORAGE_KEY = "thermalos.sidebar.collapsed";

export function Sidebar() {
  const router = useRouter();

  // Default expanded; on the client, hydrate the persisted preference.
  // SSR + first client render both produce expanded markup so the
  // hydration HTML matches; the layout snaps to the saved state on the
  // next paint (transition-[width] keeps it visually smooth).
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY) === "true") {
      setCollapsed(true);
    }
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        /* private mode etc — toggle still works in-memory */
      }
      return next;
    });
  };

  return (
    <aside
      data-testid="sidebar"
      data-collapsed={collapsed || undefined}
      className={cn(
        "flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-14" : "w-56"
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 py-3",
          collapsed ? "justify-center px-2" : "justify-between px-3"
        )}
      >
        {!collapsed && (
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">ThermalOS</h1>
            <p className="truncate text-xs text-muted-foreground">Building monitor</p>
          </div>
        )}
        <Button
          data-testid="sidebar-toggle"
          variant="ghost"
          size="icon"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="size-8 shrink-0"
        >
          {collapsed ? (
            <ChevronsRight className="size-4" aria-hidden />
          ) : (
            <ChevronsLeft className="size-4" aria-hidden />
          )}
        </Button>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-2" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = router.pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              title={collapsed ? item.label : undefined}
              data-testid={`nav-${item.href === "/" ? "overview" : item.href.slice(1)}`}
              className={cn(
                "flex items-center gap-2 rounded-md text-sm transition-colors",
                collapsed ? "justify-center px-2 py-2" : "px-3 py-2",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
