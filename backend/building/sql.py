"""SQL constants for the building app's read endpoints.

Concentrating raw SQL here keeps view modules readable. Every query uses
%s placeholder binding for user input. The only string formatting allowed
is for allowlisted column names and INTERVAL literals — see
building.utils for the allowlists.
"""

# /api/machines/ — every machine plus its most recent reading.
# LATERAL JOIN walks the (machine_id, recorded_at DESC) index once per
# machine and picks the top row — same plan as DISTINCT ON, with clearer
# semantics when we want the FULL row, not just one column per group.
LATEST_READING_PER_MACHINE = """
    SELECT
        m.id, m.name, m.machine_type, m.zone, m.rated_power_kw, m.is_critical,
        l.recorded_at, l.power_kw, l.temperature, l.setpoint, l.speed_pct, l.status
    FROM building_machine m
    LEFT JOIN LATERAL (
        SELECT recorded_at, power_kw, temperature, setpoint, speed_pct, status
        FROM building_sensorreading
        WHERE machine_id = m.id
        ORDER BY recorded_at DESC
        LIMIT 1
    ) l ON TRUE
    ORDER BY m.id
"""


# /api/machines/{id}/sensors/ — time-bucketed values for a single machine.
# {metric} comes from utils.ALLOWED_METRICS allowlist; {bucket_interval}
# from utils.ALLOWED_BUCKETS_FULL. machine_id and range bind via %s.
# AVG ignores NULLs; the explicit `IS NOT NULL` filter keeps fully-empty
# buckets from appearing in the response with a NULL value.
SENSOR_TIMESERIES_TPL = """
    SELECT time_bucket('{bucket_interval}'::interval, recorded_at) AS bucket,
           AVG({metric}) AS value
    FROM building_sensorreading
    WHERE machine_id = %s
      AND recorded_at >= %s
      AND recorded_at < %s
      AND {metric} IS NOT NULL
    GROUP BY bucket
    ORDER BY bucket
"""


# /api/building/summary/ — latest reading per machine joined to machine type.
# DISTINCT ON walks the (machine_id, recorded_at DESC) index once per
# machine — same plan as the LATERAL JOIN above, smaller select list.
LATEST_FOR_SUMMARY = """
    SELECT DISTINCT ON (sr.machine_id)
        sr.machine_id, sr.status, sr.power_kw, sr.temperature, sr.setpoint, m.machine_type
    FROM building_sensorreading sr
    JOIN building_machine m ON m.id = sr.machine_id
    ORDER BY sr.machine_id, sr.recorded_at DESC
"""


# /api/building/summary/ — total kWh in a window. Each reading is a 5-min
# sample; multiplying SUM(kw) by 5/60 converts to kWh. The COALESCE keeps
# the result a float (not NULL) when the window is empty.
KWH_BETWEEN = """
    SELECT COALESCE(SUM(power_kw), 0) * 5.0 / 60.0 AS kwh
    FROM building_sensorreading
    WHERE recorded_at >= %s AND recorded_at < %s
"""


# /api/building/energy/ — building-wide power over a time range,
# time-bucketed. {bucket_interval} comes from utils.ALLOWED_BUCKETS_AGGREGATE.
TOTAL_ENERGY_TPL = """
    SELECT time_bucket('{bucket_interval}'::interval, recorded_at) AS bucket,
           SUM(power_kw) AS total_kw
    FROM building_sensorreading
    WHERE recorded_at >= %s AND recorded_at < %s
    GROUP BY bucket
    ORDER BY bucket
"""


# /api/building/energy/by-zone/ — same range as TOTAL_ENERGY_TPL but
# grouped by zone. The view pivots rows in Python so the response is one
# entry per bucket with zone names as keys mixed alongside the `bucket`
# key — the frontend maps each zone key to a Recharts <Area> directly.
ZONE_ENERGY_TPL = """
    SELECT time_bucket('{bucket_interval}'::interval, sr.recorded_at) AS bucket,
           m.zone,
           SUM(sr.power_kw) AS total_kw
    FROM building_sensorreading sr
    JOIN building_machine m ON m.id = sr.machine_id
    WHERE sr.recorded_at >= %s AND sr.recorded_at < %s
    GROUP BY bucket, m.zone
    ORDER BY bucket, m.zone
"""


