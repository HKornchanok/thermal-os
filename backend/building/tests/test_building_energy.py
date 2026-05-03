"""Tests for GET /api/building/energy/."""

from datetime import datetime, timedelta, timezone

import pytest


pytestmark = pytest.mark.django_db


def _z(dt: datetime) -> str:
    """Render a datetime in URL-safe Z form (avoids `+` → space decoding)."""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------- Auth gating ------------------------------------------------------


def test_energy_requires_authentication(api_client):
    response = api_client.get("/api/building/energy/")
    assert response.status_code == 401


# ---------- 400 paths --------------------------------------------------------


def test_energy_invalid_bucket_returns_400(admin_client):
    response = admin_client.get("/api/building/energy/?bucket=42min")
    assert response.status_code == 400


def test_energy_5min_bucket_rejected(admin_client):
    """5min is allowed for /machines/{id}/sensors/ but not for the
    building-wide endpoint — too noisy summed across 12 machines."""
    response = admin_client.get("/api/building/energy/?bucket=5min")
    assert response.status_code == 400


def test_energy_1d_bucket_rejected(admin_client):
    """1d is too coarse for the area chart's pacing."""
    response = admin_client.get("/api/building/energy/?bucket=1d")
    assert response.status_code == 400


def test_energy_invalid_datetime_returns_400(admin_client):
    response = admin_client.get("/api/building/energy/?from=not-a-date")
    assert response.status_code == 400


# ---------- Happy path -------------------------------------------------------


def test_energy_returns_list_of_bucket_totals(admin_client):
    response = admin_client.get("/api/building/energy/")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    assert len(body) > 0
    for entry in body:
        assert set(entry.keys()) == {"bucket", "total_kw"}
        assert isinstance(entry["total_kw"], (int, float))
        assert entry["total_kw"] >= 0


def test_energy_buckets_are_chronological(admin_client):
    body = admin_client.get("/api/building/energy/").json()
    buckets = [e["bucket"] for e in body]
    assert buckets == sorted(buckets)


def test_energy_default_range_is_24_hours_at_1h_bucket(admin_client):
    """Default = last 24h, default bucket = 1h, so ≤ 25 entries (24 full
    + a partial leading bucket)."""
    body = admin_client.get("/api/building/energy/").json()
    assert 1 <= len(body) <= 25


# ---------- Bucket parametrisation ------------------------------------------


@pytest.mark.parametrize("bucket_alias", ["15min", "1h"])
def test_energy_all_allowed_buckets_return_200(admin_client, bucket_alias):
    response = admin_client.get(f"/api/building/energy/?bucket={bucket_alias}")
    assert response.status_code == 200


def test_energy_15min_returns_more_points_than_1h(admin_client):
    fifteen = admin_client.get("/api/building/energy/?bucket=15min").json()
    one = admin_client.get("/api/building/energy/?bucket=1h").json()
    assert len(fifteen) > len(one)
    # 15min should give ~4× the entries of 1h for the same window.
    assert len(fifteen) >= len(one) * 3


# ---------- Custom range -----------------------------------------------------


def test_energy_custom_range_works(admin_client):
    """Use the seeded MAX(recorded_at) as the upper bound and look back 6h."""
    summary_resp = admin_client.get("/api/building/summary/").json()
    # We don't have direct access to max_ts via the API, but we can grab a
    # reading timestamp from /machines/.
    machines = admin_client.get("/api/machines/").json()
    latest_ts = max(
        datetime.fromisoformat(m["latest_reading"]["recorded_at"])
        for m in machines
        if m["latest_reading"]
    )
    from_dt = _z(latest_ts - timedelta(hours=6))
    to_dt = _z(latest_ts)
    response = admin_client.get(
        f"/api/building/energy/?from={from_dt}&to={to_dt}&bucket=1h"
    )
    assert response.status_code == 200
    body = response.json()
    # 6-hour window at 1h buckets — up to 7 entries (6 + a partial leading).
    assert 1 <= len(body) <= 7


# ---------- Total power makes sense -----------------------------------------


def test_energy_total_kw_is_sum_across_machines(admin_client):
    """The latest 1h bucket should include the engineered AC-L1 spike at
    ~41.4 kW plus other ON machines — so a non-trivial figure."""
    body = admin_client.get("/api/building/energy/").json()
    if not body:
        pytest.skip("no buckets in default range")
    latest = body[-1]
    # Multiple machines summed at any business-hour bucket — well above 30 kW.
    assert latest["total_kw"] > 30.0


# ---------- Empty range returns empty list ----------------------------------


def test_energy_empty_range_returns_empty_list(admin_client):
    """Range entirely in the future relative to the seed → no rows."""
    far_future = _z(datetime(2099, 1, 1, tzinfo=timezone.utc))
    way_future = _z(datetime(2099, 1, 2, tzinfo=timezone.utc))
    response = admin_client.get(
        f"/api/building/energy/?from={far_future}&to={way_future}"
    )
    assert response.status_code == 200
    assert response.json() == []
