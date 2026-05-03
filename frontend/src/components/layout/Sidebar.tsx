import Link from "next/link";
import { useRouter } from "next/router";
import {
  ArrowLeftRight,
  Bot,
  Cpu,
  LayoutDashboard,
  ListChecks,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

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

export function Sidebar() {
  const router = useRouter();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="px-4 py-5">
        <h1 className="text-base font-semibold">ThermalOS</h1>
        <p className="text-xs text-muted-foreground">Building monitor</p>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-2" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          // Active when on the exact path. The Overview ("/") link uses
          // strict equality so it doesn't claim active for every route.
          const isActive = router.pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              data-testid={`nav-${item.href === "/" ? "overview" : item.href.slice(1)}`}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className="size-4" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