# All zones currently in the registry — used to ensure every bucket pivot
# carries every zone key, even when a machine is OFF for the whole bucket.
ALL_ZONES = "SELECT zone FROM building_machine ORDER BY id"


# /api/decisions/ — count of matching rows for pagination metadata.
# `action` accepts a list (e.g. ['turn_on', 'set_temp']) or NULL for no
# filter. The `(%s::text[] IS NULL OR action_type = ANY(%s::text[]))`
# pattern is the multi-value equivalent of the previous IS NULL/equality
# guard. The same parameter is bound twice — once for the NULL check,
# once for the ANY comparison — so count and page queries share the
# filter shape.
DECISIONS_COUNT = """
    SELECT COUNT(*) FROM building_aidecision
    WHERE decided_at >= %s AND decided_at < %s
      AND (%s::text[] IS NULL OR action_type = ANY(%s::text[]))
"""


# /api/decisions/ — one page of results. machine_name comes from a LEFT
# JOIN so decisions whose machine has been deleted (ON DELETE SET NULL)
# still appear with machine_name = NULL — preserves the audit trail.
DECISIONS_PAGE = """
    SELECT a.id, a.decided_at, a.machine_id, m.name AS machine_name,
           a.action_type, a.value, a.reason
    FROM building_aidecision a
    LEFT JOIN building_machine m ON m.id = a.machine_id
    WHERE a.decided_at >= %s AND a.decided_at < %s
      AND (%s::text[] IS NULL OR a.action_type = ANY(%s::text[]))
    ORDER BY a.decided_at DESC
    LIMIT %s OFFSET %s
"""


# /api/chat/ — most recent N decisions across all time, with machine_name
# joined in. Same join shape as DECISIONS_PAGE but no time/action filter
# and a single LIMIT.
DECISIONS_RECENT = """
    SELECT a.id, a.decided_at, a.machine_id, m.name AS machine_name,
           a.action_type, a.value, a.reason
    FROM building_aidecision a
    LEFT JOIN building_machine m ON m.id = a.machine_id
    ORDER BY a.decided_at DESC
    LIMIT %s
"""


# /api/energy/compare/ — average of hourly building totals for one period.
# Avg-of-hourly-sums smooths over per-interval noise, giving a stable
# comparison figure regardless of period length. The COALESCE keeps the
# result a float (not NULL) when the window has no data.
COMPARE_AVG = """
    SELECT COALESCE(AVG(hourly_kw), 0) AS avg_kw
    FROM (
        SELECT time_bucket('1 hour'::interval, recorded_at) AS bucket,
               SUM(power_kw) AS hourly_kw
        FROM building_sensorreading
        WHERE recorded_at >= %s AND recorded_at < %s
        GROUP BY bucket
    ) hourly
"""


# /api/alerts/ — Rule 1: latest reading > 90% of rated, status ON.
# Inner DISTINCT ON walks the (machine_id, recorded_at DESC) index once
# per machine; outer WHERE filters to the threshold breach.
ALERT_POWER_SPIKE = """
    SELECT sub.machine_id, sub.name, sub.power_kw, sub.rated_power_kw
    FROM (
        SELECT DISTINCT ON (sr.machine_id)
            sr.machine_id, m.name, sr.power_kw, m.rated_power_kw, sr.status
        FROM building_sensorreading sr
        JOIN building_machine m ON m.id = sr.machine_id
        ORDER BY sr.machine_id, sr.recorded_at DESC
    ) sub
    WHERE sub.status = 'ON' AND sub.power_kw > sub.rated_power_kw * 0.90
"""


