import { Html, Head, Main, NextScript } from "next/document";

// next-themes manages the `class` attribute on <html> at runtime: it adds
// `class="dark"` or `class="light"` based on user preference + system
// setting, before paint, via a synchronous script injected in <head>.
// Don't hardcode a class here or it'll fight the runtime toggle and
// freeze the theme.
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
