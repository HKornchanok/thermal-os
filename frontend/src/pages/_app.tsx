import "@/styles/globals.css";

import type { AppProps } from "next/app";
import { Inter, JetBrains_Mono } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";

// next/font/google self-hosts the fonts at build time and exposes them as
// CSS variables, eliminating layout shift. Variable names match the
// theme's expected --font-sans / --font-mono.
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

export default function App({
  Component,
  pageProps: { session, ...pageProps },
}: AppProps) {
  return (
    <SessionProvider session={session}>
      <ThemeProvider
        attribute="class"
        // defaultTheme="system" resolves to the user's OS preference on
        // first visit; an explicit choice via <ThemeToggle> persists in
        // localStorage and overrides this. Avoid hard-defaulting to dark
        // — that ignores users with a light OS preference.
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <div className={`${inter.variable} ${jetbrainsMono.variable} font-sans min-h-screen`}>
          <Component {...pageProps} />
        </div>
      </ThemeProvider>
    </SessionProvider>
  );
}
