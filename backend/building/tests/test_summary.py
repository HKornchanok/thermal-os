"""Tests for GET /api/building/summary/."""

import pytest

pytestmark = pytest.mark.django_db


# ---------- Auth gating ------------------------------------------------------


def test_summary_requires_authentication(api_client):
    response = api_client.get("/api/building/summary/")
    assert response.status_code == 401


# ---------- Response shape ---------------------------------------------------


EXPECTED_KEYS = {
    "total_machines",
    "active_machines",
    "inactive_machines",
    "total_power_kw",
    "today_kwh",
    "yesterday_kwh",
    "trend_pct",
    "avg_temperature",
}


def test_summary_returns_all_eight_keys(admin_client):
    response = admin_client.get("/api/building/summary/")
    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) == EXPECTED_KEYS


def test_summary_machine_counts_are_internally_consistent(admin_client):
    body = admin_client.get("/api/building/summary/").json()
    assert body["total_machines"] == 12
    assert body["active_machines"] + body["inactive_machines"] == body["total_machines"]
    assert 0 <= body["active_machines"] <= body["total_machines"]
    assert 0 <= body["inactive_machines"] <= body["total_machines"]


def test_summary_power_and_energy_are_non_negative(admin_client):
    body = admin_client.get("/api/building/summary/").json()
    assert body["total_power_kw"] >= 0
    assert body["today_kwh"] >= 0
    if body["yesterday_kwh"] is not None:
        assert body["yesterday_kwh"] >= 0


def test_summary_avg_temperature_is_in_plausible_range(admin_client):
    """Building ACs run somewhere between 18°C (over-cool) and 30°C (overrun)."""
    body = admin_client.get("/api/building/summary/").json()
    if body["avg_temperature"] is not None:
        assert 18.0 <= body["avg_temperature"] <= 30.0


# ---------- Trend semantics --------------------------------------------------


def test_summary_trend_pct_sign_matches_today_vs_yesterday(admin_client):
    """Trend is (today - yesterday) / yesterday × 100. Verify sign agrees."""
    body = admin_client.get("/api/building/summary/").json()
    if body["yesterday_kwh"] is None or body["yesterday_kwh"] == 0:
        assert body["trend_pct"] is None
        return
    delta = body["today_kwh"] - body["yesterday_kwh"]
    if delta > 0:
        assert body["trend_pct"] > 0
    elif delta < 0:
        assert body["trend_pct"] < 0
    else:
        assert body["trend_pct"] == 0


# ---------- Engineered alert seed reflected in totals ------------------------


def test_summary_total_power_includes_ac_l1_engineered_spike(admin_client):
    """AC-L1's latest reading is forced to 41.4 kW (status ON) by the seed.
    The total power KPI must include it — i.e. be at least 41.4."""
    body = admin_client.get("/api/building/summary/").json()
    assert body["total_power_kw"] >= 41.4


# ---------- Active machine count must include critical 24/7 machines ---------


def test_summary_active_count_includes_critical_machines(admin_client):
    """Server Room AC and Basement Parking fan are critical → always ON →
    the active count is at least 2 regardless of business hours."""
    body = admin_client.get("/api/building/summary/").json()
    assert body["active_machines"] >= 2


# ---------- Reference time semantics ----------------------------------------


def test_summary_reference_time_is_max_recorded_at_not_now(admin_client):
    """If the seed is set into the future (or rolled back from now), today's
    kWh must reflect the day of max(recorded_at), not the wall clock.

    Verified indirectly: today_kwh > 0 even though wall-clock 'today' may
    not have any seeded data.
    """
    body = admin_client.get("/api/building/summary/").json()
    assert body["today_kwh"] > 0


# ---------- Single-snapshot consistency -------------------------------------


def test_summary_query_count_is_bounded(admin_client, django_assert_max_num_queries):
    """The endpoint runs four DB calls (latest snapshot, machine count,
    today kWh, yesterday kWh) plus auth. No N+1 by machine or by reading.
    """
    with django_assert_max_num_queries(8):
        response = admin_client.get("/api/building/summary/")
        assert response.status_code == 200
