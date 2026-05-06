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

export function UserMenu() {
  const { data: session } = useSession();
  const name = session?.user?.name ?? null;

  // Brief unauth state can occur mid sign-out → redirect.
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