# /api/alerts/ — Rule 2: latest AC reading with |temp - setpoint| > 2°C.
# Pre-filters to AC machines (temperature/setpoint NOT NULL), then takes
# the latest reading per machine and tests the drift threshold.
ALERT_TEMP_DRIFT = """
    SELECT sub.machine_id, sub.name, sub.temperature, sub.setpoint
    FROM (
        SELECT DISTINCT ON (sr.machine_id)
            sr.machine_id, m.name, sr.temperature, sr.setpoint, sr.status
        FROM building_sensorreading sr
        JOIN building_machine m ON m.id = sr.machine_id
        WHERE sr.temperature IS NOT NULL AND sr.setpoint IS NOT NULL
        ORDER BY sr.machine_id, sr.recorded_at DESC
    ) sub
    WHERE sub.status = 'ON' AND ABS(sub.temperature - sub.setpoint) > 2.0
"""


# /api/alerts/ — Rule 3: non-critical machine ON for >16 consecutive hours.
# Streak start = first ON reading AFTER the most recent OFF (or MIN ON
# reading if the machine has no OFF history yet). Old definition
# fell back to `latest - 24h` when last_off was NULL, which incorrectly
# fired for any never-OFF machine. Critical machines are excluded —
# Server Room AC + Basement Parking fan run 24/7 by design.
# /api/chat/ — per-zone kWh in a window. 5-min sample power × 5/60 = kWh,
# same conversion as KWH_BETWEEN. Used to feed today + yesterday zone
# breakdowns into the chat assistant's grounded prompt.
ZONE_KWH_BETWEEN = """
    SELECT m.zone,
           COALESCE(SUM(sr.power_kw), 0) * 5.0 / 60.0 AS kwh
    FROM building_sensorreading sr
    JOIN building_machine m ON m.id = sr.machine_id
    WHERE sr.recorded_at >= %s AND sr.recorded_at < %s
    GROUP BY m.zone
    ORDER BY kwh DESC
"""


# /api/chat/ — daily building kWh history, one row per Bangkok-day bucket.
# `time_bucket` with the BANGKOK timezone offset puts each day's energy
# in the correct local-day bucket. Replaces a 7-iteration loop calling
# KWH_BETWEEN — same result, one round trip.
DAILY_KWH_HISTORY = """
    SELECT time_bucket('1 day'::interval, recorded_at, '+07:00') AS day,
           COALESCE(SUM(power_kw), 0) * 5.0 / 60.0 AS kwh
    FROM building_sensorreading
    WHERE recorded_at >= %s AND recorded_at < %s
    GROUP BY day
    ORDER BY day
"""


ALERT_NONSTOP = """
    SELECT m.id AS machine_id, m.name,
           EXTRACT(EPOCH FROM (latest.ts - streak.streak_start)) / 3600 AS hours_on
    FROM building_machine m
    JOIN LATERAL (
        SELECT recorded_at AS ts, status
        FROM building_sensorreading
        WHERE machine_id = m.id
        ORDER BY recorded_at DESC
        LIMIT 1
    ) latest ON TRUE
    LEFT JOIN LATERAL (
        SELECT recorded_at AS ts
        FROM building_sensorreading
        WHERE machine_id = m.id AND status = 'OFF'
        ORDER BY recorded_at DESC
        LIMIT 1
    ) last_off ON TRUE
    JOIN LATERAL (
        SELECT MIN(recorded_at) AS streak_start
        FROM building_sensorreading
        WHERE machine_id = m.id
          AND status = 'ON'
          AND recorded_at > COALESCE(last_off.ts, '-infinity'::timestamptz)
    ) streak ON TRUE
    WHERE NOT m.is_critical
      AND latest.status = 'ON'
      AND streak.streak_start IS NOT NULL
      AND EXTRACT(EPOCH FROM (latest.ts - streak.streak_start)) / 3600 > 16
"""
