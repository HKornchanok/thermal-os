"""Tests for GET /api/building/energy/by-zone/."""

from datetime import datetime, timezone

import pytest


pytestmark = pytest.mark.django_db


# ---------- Auth gating ------------------------------------------------------


def test_by_zone_requires_authentication(api_client):
    response = api_client.get("/api/building/energy/by-zone/")
    assert response.status_code == 401


# ---------- 400 paths --------------------------------------------------------


def test_by_zone_invalid_bucket_returns_400(admin_client):
    response = admin_client.get("/api/building/energy/by-zone/?bucket=42min")
    assert response.status_code == 400


def test_by_zone_5min_bucket_rejected(admin_client):
    response = admin_client.get("/api/building/energy/by-zone/?bucket=5min")
    assert response.status_code == 400


def test_by_zone_invalid_datetime_returns_400(admin_client):
    response = admin_client.get("/api/building/energy/by-zone/?from=garbage")
    assert response.status_code == 400


# ---------- Pivoted shape ----------------------------------------------------


SEEDED_ZONES = {
    "Zone A (Lobby & Ground)",
    "Zone B (Floors 1-3)",
    "Zone C (Floors 4-6)",
    "Floor 1 Office",
    "Floor 2 Office",
    "Floor 3 Meeting Rooms",
    "Floor 5 Executive",
    "Server Room (24/7)",
    "Basement Parking",
    "Ground Floor",
    "Floors 1-3",
    "Floors 4-6",
}


def test_by_zone_returns_pivoted_list(admin_client):
    response = admin_client.get("/api/building/energy/by-zone/")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    assert len(body) > 0


def test_by_zone_every_entry_has_bucket_plus_all_twelve_zones(admin_client):
    """Each pivot entry must carry the same shape: `bucket` + every zone
    present in the registry. Stable shape keeps Recharts series IDs stable
    across the time axis."""
    body = admin_client.get("/api/building/energy/by-zone/").json()
    for entry in body:
        keys = set(entry.keys())
        assert "bucket" in keys
        zone_keys = keys - {"bucket"}
        assert zone_keys == SEEDED_ZONES


def test_by_zone_all_zone_values_are_numeric(admin_client):
    body = admin_client.get("/api/building/energy/by-zone/").json()
    for entry in body:
        for k, v in entry.items():
            if k == "bucket":
                continue
            assert isinstance(v, (int, float))
            assert v >= 0


def test_by_zone_buckets_are_chronological(admin_client):
    body = admin_client.get("/api/building/energy/by-zone/").json()
    buckets = [e["bucket"] for e in body]
    assert buckets == sorted(buckets)


# ---------- Sums match the un-pivoted total endpoint -----------------------


def test_by_zone_sum_per_bucket_equals_total_endpoint(admin_client):
    """For each bucket, the per-zone values must sum to the total_kw the
    /api/building/energy/ endpoint reports for the same bucket. Anything
    else means we're losing or double-counting power."""
    by_zone = admin_client.get("/api/building/energy/by-zone/").json()
    total = admin_client.get("/api/building/energy/").json()

    total_by_bucket = {e["bucket"]: e["total_kw"] for e in total}

    for entry in by_zone:
        bucket = entry["bucket"]
        zone_sum = sum(v for k, v in entry.items() if k != "bucket")
        # Allow tiny float rounding discrepancy from the per-zone .round(2).
        assert zone_sum == pytest.approx(total_by_bucket[bucket], abs=0.5)


# ---------- Critical machines are always present in their zones ------------


def test_by_zone_server_room_zone_is_always_above_zero(admin_client):
    """The Server Room (24/7) AC is critical → always ON. Its zone must
    therefore have a non-zero value in every bucket."""
    body = admin_client.get("/api/building/energy/by-zone/").json()
    if not body:
        pytest.skip("no buckets in default range")
    server_room_values = [e["Server Room (24/7)"] for e in body]
    assert all(v > 0 for v in server_room_values)


# ---------- Bucket parametrisation -----------------------------------------


def test_by_zone_15min_returns_more_entries_than_1h(admin_client):
    fifteen = admin_client.get("/api/building/energy/by-zone/?bucket=15min").json()
    one = admin_client.get("/api/building/energy/by-zone/?bucket=1h").json()
    assert len(fifteen) > len(one)


# ---------- Empty range -----------------------------------------------------


def test_by_zone_empty_range_returns_empty_list(admin_client):
    far_future_from = "2099-01-01T00:00:00Z"
    far_future_to = "2099-01-02T00:00:00Z"
    response = admin_client.get(
        f"/api/building/energy/by-zone/?from={far_future_from}&to={far_future_to}"
    )
    assert response.status_code == 200
    assert response.json() == []
