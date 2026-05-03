import { signOut, useSession } from "next-auth/react";
import { LogOut, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Single button in the header that opens a menu with the signed-in user's
 * identity and a Sign-out action. Replaces the previous inline username +
 * separate Sign-out button so the header stays compact.
 */
export function UserMenu() {
  const { data: session } = useSession();
  const name = session?.user?.name ?? null;

  // Don't render anything if there's no session — the layout is only
  // applied to authenticated routes, but a brief unauth state can occur
  // during sign-out before the redirect lands on /login.
  if (!name) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          data-testid="user-menu-trigger"
          variant="outline"
          size="sm"
          className="gap-2"
          aria-label={`Account menu for ${name}`}
        >
          <User className="size-4" aria-hidden />
          <span className="max-w-[10ch] truncate">{name}</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-[14rem]">
        <DropdownMenuLabel className="text-xs">Signed in as</DropdownMenuLabel>
        <div
          className="px-2 pb-2 text-sm font-medium"
          data-testid="user-menu-name"
        >
          {name}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="user-menu-signout"
          onSelect={() => signOut({ callbackUrl: "/login" })}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="size-4" aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
