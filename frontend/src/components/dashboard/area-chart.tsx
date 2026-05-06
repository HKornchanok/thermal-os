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

// Pin name to `string` (every series uses a string label).
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

export type AreaSeries = {
  /** Property key in `data` rows to read the y-value from. */
  key: string;
  /** Tooltip label; defaults to `key`. */
  name?: string;
  /** Defaults to the next CHART_SERIES_COLORS slot. */
  color?: string;
};

// `extends object` accepts concrete domain types (BuildingEnergyPoint, …)
// that don't have an index signature, without erasing `keyof TData`.
export interface AreaChartProps<TData extends object> {
  data: TData[];
  xKey: keyof TData & string;
  series: AreaSeries[];

  stacked?: boolean;
  /** "line" strips fills (used for /compare overlay). */
  mode?: "area" | "line";
  gradient?: boolean;
  showGrid?: boolean;
  className?: string;

  xTickFormatter?: (value: unknown) => string;
  /** Pre-thinned tick list — useful when raw bucket density crowds the axis. */
  xTicks?: ReadonlyArray<string | number>;
  /** Vertical "now" reference line — value must match the xKey domain. */
  nowLine?: string | number;
  yTickFormatter?: (value: unknown) => string;
  tooltipLabelFormatter?: (value: unknown) => string;
  tooltipFormatter?: (
    value: unknown,
    name: string
  ) => [string, string] | string;
  /** Full custom tooltip body; replaces the default Recharts content. */
  tooltipContent?: (props: ChartTooltipProps) => ReactElement | null;
}

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
  const useGradient = mode === "area" && (gradient ?? series.length === 1);
  const useFill = mode === "area";

  const colorFor = (series_: AreaSeries, index: number) =>
    series_.color ?? colorForSeriesIndex(index);

  return (
    <div className={cn(className ?? "h-72 w-full")}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsAreaChart
          data={data}
          // Extra top margin reserves room for the "now" label.
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
            // 64px fits 4-digit fmtNum values like "1,650 kW".
            width={64}
            tickFormatter={yTickFormatter}
          />

          <Tooltip
            wrapperStyle={CHART_TOOLTIP_WRAPPER_STYLE}
            contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
            labelStyle={CHART_TOOLTIP_LABEL_STYLE}
            itemStyle={CHART_TOOLTIP_ITEM_STYLE}
            cursor={{
              // Falls back to chart-1 if the caller passes an empty series.
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
