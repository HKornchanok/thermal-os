import { ThemeToggle } from "@/components/theme-toggle";

import { UserMenu } from "./UserMenu";

/**
 * Top bar above the page content. Holds session-scoped controls — theme
 * switcher and an account menu (user identity + Sign out) — that don't
 * belong in primary nav.
 */
export function Header() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-end gap-3 border-b border-border bg-background px-6">
      <ThemeToggle />
      <UserMenu />
    </header>
  );
}
