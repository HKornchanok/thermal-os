import { Html, Head, Main, NextScript } from "next/document";

// Don't hardcode a `class` on <html> — next-themes injects it at runtime.
export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
