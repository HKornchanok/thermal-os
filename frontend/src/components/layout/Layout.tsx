import type { ReactNode } from "react";

import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

/**
 * App shell. Sidebar (brand + nav) on the left, Header (user/theme/signout)
 * across the top of the main column, page content below.
 *
 * `_app.tsx` wraps every authenticated route with this; `/login` opts out
 * (it has its own centred layout).
 */
export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
