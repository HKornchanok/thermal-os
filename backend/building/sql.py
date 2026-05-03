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
