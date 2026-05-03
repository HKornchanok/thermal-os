import type { ReactNode } from "react";

import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

/**
 * App shell. Sidebar (brand + nav) on the left, Header (theme + account)
 * across the top of the main column, page content below.
 *
 * The page container provides consistent horizontal padding (px-6) and
 * top spacing (py-8) but does NOT cap the content width — content fills
 * the main column so toggling the sidebar shrink/expand actually grows
 * the usable area instead of leaving empty space on the right.
 *
 * Pages that want a narrower reading width (settings forms, prose) can
 * wrap their own content in a max-w container per-page.
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
          <div className="px-6 py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
