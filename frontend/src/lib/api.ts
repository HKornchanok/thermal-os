/**
 * Tiny fetch wrapper + shared API types.
 *
 * All endpoints live under /api/* and are proxied to Django by the Next.js
 * `rewrites().fallback` rule. NextAuth's /api/auth/* stays local. Every
 * call requires a Bearer access token from the session — pass it
 * explicitly so this helper stays usable from query-client contexts that
 * don't have access to React hooks.
 */

const DEFAULT_BASE = ""; // same-origin, relies on Next.js rewrite proxy

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type ApiFetchOptions = {
  /** Bearer access token from the NextAuth session. */
  token?: string | null;
  /** AbortSignal, typically the one TanStack Query passes via queryFn. */
  signal?: AbortSignal;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Optional override for the API base — e.g. an absolute URL in tests. */
  baseUrl?: string;
};

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const url = `${options.baseUrl ?? DEFAULT_BASE}${path}`;
  const response = await fetch(url, {
    method: options.method ?? "GET",
    signal: options.signal,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      // Non-JSON error body — fall through with undefined.
    }
    throw new ApiError(
      response.status,
      `${options.method ?? "GET"} ${path} failed with ${response.status}`,
      parsed
    );
  }

  // 204 No Content has no JSON body; cast undefined to T for the caller.
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * Build a query string from a flat params object. Skips `undefined` and
 * `null` values; arrays serialise as comma-joined (matches the
 * backend's `?action=turn_on,set_temp` convention). Returns the
 * `?key=value&…` prefix or empty string when nothing was set.
 *
 * Replaces hand-rolled `URLSearchParams` blocks across `lib/hooks/use-*`
 * with one well-tested utility — keeps the `?` prefix consistent and
 * the encoding rules in one place.
 */
export function toSearchParams(
  params: Record<string, string | number | string[] | undefined | null>
): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      sp.set(key, value.join(","));
    } else {
      sp.set(key, String(value));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

// =====================================================================
// Response types — mirror the shapes documented in DESIGN.md §1B.
// Keep these here as the single source of truth used by hooks and pages.
// =====================================================================

export type MachineType = "large_ac" | "small_ac" | "fan";
export type ReadingStatus = "ON" | "OFF";

export interface SensorReading {
  machine_id: number;
  recorded_at: string; // ISO 8601
  power_kw: number;
  temperature: number | null;
  setpoint: number | null;
  speed_pct: number | null;
  status: ReadingStatus;
}

export interface Machine {
  id: number;
  name: string;
  machine_type: MachineType;
  zone: string;
  rated_power_kw: number;
  is_critical: boolean;
  latest_reading: SensorReading | null;
}

export interface SensorSeriesPoint {
  bucket: string; // ISO 8601
  value: number;
}

export interface BuildingSummary {
  total_machines: number;
  active_machines: number;
  inactive_machines: number;
  total_power_kw: number;
  today_kwh: number;
  yesterday_kwh: number | null;
  trend_pct: number | null;
  avg_temperature: number | null;
}

export interface BuildingEnergyPoint {
  bucket: string;
  total_kw: number;
}

/** Pivoted by zone — `bucket` is a string, every other key is a zone name → kW. */
export interface ZoneEnergyPoint {
  bucket: string;
  [zone: string]: number | string;
}

export type DecisionAction = "turn_on" | "turn_off" | "set_temp";

export interface Decision {
  id: number;
  decided_at: string;
  machine: number | null;
  machine_name: string | null;
  action_type: DecisionAction;
  value: number | null;
  reason: string;
}

export interface Paginated<T> {
  count: number;
  page: number;
  page_size: number;
  total_pages: number;
  results: T[];
}

export interface EnergyComparePeriod {
  from: string;
  to: string;
  avg_kw: number;
}

export interface EnergyCompare {
  before: EnergyComparePeriod | null;
  after: EnergyComparePeriod | null;
  savings_pct: number | null;
}

export type AlertSeverity = "critical" | "warning";
export type AlertRule = "power_spike" | "temp_drift" | "nonstop_runtime";

export interface Alert {
  severity: AlertSeverity;
  rule: AlertRule;
  machine_id: number;
  machine_name: string;
  message: string;
  value: number;
  threshold: number;
}

export interface ChatRequest {
  message: string;
}

export interface ChatResponse {
  reply: string;
}
