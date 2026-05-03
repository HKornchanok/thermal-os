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
