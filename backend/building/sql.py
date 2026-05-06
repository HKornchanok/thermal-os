"""SQL constants for the building app's read endpoints.

Every query uses %s parameter binding for user input. The only string
formatting is for allowlisted column names and INTERVAL literals — see
building.utils for the allowlists.
"""

# /api/machines/ — every machine + its most recent reading.
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
# IS NOT NULL filter keeps fully-empty buckets out of the response.
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


# /api/building/summary/ — latest reading per machine, joined to type.
LATEST_FOR_SUMMARY = """
    SELECT DISTINCT ON (sr.machine_id)
        sr.machine_id, sr.status, sr.power_kw, sr.temperature, sr.setpoint, m.machine_type
    FROM building_sensorreading sr
    JOIN building_machine m ON m.id = sr.machine_id
    ORDER BY sr.machine_id, sr.recorded_at DESC
"""


# Total kWh in a window. 5-min samples → SUM(kw) × 5/60 = kWh.
KWH_BETWEEN = """
    SELECT COALESCE(SUM(power_kw), 0) * 5.0 / 60.0 AS kwh
    FROM building_sensorreading
    WHERE recorded_at >= %s AND recorded_at < %s
"""


# /api/building/energy/ — building-wide power, time-bucketed.
TOTAL_ENERGY_TPL = """
    SELECT time_bucket('{bucket_interval}'::interval, recorded_at) AS bucket,
           SUM(power_kw) AS total_kw
    FROM building_sensorreading
    WHERE recorded_at >= %s AND recorded_at < %s
    GROUP BY bucket
    ORDER BY bucket
"""


# /api/building/energy/by-zone/ — power grouped by zone; pivoted in Python.
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


ALL_ZONES = "SELECT zone FROM building_machine ORDER BY id"


# /api/decisions/ — count + page for pagination.
# `(%s::text[] IS NULL OR action_type = ANY(%s::text[]))` accepts a list
# OR NULL for no filter; the same parameter binds twice.
DECISIONS_COUNT = """
    SELECT COUNT(*) FROM building_aidecision
    WHERE decided_at >= %s AND decided_at < %s
      AND (%s::text[] IS NULL OR action_type = ANY(%s::text[]))
"""

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


# /api/chat/ — most recent N decisions for snapshot context.
DECISIONS_RECENT = """
    SELECT a.id, a.decided_at, a.machine_id, m.name AS machine_name,
           a.action_type, a.value, a.reason
    FROM building_aidecision a
    LEFT JOIN building_machine m ON m.id = a.machine_id
    ORDER BY a.decided_at DESC
    LIMIT %s
"""


# /api/energy/compare/ — average of hourly building totals (smooths
# per-interval noise so periods of different length compare fairly).
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


# /api/chat/ — per-zone kWh in a window.
ZONE_KWH_BETWEEN = """
    SELECT m.zone,
           COALESCE(SUM(sr.power_kw), 0) * 5.0 / 60.0 AS kwh
    FROM building_sensorreading sr
    JOIN building_machine m ON m.id = sr.machine_id
    WHERE sr.recorded_at >= %s AND sr.recorded_at < %s
    GROUP BY m.zone
    ORDER BY kwh DESC
"""


# /api/chat/ — daily kWh history, one row per Bangkok-day bucket.
# Single time_bucket call replaces a 7-iteration KWH_BETWEEN loop.
DAILY_KWH_HISTORY = """
    SELECT time_bucket('1 day'::interval, recorded_at, '+07:00') AS day,
           COALESCE(SUM(power_kw), 0) * 5.0 / 60.0 AS kwh
    FROM building_sensorreading
    WHERE recorded_at >= %s AND recorded_at < %s
    GROUP BY day
    ORDER BY day
"""


# /api/alerts/ Rule 1 — latest reading > 90% of rated, status ON.
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


# /api/alerts/ Rule 2 — latest AC reading with |temp - setpoint| > 2°C.
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


# /api/alerts/ Rule 3 — non-critical machine ON for >16 consecutive hours.
# Streak start = first ON reading after the most recent OFF, or MIN(ON)
# if there's no OFF history. The previous version fell back to
# `latest - 24h` and silently fired for any never-OFF machine.
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
