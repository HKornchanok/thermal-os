/**
 * Tiny fetch wrapper + shared API types. All endpoints under /api/* go
 * through the Next.js `rewrites().fallback` proxy to Django; the token
 * is passed explicitly so this stays usable outside React (e.g. from
 * queryFn).
 */

const DEFAULT_BASE = ""; // same-origin via Next.js rewrite proxy

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
  token?: string | null;
  signal?: AbortSignal;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Override for tests; defaults to same-origin. */
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
      /* non-JSON error body */
    }
    throw new ApiError(
      response.status,
      `${options.method ?? "GET"} ${path} failed with ${response.status}`,
      parsed
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * `?key=value&…` from a flat params object. Skips undefined/null;
 * arrays serialise as comma-joined (`?action=turn_on,set_temp`).
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

// Response types — single source of truth for hooks + pages.

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
