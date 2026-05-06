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

// Clears the query cache when the signed-in user identity changes,
// preventing previous-user data flashing on sign-out → sign-in as a
// different user. Quiet on token refresh.
function SessionCacheGuard() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const lastUser = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const current = session?.user?.name ?? null;
    if (lastUser.current === undefined) {
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

const NO_LAYOUT_ROUTES = new Set<string>(["/login"]);

export default function App({
  Component,
  pageProps: { session, ...pageProps },
}: AppProps) {
  // useState (not module-level) so HMR and tests get fresh clients.
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
