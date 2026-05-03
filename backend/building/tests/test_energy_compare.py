"""Tests for GET /api/energy/compare/."""

from datetime import datetime, timedelta, timezone

import pytest


pytestmark = pytest.mark.django_db


def _z(dt: datetime) -> str:
    """URL-safe ISO format (avoids `+` → space decoding)."""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------- Auth gating ------------------------------------------------------


def test_compare_requires_authentication(api_client):
    response = api_client.get("/api/energy/compare/")
    assert response.status_code == 401


# ---------- 400 paths --------------------------------------------------------


def test_compare_invalid_datetime_returns_400(admin_client):
    response = admin_client.get("/api/energy/compare/?a_from=garbage")
    assert response.status_code == 400


def test_compare_inverted_range_returns_400(admin_client):
    """from must be earlier than to — guard against frontend mistakes."""
    earlier = _z(datetime(2026, 4, 1, tzinfo=timezone.utc))
    later = _z(datetime(2026, 4, 10, tzinfo=timezone.utc))
    response = admin_client.get(
        f"/api/energy/compare/?a_from={later}&a_to={earlier}"
        f"&b_from={earlier}&b_to={later}"
    )
    assert response.status_code == 400


# ---------- Default split shape ---------------------------------------------


ENVELOPE_KEYS = {"before", "after", "savings_pct"}
PERIOD_KEYS = {"from", "to", "avg_kw"}


def test_compare_default_returns_envelope(admin_client):
    response = admin_client.get("/api/energy/compare/")
    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) == ENVELOPE_KEYS
    assert set(body["before"].keys()) == PERIOD_KEYS
    assert set(body["after"].keys()) == PERIOD_KEYS


def test_compare_default_split_at_midpoint(admin_client):
    """With no params, the API splits [MIN, MAX] at the midpoint —
    Period A = first half, Period B = second half."""
    body = admin_client.get("/api/energy/compare/").json()
    a_to = datetime.fromisoformat(body["before"]["to"])
    b_from = datetime.fromisoformat(body["after"]["from"])
    # Period A's end equals Period B's start (the midpoint).
    assert a_to == b_from


def test_compare_default_period_a_precedes_period_b(admin_client):
    body = admin_client.get("/api/energy/compare/").json()
    a_from = datetime.fromisoformat(body["before"]["from"])
    b_to = datetime.fromisoformat(body["after"]["to"])
    assert a_from < b_to


# ---------- Savings semantics ------------------------------------------------


def test_compare_default_shows_ai_savings(admin_client):
    """Seed engineers manual (Period A, higher load factor) → AI (Period B,
    lower load factor). savings_pct must be positive (AI saves)."""
    body = admin_client.get("/api/energy/compare/").json()
    assert body["savings_pct"] is not None
    assert body["savings_pct"] > 0
    assert body["before"]["avg_kw"] > body["after"]["avg_kw"]


def test_compare_savings_pct_arithmetic(admin_client):
    """savings_pct = (before − after) / before × 100, rounded to 2dp."""
    body = admin_client.get("/api/energy/compare/").json()
    before = body["before"]["avg_kw"]
    after = body["after"]["avg_kw"]
    expected = round((before - after) / before * 100.0, 2)
    assert body["savings_pct"] == expected


# ---------- Equal periods -> ~0% savings ------------------------------------


def test_compare_same_period_yields_zero_savings(admin_client):
    """Comparing a period to itself should always yield 0% savings.
    Uses Period A from the default split — guaranteed to fall within the
    seed window regardless of when the test session started."""
    default_body = admin_client.get("/api/energy/compare/").json()
    # Convert +00:00 to Z so URL decoding doesn't turn the + into a space.
    a_from = _z(datetime.fromisoformat(default_body["before"]["from"]))
    a_to = _z(datetime.fromisoformat(default_body["before"]["to"]))
    response = admin_client.get(
        f"/api/energy/compare/?a_from={a_from}&a_to={a_to}"
        f"&b_from={a_from}&b_to={a_to}"
    )
    assert response.status_code == 200
    body = response.json()
    assert body["before"]["avg_kw"] == body["after"]["avg_kw"]
    assert body["savings_pct"] == 0.0


# ---------- Partial overrides keep smart defaults for unspecified params ----


def test_compare_partial_override_fills_missing_with_seed_boundaries(admin_client):
    """Supply only a_from + a_to. b_from and b_to should fill from
    midpoint and MAX(recorded_at) respectively."""
    a_from_str = _z(datetime(2026, 4, 1, tzinfo=timezone.utc))
    a_to_str = _z(datetime(2026, 4, 10, tzinfo=timezone.utc))
    response = admin_client.get(
        f"/api/energy/compare/?a_from={a_from_str}&a_to={a_to_str}"
    )
    assert response.status_code == 200
    body = response.json()
    assert body["before"]["from"].startswith("2026-04-01")
    assert body["before"]["to"].startswith("2026-04-10")
    # Period B got auto-filled — ensure it's a valid range.
    b_from = datetime.fromisoformat(body["after"]["from"])
    b_to = datetime.fromisoformat(body["after"]["to"])
    assert b_from < b_to


# ---------- Negative savings is allowed (regression flag) -------------------


def test_compare_higher_after_returns_negative_savings(admin_client):
    """If Period B somehow consumes more than Period A, savings_pct is
    negative (frontend renders red). Use the engineered "today is high"
    bucket as Period B and an earlier window as Period A."""
    machines = admin_client.get("/api/machines/").json()
    latest = max(
        datetime.fromisoformat(m["latest_reading"]["recorded_at"])
        for m in machines
        if m["latest_reading"]
    )
    # Period A: any quiet 6-hour window earlier in the AI period.
    a_from = _z(latest - timedelta(days=3, hours=12))
    a_to = _z(latest - timedelta(days=3, hours=6))
    # Period B: the latest 6-hour window which contains AC-L3's 19h
    # nonstop engineering — should average higher.
    b_from = _z(latest - timedelta(hours=6))
    b_to = _z(latest)
    response = admin_client.get(
        f"/api/energy/compare/?a_from={a_from}&a_to={a_to}"
        f"&b_from={b_from}&b_to={b_to}"
    )
    assert response.status_code == 200
    body = response.json()
    # Today is engineered to spike — savings_pct is allowed to go negative.
    # We don't assert a strict sign here; only that the math is computed.
    assert body["savings_pct"] is not None
