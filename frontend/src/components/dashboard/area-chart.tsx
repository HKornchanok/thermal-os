import type { ReactElement } from "react";
import {
  Area,
  AreaChart as RechartsAreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import type { TooltipProps } from "recharts";

// Recharts' Tooltip is generic in (value, name). We pin name to `string`
// because every series in our charts uses a string label — keeps the
// tooltip content callback type usable downstream without union noise.
export type ChartTooltipProps = TooltipProps<ValueType, string>;

import {
  CHART_AXIS_STYLE,
  CHART_GRID_STROKE,
  CHART_TOOLTIP_CONTENT_STYLE,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_WRAPPER_STYLE,
  colorForSeriesIndex,
} from "@/lib/chart";
import { cn } from "@/lib/utils";

/**
 * One data series rendered on the chart.
 *
 * - `key`   — object key in `data` items to read the y-value from
 * - `name`  — friendly label shown in the tooltip; defaults to `key`
 * - `color` — stroke + fill colour (any CSS colour or a CSS variable);
 *             defaults to the next CHART_SERIES_COLORS slot in source order
 */
export type AreaSeries = {
  key: string;
  name?: string;
  color?: string;
};

// `extends object` keeps the generic open enough to accept concrete
// domain types (BuildingEnergyPoint, SensorSeriesPoint, …) that don't
// have an index signature, while still narrowing `keyof TData` to the
// caller's actual keys (which a `Record<string, any>` would erase).
export interface AreaChartProps<TData extends object> {
  /** Time-ordered data rows. */
  data: TData[];
  /** Key in each row to use as the x-axis value. */
  xKey: keyof TData & string;
  /** One or more series to draw. */
  series: AreaSeries[];

  /** Stack series on top of each other (vs overlapping). */
  stacked?: boolean;
  /**
   * Render mode:
   *   - "area" (default) — line + fill (gradient for single-series,
   *      semi-transparent solid for multi).
   *   - "line"           — strokes only, no fill. Use when the comparison
   *      lives in the line shape (e.g. before/after curves where fills
   *      would overlap and muddle readability).
   */
  mode?: "area" | "line";
  /** Render a soft fill gradient. Defaults to true for single-series in area mode. */
  gradient?: boolean;
  /** Show the dashed horizontal grid lines. Default true. */
  showGrid?: boolean;

  /** Wrapper class. Default `h-72 w-full`. */
  className?: string;

  /** Format x-axis tick labels (e.g. ISO → HH:MM). */
  xTickFormatter?: (value: unknown) => string;
  /**
   * Explicit set of x-axis tick values to render. When omitted, Recharts
   * picks ticks automatically from `data` — fine for sparse series, but
   * dense ones (e.g. 5-min buckets over 24h) crowd the axis. Pass a
   * pre-thinned list (one per hour, etc.) to control tick density.
   */
  xTicks?: ReadonlyArray<string | number>;
  /**
   * Optional X-axis position for a "now" indicator — a vertical dashed
   * line marking the current wall-clock time. The value type must
   * match the chart's xKey domain (typically an ISO timestamp string).
   * When omitted, no reference line renders.
   */
  nowLine?: string | number;
  /** Format y-axis tick labels (e.g. number → "32 kW"). */
  yTickFormatter?: (value: unknown) => string;
  /** Format the tooltip's heading (the x-value of the hovered bucket). */
  tooltipLabelFormatter?: (value: unknown) => string;
  /** Format each value/name row in the tooltip. */
  tooltipFormatter?: (
    value: unknown,
    name: string
  ) => [string, string] | string;
  /**
   * Optional fully-custom tooltip body. When supplied, replaces the
   * default Recharts tooltip content entirely — gives the caller access
   * to the full payload for cases the per-row `tooltipFormatter` can't
   * handle (e.g. computing a delta between two series). The function
   * receives the same `TooltipProps` Recharts passes its own content
   * component; return null to render nothing for an inactive cursor.
   */
  tooltipContent?: (props: ChartTooltipProps) => ReactElement | null;
}

/**
 * Theme-aware AreaChart wrapper. Reads colours and typography from the
 * shared chart-theming module so light/dark mode flips for free, and
 * lets callers stay focused on their data — no Recharts boilerplate per
 * page.
 */
export function AreaChart<TData extends object>({
  data,
  xKey,
  series,
  stacked,
  mode = "area",
  gradient,
  showGrid = true,
  className,
  xTickFormatter,
  xTicks,
  nowLine,
  yTickFormatter,
  tooltipLabelFormatter,
  tooltipFormatter,
  tooltipContent,
}: AreaChartProps<TData>) {
  // Single-series charts read better with a soft fill gradient; stacked
  // multi-series look cleaner with flat semi-transparent fills. Line
  // mode skips fills entirely.
  const useGradient = mode === "area" && (gradient ?? series.length === 1);
  const useFill = mode === "area";

  const colorFor = (series_: AreaSeries, index: number) =>
    series_.color ?? colorForSeriesIndex(index);

  return (
    <div className={cn(className ?? "h-72 w-full")}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsAreaChart
          data={data}
          // Top margin bumps to 24px when a `nowLine` is rendered so the
          // top-anchored "now" label has room above the plot area instead
          // of being clipped by the chart container's edge.
          margin={{
            top: nowLine !== undefined ? 24 : 8,
            right: 16,
            bottom: 0,
            left: -8,
          }}
          stackOffset={stacked ? "none" : undefined}
        >
          {useGradient && (
            <defs>
              {series.map((s, i) => {
                const color = colorFor(s, i);
                return (
                  <linearGradient
                    key={s.key}
                    id={`area-gradient-${s.key}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor={color} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.05} />
                  </linearGradient>
                );
              })}
            </defs>
          )}

          {showGrid && (
            <CartesianGrid
              stroke={CHART_GRID_STROKE}
              strokeDasharray="2 4"
              vertical={false}
            />
          )}

          <XAxis
            dataKey={xKey}
            tickFormatter={xTickFormatter}
            ticks={xTicks ? [...xTicks] : undefined}
            tick={CHART_AXIS_STYLE}
            stroke={CHART_GRID_STROKE}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={CHART_AXIS_STYLE}
            stroke={CHART_GRID_STROKE}
            tickLine={false}
            axisLine={false}
            // 64px fits 4-digit fmtNum values with thousands separator
            // (e.g. "1,650 kW") at the chart's mono-10px tick font; the
            // previous 48px clipped the leading digit on /compare.
            width={64}
            tickFormatter={yTickFormatter}
          />

          <Tooltip
            wrapperStyle={CHART_TOOLTIP_WRAPPER_STYLE}
            contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
            labelStyle={CHART_TOOLTIP_LABEL_STYLE}
            itemStyle={CHART_TOOLTIP_ITEM_STYLE}
            cursor={{
              // Fall back to the first theme colour when callers pass an
              // empty `series` array (e.g. user has unchecked every zone).
              stroke: series[0]
                ? colorFor(series[0], 0)
                : colorForSeriesIndex(0),
              strokeWidth: 1,
              strokeDasharray: "2 4",
            }}
            labelFormatter={tooltipLabelFormatter}
            formatter={tooltipFormatter}
            content={tooltipContent}
          />

          {nowLine !== undefined && (
            <ReferenceLine
              x={nowLine}
              stroke="var(--primary)"
              strokeWidth={1.5}
              strokeDasharray="3 3"
              ifOverflow="extendDomain"
              label={{
                value: "now",
                position: "top",
                fill: "var(--primary)",
                fontSize: 10,
                fontFamily: "var(--font-mono)",
              }}
            />
          )}

          {series.map((s, i) => {
            const color = colorFor(s, i);
            return (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name ?? s.key}
                stackId={stacked ? "stack" : undefined}
                stroke={color}
                strokeWidth={2}
                fill={useGradient ? `url(#area-gradient-${s.key})` : color}
                fillOpacity={useFill ? (useGradient ? 1 : 0.5) : 0}
                isAnimationActive={false}
                connectNulls
              />
            );
          })}
        </RechartsAreaChart>
      </ResponsiveContainer>
    </div>
  );
}
