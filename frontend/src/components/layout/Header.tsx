import { signOut, useSession } from "next-auth/react";
import { LogOut, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Top bar above the page content. Holds session-scoped controls — user
 * identity, theme switcher, sign out — that don't belong in primary nav.
 */
export function Header() {
  const { data: session } = useSession();
  const name = session?.user?.name ?? null;

  return (
    <header className="flex h-14 shrink-0 items-center justify-end gap-3 border-b border-border bg-background px-6">
      {name && (
        <div
          className="flex items-center gap-2 text-sm text-muted-foreground"
          data-testid="header-user"
        >
          <User className="size-4" aria-hidden />
          <span className="truncate" title={name}>
            {name}
          </span>
        </div>
      )}
      <ThemeToggle />
      <Button
        data-testid="header-signout"
        variant="outline"
        size="sm"
        onClick={() => signOut({ callbackUrl: "/login" })}
      >
        <LogOut className="size-3" aria-hidden />
        Sign out
      </Button>
    </header>
  );
}
