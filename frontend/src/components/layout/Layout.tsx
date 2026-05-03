import type { ReactNode } from "react";

import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

/**
 * App shell. Sidebar (brand + nav) on the left, Header (theme + account)
 * across the top of the main column, page content below in a centred,
 * max-width container.
 *
 * The container lives here, not on each page, so:
 *   1. Padding stays consistent across every route — no duplication
 *   2. Content is left-aligned with a max-width cap (no `mx-auto`). When
 *      the sidebar collapses, content stays anchored to the sidebar's
 *      right edge — only the trailing whitespace grows. `mx-auto` would
 *      re-centre as <main> widens, visibly shifting the content leftward
 *      on every toggle.
 *
 * `_app.tsx` wraps every authenticated route with this; `/login` opts out.
 */
export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex-1 overflow-auto">
          <div className="w-full max-w-6xl px-6 py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
