import "@/styles/globals.css";

import type { AppProps } from "next/app";
import { Inter, JetBrains_Mono } from "next/font/google";
import { SessionProvider } from "next-auth/react";

// next/font/google self-hosts the fonts at build time and exposes them as CSS
// variables, eliminating layout shift. Variable names match the theme's
// expected --font-sans / --font-mono.
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

// The "dark" class lives on <html> (see _document.tsx) so .dark{...} in
// globals.css overrides :root for everything, including <body>. Here we
// only attach the font-variable classes so next/font's CSS variables
// reach descendants.
export default function App({
  Component,
  pageProps: { session, ...pageProps },
}: AppProps) {
  return (
    <SessionProvider session={session}>
      <div className={`${inter.variable} ${jetbrainsMono.variable} font-sans min-h-screen`}>
        <Component {...pageProps} />
      </div>
    </SessionProvider>
  );
}
