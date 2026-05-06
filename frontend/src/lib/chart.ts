/**
 * Shared Recharts theming. Recharts accepts colour strings, so passing
 * `var(--token)` directly works — the browser resolves it on the SVG.
 * `hsl(var(...))` does NOT work because the theme is OKLCH.
 */

import type { CSSProperties, SVGProps } from "react";

// Recharts' tick prop wants SVG text props, not CSSProperties — the two
// diverge on enums like `alignmentBaseline`.
export const CHART_AXIS_STYLE: SVGProps<SVGTextElement> = {
  fill: "var(--muted-foreground)",
  fontSize: 10,
  fontFamily: "var(--font-mono)",
};

export const CHART_TOOLTIP_WRAPPER_STYLE: CSSProperties = {
  outline: "none",
};

export const CHART_TOOLTIP_CONTENT_STYLE: CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: "calc(var(--radius) - 2px)",
  fontSize: 12,
  fontFamily: "var(--font-mono)",
  color: "var(--foreground)",
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

export const CHART_GRID_STROKE = "var(--border)";

export const CHART_SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

/**
 * Expands the 5-colour palette to 25 unique hues via `color-mix(in oklch)`.
 * Variants: base / +foreground / +background / deep+foreground / pale+background.
 */
export function colorForSeriesIndex(i: number): string {
  const base = CHART_SERIES_COLORS[i % CHART_SERIES_COLORS.length];
  const variant = Math.floor(i / CHART_SERIES_COLORS.length) % 5;
  switch (variant) {
    case 0:
      return base;
    case 1:
      return `color-mix(in oklch, ${base} 70%, var(--foreground) 30%)`;
    case 2:
      return `color-mix(in oklch, ${base} 70%, var(--background) 30%)`;
    case 3:
      return `color-mix(in oklch, ${base} 50%, var(--foreground) 50%)`;
    case 4:
      return `color-mix(in oklch, ${base} 50%, var(--background) 50%)`;
    default:
      return base;
  }
}

/** ISO bucket → "HH:MM" in browser local time. */
export function formatBucketTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO bucket → "May 07, 14:00" tooltip label. */
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
