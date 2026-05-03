import Head from "next/head";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import { useEffect } from "react";

import { AlertBanner } from "@/components/dashboard/alert-banner";
import { ErrorState, LoadingState } from "@/components/dashboard/states";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { MachineCard } from "@/components/dashboard/machine-card";
import { useAlerts } from "@/lib/hooks/use-alerts";
import { useBuildingSummary } from "@/lib/hooks/use-building-summary";
import { useMachines } from "@/lib/hooks/use-machines";
import { fmtNum } from "@/lib/utils";

export default function OverviewPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, router]);

  const summaryQuery = useBuildingSummary();
  const alertsQuery = useAlerts();
  const machinesQuery = useMachines();

  if (status === "loading") {
    return <LoadingState message="Loading session…" />;
  }
  if (!session) return null;

  const summary = summaryQuery.data;
  const alerts = alertsQuery.data ?? [];
  const machines = machinesQuery.data ?? [];

  // Trend hint string + colour for the today's-kWh card. Server returns
  // null when there is no yesterday baseline (first-day data); show
  // "no baseline" rather than a misleading "—".
  const trendHint = (() => {
    if (!summary || summary.trend_pct === null) {
      return { text: "no baseline yet", className: "text-muted-foreground" };
    }
    const sign = summary.trend_pct > 0 ? "+" : "";
    return {
      text: `${sign}${summary.trend_pct.toFixed(1)}% vs yesterday`,
      className:
        summary.trend_pct > 0
          ? "text-destructive"
          : summary.trend_pct < 0
            ? "text-primary"
            : "text-muted-foreground",
    };
  })();

  return (
    <>
      <Head>
        <title>Overview · ThermalOS</title>
      </Head>

      <div className="flex items-baseline justify-between gap-4">
        <h1 className="mt-0 text-2xl font-semibold">Overview</h1>
        <p className="text-xs text-muted-foreground">
          Signed in as{" "}
          <strong className="text-foreground">{session.user?.name}</strong>
        </p>
      </div>

      {/* Alerts — only renders when there are any. */}
      {alertsQuery.isSuccess && alerts.length > 0 && (
        <section className="mt-4">
          <AlertBanner
            alerts={alerts}
            onSelect={(id) => router.push(`/machines?selected=${id}`)}
          />
        </section>
      )}

      {/* KPIs */}
      <section className="mt-4" data-testid="overview-kpis">
        {summaryQuery.isLoading ? (
          <LoadingState message="Loading KPIs…" testId="kpis-loading" />
        ) : summaryQuery.isError ? (
          <ErrorState
            message={`Failed to load summary: ${
              summaryQuery.error instanceof Error
                ? summaryQuery.error.message
                : "unknown error"
            }`}
            testId="kpis-error"
          />
        ) : summary ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard
              label="Total machines"
              value={summary.total_machines}
              testId="kpi-total-machines"
            />
            <KpiCard
              label="Active"
              value={summary.active_machines}
              hint={`${summary.inactive_machines} off`}
              testId="kpi-active"
            />
            <KpiCard
              label="Total power"
              value={`${fmtNum(summary.total_power_kw)} kW`}
              testId="kpi-total-power"
            />
            <KpiCard
              label="Today's energy"
              value={`${fmtNum(summary.today_kwh)} kWh`}
              hint={
                <span className={trendHint.className}>{trendHint.text}</span>
              }
              testId="kpi-today-kwh"
            />
            <KpiCard
              label="Yesterday"
              value={
                summary.yesterday_kwh !== null
                  ? `${fmtNum(summary.yesterday_kwh)} kWh`
                  : "—"
              }
              testId="kpi-yesterday-kwh"
            />
            <KpiCard
              label="Avg temperature"
              value={
                summary.avg_temperature !== null
                  ? `${summary.avg_temperature.toFixed(1)} °C`
                  : "—"
              }
              hint="ON ACs only"
              testId="kpi-avg-temp"
            />
          </div>
        ) : null}
      </section>

      {/* Machine grid */}
      <section className="mt-6">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 className="m-0 text-sm font-medium text-muted-foreground">
            Machines
          </h2>
          <p className="text-xs text-muted-foreground">
            {machines.length || "…"} total
          </p>
        </div>
        {machinesQuery.isLoading ? (
          <LoadingState message="Loading machines…" testId="machines-loading" />
        ) : machinesQuery.isError ? (
          <ErrorState
            message={`Failed to load machines: ${
              machinesQuery.error instanceof Error
                ? machinesQuery.error.message
                : "unknown error"
            }`}
            testId="machines-error"
          />
        ) : (
          <div
            data-testid="machines-grid"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4"
          >
            {machines.map((m) => (
              <MachineCard
                key={m.id}
                machine={m}
                onClick={() => router.push(`/machines?selected=${m.id}`)}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
