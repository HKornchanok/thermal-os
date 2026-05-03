import type { ReactNode } from "react";

import { Sidebar } from "./Sidebar";

/**
 * App shell. Sidebar on the left, page content scrolls in the main panel.
 * `_app.tsx` wraps every authenticated route with this; `/login` opts out
 * (it has its own centred layout).
 */
export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}
