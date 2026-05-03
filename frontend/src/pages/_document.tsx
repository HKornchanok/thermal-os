import { Html, Head, Main, NextScript } from "next/document";

// Apply the `dark` class on <html> so the .dark { ... } block in
// globals.css overrides the :root light-theme variables. Without this,
// <body>'s bg-background would resolve to the light value because
// <body> sits OUTSIDE any wrapper component in _app.tsx.
//
// Dark mode is the default for a monitoring dashboard. A light/dark
// toggle (later) can flip this class via document.documentElement.
export default function Document() {
  return (
    <Html lang="en" className="dark">
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
