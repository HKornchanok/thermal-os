import type { ReactNode } from "react";

import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

/** Sidebar + Header + main; pages handle their own max-width if needed. */
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
