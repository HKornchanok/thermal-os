/**
 * Shared Recharts theming.
 *
 * Every chart in the dashboard pulls axis, tooltip, and grid styling
 * from these constants so the look is consistent and CSS-variable
 * driven — light/dark mode flip without per-chart code.
 *
 * Recharts components accept colour strings, so passing `var(--token)`
 * directly works: the browser resolves the variable wherever the SVG
 * style lands. Using `hsl(var(...))` would NOT work here — our theme
 * uses OKLCH (see globals.css), and the values can't be re-wrapped.
 */

import type { CSSProperties, SVGProps } from "react";

// Recharts' XAxis/YAxis `tick` prop receives SVG text props, not React
// CSSProperties — the two overlap nominally but diverge on enums like
// `alignmentBaseline`. Typing the constant as SVGProps<SVGTextElement>
// matches the consumer signature exactly.
export const CHART_AXIS_STYLE: SVGProps<SVGTextElement> = {
  fill: "var(--muted-foreground)",
  fontSize: 10,
  fontFamily: "var(--font-mono)",
};

/** Style applied to <Tooltip wrapperStyle={...}>; the floating box itself. */
export const CHART_TOOLTIP_WRAPPER_STYLE: CSSProperties = {
  outline: "none",
};

/** Style applied to <Tooltip contentStyle={...}>; the box's surface. */
export const CHART_TOOLTIP_CONTENT_STYLE: CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: "calc(var(--radius) - 2px)",
  fontSize: 12,
  fontFamily: "var(--font-mono)",
  color: "var(--foreground)",
  // Recharts injects an empty wrapper above; tighten its padding.
  padding: "8px 10px",
};

export const CHART_TOOLTIP_LABEL_STYLE: CSSProperties = {
  color: "var(--foreground)",
  marginBottom: 4,
  fontWeight: 600,
};

export const CHART_TOOLTIP_ITEM_STYLE: CSSProperties = {
  color: "var(--foreground)",
};

/** Stroke colour for <CartesianGrid>. */
export const CHART_GRID_STROKE = "var(--border)";

/** First five chart series colours from the theme palette. */
export const CHART_SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

/**
 * Pick a chart-series colour by index, expanding the base 5-colour
 * palette via CSS `color-mix` so charts with more than 5 series (zone
 * breakdown is 12) don't repeat hues.
 *
 *   index 0–4   → base chart-1..5
 *   index 5–9   → 70% base + 30% foreground (darker variant)
 *   index 10–14 → 70% base + 30% background (lighter variant)
 *   index 15+   → cycle from index 0 (rare in practice)
 *
 * `color-mix(in oklch, ...)` is supported in modern Chrome/Safari/
 * Firefox. The theme's variables are OKLCH so mixing stays in the same
 * colour space — no perceptual jumps.
 */
export function colorForSeriesIndex(i: number): string {
  const base = CHART_SERIES_COLORS[i % CHART_SERIES_COLORS.length];
  const variant = Math.floor(i / CHART_SERIES_COLORS.length) % 3;
  switch (variant) {
    case 0:
      return base;
    case 1:
      return `color-mix(in oklch, ${base} 70%, var(--foreground) 30%)`;
    case 2:
      return `color-mix(in oklch, ${base} 70%, var(--background) 30%)`;
    default:
      return base;
  }
}

/**
 * Format an ISO 8601 bucket string for X-axis ticks. Always renders as
 * 24-hour HH:MM in the user's local time so dashboards read consistently
 * regardless of locale.
 */
export function formatBucketTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Format an ISO 8601 bucket string for tooltip labels. Includes day +
 * 24-hour clock so the tooltip is unambiguous at the daily-boundary
 * rendering of the area chart.
 */
export function formatBucketLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
