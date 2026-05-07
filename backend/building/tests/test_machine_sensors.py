"""Tests for GET /api/machines/{id}/sensors/."""

from datetime import UTC, timedelta

import pytest

pytestmark = pytest.mark.django_db


# ---------- Auth gating ------------------------------------------------------


def test_sensors_requires_authentication(api_client):
    response = api_client.get("/api/machines/1/sensors/")
    assert response.status_code == 401


# ---------- 404 / 400 paths --------------------------------------------------


def test_sensors_unknown_machine_returns_404(admin_client):
    response = admin_client.get("/api/machines/99999/sensors/")
    assert response.status_code == 404


def test_sensors_invalid_metric_returns_400(admin_client, _seed_machine_id):
    response = admin_client.get(
        f"/api/machines/{_seed_machine_id}/sensors/?metric=DROP_TABLE"
    )
    assert response.status_code == 400
    assert "Invalid metric" in response.json()["detail"]


def test_sensors_invalid_bucket_returns_400(admin_client, _seed_machine_id):
    response = admin_client.get(
        f"/api/machines/{_seed_machine_id}/sensors/?bucket=42min"
    )
    assert response.status_code == 400
    assert "Invalid bucket" in response.json()["detail"]


def test_sensors_invalid_datetime_returns_400(admin_client, _seed_machine_id):
    response = admin_client.get(
        f"/api/machines/{_seed_machine_id}/sensors/?from=not-a-date"
    )
    assert response.status_code == 400
    assert "Invalid datetime" in response.json()["detail"]


# ---------- Happy path: shape + ordering ------------------------------------


def test_sensors_returns_list_of_bucket_value_pairs(admin_client, _seed_machine_id):
    response = admin_client.get(f"/api/machines/{_seed_machine_id}/sensors/")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    assert len(body) > 0
    for entry in body:
        assert set(entry.keys()) == {"bucket", "value"}
        assert isinstance(entry["bucket"], str)
        assert entry["bucket"].endswith("+00:00") or entry["bucket"].endswith("Z")


def test_sensors_buckets_are_chronological(admin_client, _seed_machine_id):
    body = admin_client.get(f"/api/machines/{_seed_machine_id}/sensors/").json()
    buckets = [e["bucket"] for e in body]
    assert buckets == sorted(buckets)


# ---------- Smart default range ----------------------------------------------


def test_sensors_default_range_uses_day_of_max_recorded_at(
    admin_client, _seed_machine_id
):
    """Without from/to, the response should cover ~one day at the smallest bucket."""
    body = admin_client.get(f"/api/machines/{_seed_machine_id}/sensors/").json()
    # At 5-min cadence, one day = 288 buckets max (24*60/5). Allow some
    # tolerance for partial day at session boundaries.
    assert 100 <= len(body) <= 288


# ---------- Bucket aliases ---------------------------------------------------


def test_sensors_5min_bucket_returns_more_points_than_1h(
    admin_client, _seed_machine_id
):
    fivemin = admin_client.get(
        f"/api/machines/{_seed_machine_id}/sensors/?bucket=5min"
    ).json()
    onehour = admin_client.get(
        f"/api/machines/{_seed_machine_id}/sensors/?bucket=1h"
    ).json()
    assert len(fivemin) > len(onehour)


@pytest.mark.parametrize("bucket_alias", ["5min", "15min", "1h", "1d"])
def test_sensors_all_allowed_buckets_return_200(
    admin_client, _seed_machine_id, bucket_alias
):
    response = admin_client.get(
        f"/api/machines/{_seed_machine_id}/sensors/?bucket={bucket_alias}"
    )
    assert response.status_code == 200


# ---------- Metric allowlist -------------------------------------------------


@pytest.mark.parametrize(
    "metric", ["power_kw", "temperature", "setpoint", "speed_pct"]
)
def test_sensors_all_allowed_metrics_return_200(
    admin_client, _seed_machine_ac_id, _seed_machine_fan_id, metric
):
    """ACs have temp/setpoint, fans have speed_pct. Querying the wrong metric
    on a machine returns an empty list (no rows match `metric IS NOT NULL`)
    rather than an error — clients can render an empty chart."""
    machine_id = _seed_machine_ac_id if metric != "speed_pct" else _seed_machine_fan_id
    response = admin_client.get(
        f"/api/machines/{machine_id}/sensors/?metric={metric}"
    )
    assert response.status_code == 200


def test_sensors_speed_pct_on_ac_returns_empty(admin_client, _seed_machine_ac_id):
    """ACs have speed_pct=NULL — the metric IS NOT NULL filter drops every row."""
    response = admin_client.get(
        f"/api/machines/{_seed_machine_ac_id}/sensors/?metric=speed_pct"
    )
    assert response.status_code == 200
    assert response.json() == []


def test_sensors_temperature_on_fan_returns_empty(admin_client, _seed_machine_fan_id):
    """Fans have temperature=NULL — same as above, opposite direction."""
    response = admin_client.get(
        f"/api/machines/{_seed_machine_fan_id}/sensors/?metric=temperature"
    )
    assert response.status_code == 200
    assert response.json() == []


# ---------- Custom range -----------------------------------------------------


def test_sensors_custom_range_works(admin_client, _seed_machine_id, _seed_max_ts):
    # Use Z suffix in the URL — `+` in a query value is decoded as a space.
    def _z(dt):
        return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

    from_dt = _z(_seed_max_ts - timedelta(hours=2))
    to_dt = _z(_seed_max_ts)
    response = admin_client.get(
        f"/api/machines/{_seed_machine_id}/sensors/"
        f"?from={from_dt}&to={to_dt}&bucket=15min"
    )
    assert response.status_code == 200
    body = response.json()
    # 2-hour window at 15-min buckets = up to 9 (8 full buckets + a partial
    # at the leading edge if `from` doesn't align with a 15-min boundary).
    assert 0 < len(body) <= 9


# ---------- SQL injection guard (allowlist proves the design works) ---------


def test_sensors_metric_param_cannot_inject_sql(admin_client, _seed_machine_id):
    """The metric value is interpolated into the SQL string; if the allowlist
    fails, an attacker could exfiltrate data. Belt-and-braces."""
    payload = "power_kw FROM building_sensorreading; DROP TABLE auth_user; --"
    response = admin_client.get(
        f"/api/machines/{_seed_machine_id}/sensors/?metric={payload}"
    )
    assert response.status_code == 400


# ---------- Fixtures ---------------------------------------------------------


@pytest.fixture
def _seed_machine_id(admin_client):
    """ID of the first seeded machine — caller-agnostic of admin/non-admin."""
    body = admin_client.get("/api/machines/").json()
    return body[0]["id"]


@pytest.fixture
def _seed_machine_ac_id(admin_client):
    """ID of any seeded AC machine (large_ac or small_ac)."""
    body = admin_client.get("/api/machines/").json()
    return next(m["id"] for m in body if m["machine_type"] in ("large_ac", "small_ac"))


@pytest.fixture
def _seed_machine_fan_id(admin_client):
    """ID of any seeded fan machine."""
    body = admin_client.get("/api/machines/").json()
    return next(m["id"] for m in body if m["machine_type"] == "fan")


@pytest.fixture
def _seed_max_ts(admin_client):
    """Latest reading timestamp across the seed."""
    from datetime import datetime

    body = admin_client.get("/api/machines/").json()
    timestamps = [
        datetime.fromisoformat(m["latest_reading"]["recorded_at"])
        for m in body
        if m["latest_reading"]
    ]
    return max(timestamps)
