import "@/styles/globals.css";

import type { AppProps } from "next/app";
import { useRouter } from "next/router";
import { Inter, JetBrains_Mono } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";

import { Layout } from "@/components/layout/Layout";

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
  const router = useRouter();
  const useLayout = !NO_LAYOUT_ROUTES.has(router.pathname);

  const page = <Component {...pageProps} />;

  return (
    <SessionProvider session={session}>
      <ThemeProvider
        attribute="class"
        // defaultTheme="system" resolves to OS preference on first visit;
        // an explicit choice via <ThemeToggle> persists in localStorage.
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <div className={`${inter.variable} ${jetbrainsMono.variable} font-sans min-h-screen`}>
          {useLayout ? <Layout>{page}</Layout> : page}
        </div>
      </ThemeProvider>
    </SessionProvider>
  );
}
