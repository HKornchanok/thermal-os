from django.db import migrations

FORWARD_SQL = """
-- TimescaleDB extension is preinstalled in the timescale/timescaledb image,
-- but the per-database CREATE EXTENSION is idempotent and harmless to repeat.
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Hypertables require the partitioning column (recorded_at) to be part of
-- every unique constraint, including the primary key. Drop the default
-- single-column PK and replace it with a composite (id, recorded_at).
ALTER TABLE building_sensorreading
    DROP CONSTRAINT building_sensorreading_pkey;
ALTER TABLE building_sensorreading
    ADD CONSTRAINT building_sensorreading_pkey PRIMARY KEY (id, recorded_at);

-- 1-day chunks match the most common dashboard query window (24h–7d).
SELECT create_hypertable(
    'building_sensorreading',
    'recorded_at',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Latest-per-machine queries (DISTINCT ON) walk this index.
CREATE INDEX IF NOT EXISTS sensorreading_machine_recorded_idx
    ON building_sensorreading (machine_id, recorded_at DESC);

-- Building-wide range scans (energy, summary) walk this one.
CREATE INDEX IF NOT EXISTS sensorreading_recorded_idx
    ON building_sensorreading (recorded_at DESC);

-- AI decision log is plain B-tree (sparse events, not a hypertable).
CREATE INDEX IF NOT EXISTS aidecision_decided_idx
    ON building_aidecision (decided_at DESC);
"""


REVERSE_SQL = """
DROP INDEX IF EXISTS aidecision_decided_idx;
DROP INDEX IF EXISTS sensorreading_recorded_idx;
DROP INDEX IF EXISTS sensorreading_machine_recorded_idx;

-- Cannot un-hypertable a table while data exists; reverse migration is
-- only safe before any rows are inserted. The composite PK is left in
-- place because reverting it requires identical data assumptions.
"""


class Migration(migrations.Migration):

    dependencies = [
        ("building", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, REVERSE_SQL),
    ]
