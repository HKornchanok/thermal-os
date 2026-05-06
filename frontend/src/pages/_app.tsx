import "@/styles/globals.css";

import type { AppProps } from "next/app";
import { useRouter } from "next/router";
import { Inter, JetBrains_Mono } from "next/font/google";
import { SessionProvider, useSession } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useEffect, useRef, useState } from "react";

import { AuthGate } from "@/components/layout/AuthGate";
import { Layout } from "@/components/layout/Layout";
import { makeQueryClient } from "@/lib/query-client";

/**
 * Clears the React Query cache whenever the signed-in user identity
 * changes — e.g. sign-out followed by sign-in as a different user
 * without a hard reload. Without this, queryKeys (which don't include
 * user identity) would resolve to the previous user's cached data for
 * a beat before the next refetch lands. Quiet on token refresh, only
 * fires on actual identity changes.
 */
function SessionCacheGuard() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const lastUser = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const current = session?.user?.name ?? null;
    if (lastUser.current === undefined) {
      // First mount — record but don't clear (cache is empty anyway).
      lastUser.current = current;
      return;
    }
    if (lastUser.current !== current) {
      queryClient.clear();
      lastUser.current = current;
    }
  }, [session?.user?.name, queryClient]);
  return null;
}

// next/font/google self-hosts the fonts at build time and exposes them as
// CSS variables. Variable names match the theme's --font-sans / --font-mono.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

// Routes that opt out of the sidebar layout (centred designs of their own).
const NO_LAYOUT_ROUTES = new Set<string>(["/login"]);

export default function App({
  Component,
  pageProps: { session, ...pageProps },
}: AppProps) {
  // One QueryClient per browser tab. `useState` keeps it stable across
  // re-renders without a module-level singleton (which would leak state
  // across hot-reload boundaries and across tests using the same module).
  const [queryClient] = useState(() => makeQueryClient());

  const router = useRouter();
  const useLayout = !NO_LAYOUT_ROUTES.has(router.pathname);

  const page = <Component {...pageProps} />;

  return (
    <SessionProvider session={session}>
      <QueryClientProvider client={queryClient}>
        <SessionCacheGuard />
        <ThemeProvider
          attribute="class"
          // Dark by default — DESIGN.md positions this as a monitoring
          // dashboard, the kind that lives on a control-room display
          // overnight. enableSystem still lets users with an explicit
          // system preference override on first visit, and any choice
          // via <ThemeToggle> persists in localStorage.
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <div
            className={`${inter.variable} ${jetbrainsMono.variable} min-h-screen font-sans`}
          >
            {useLayout ? (
              <Layout>
                <AuthGate>{page}</AuthGate>
              </Layout>
            ) : (
              page
            )}
          </div>
        </ThemeProvider>
        {process.env.NODE_ENV === "development" && (
          <ReactQueryDevtools
            initialIsOpen={false}
            buttonPosition="bottom-right"
          />
        )}
      </QueryClientProvider>
    </SessionProvider>
  );
}
