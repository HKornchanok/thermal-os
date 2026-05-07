"""Tests for GET /api/alerts/."""

import pytest

pytestmark = pytest.mark.django_db


# ---------- Auth gating ------------------------------------------------------


def test_alerts_requires_authentication(api_client):
    response = api_client.get("/api/alerts/")
    assert response.status_code == 401


# ---------- Response shape ---------------------------------------------------


ALERT_KEYS = {
    "severity",
    "rule",
    "machine_id",
    "machine_name",
    "message",
    "value",
    "threshold",
}


def test_alerts_returns_list(admin_client):
    response = admin_client.get("/api/alerts/")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)


def test_alerts_each_entry_has_expected_keys(admin_client):
    body = admin_client.get("/api/alerts/").json()
    for entry in body:
        assert set(entry.keys()) == ALERT_KEYS
        assert entry["severity"] in ("critical", "warning")
        assert entry["rule"] in ("power_spike", "temp_drift", "nonstop_runtime")


# ---------- Engineered seed alerts must fire --------------------------------


def _by_rule(body, rule):
    return [a for a in body if a["rule"] == rule]


def _by_machine_and_rule(body, machine_name, rule):
    matches = [a for a in body if a["machine_name"] == machine_name and a["rule"] == rule]
    return matches[0] if matches else None


def test_alerts_power_spike_fires_for_ac_l1(admin_client):
    """Seed forces AC-L1's latest power to 41.4 kW (92% of 45 kW rated)."""
    body = admin_client.get("/api/alerts/").json()
    alert = _by_machine_and_rule(body, "AC-L1", "power_spike")
    assert alert is not None
    assert alert["severity"] == "warning"
    assert alert["value"] == pytest.approx(41.4, abs=0.01)
    assert alert["threshold"] == pytest.approx(40.5, abs=0.01)  # 0.90 × 45.0
    # Message format must include name + power + percentage + rated.
    assert "AC-L1" in alert["message"]
    assert "41.4 kW" in alert["message"]


def test_alerts_temp_drift_fires_for_ac_s2(admin_client):
    """Seed forces AC-S2 latest temp 27.1°C vs setpoint 24.0°C → drift 3.1°C."""
    body = admin_client.get("/api/alerts/").json()
    alert = _by_machine_and_rule(body, "AC-S2", "temp_drift")
    assert alert is not None
    assert alert["severity"] == "warning"
    assert alert["value"] == pytest.approx(3.1, abs=0.01)
    assert alert["threshold"] == 2.0
    assert "AC-S2" in alert["message"]
    assert "27.1" in alert["message"]
    assert "24.0" in alert["message"]


def test_alerts_nonstop_runtime_fires_for_ac_l3(admin_client):
    """Seed forces AC-L3 status ON for the last 19 hours straight."""
    body = admin_client.get("/api/alerts/").json()
    alert = _by_machine_and_rule(body, "AC-L3", "nonstop_runtime")
    assert alert is not None
    assert alert["severity"] == "critical"
    assert alert["value"] >= 16  # int hours; actual value depends on prior OFF position
    assert alert["threshold"] == 16
    assert "AC-L3" in alert["message"]
    assert "consecutive hours" in alert["message"]


# ---------- Critical machines (Server Room AC, Basement Parking fan) excluded


def test_alerts_critical_machines_never_fire_nonstop_runtime(admin_client):
    """Server Room AC (AC-S5) and Basement Parking fan (FAN-01) are
    is_critical=True; they're supposed to run 24/7, so the nonstop_runtime
    rule must not flag them."""
    body = admin_client.get("/api/alerts/").json()
    nonstop = _by_rule(body, "nonstop_runtime")
    nonstop_machines = {a["machine_name"] for a in nonstop}
    assert "AC-S5" not in nonstop_machines
    assert "FAN-01" not in nonstop_machines


# ---------- Sort order: critical first, then warning, alphabetical by name --


def test_alerts_sorted_critical_first(admin_client):
    """Critical alerts must appear before warnings so the banner stack
    shows the worst issue at the top."""
    body = admin_client.get("/api/alerts/").json()
    severities = [a["severity"] for a in body]
    # Verify no warning appears before any critical.
    seen_warning = False
    for s in severities:
        if s == "warning":
            seen_warning = True
        if s == "critical":
            assert not seen_warning, "warning appeared before critical"


def test_alerts_within_severity_sorted_by_machine_name(admin_client):
    """Within a severity tier, alerts are alphabetised by machine_name
    for stable rendering between polls."""
    body = admin_client.get("/api/alerts/").json()
    by_severity: dict[str, list[str]] = {}
    for alert in body:
        by_severity.setdefault(alert["severity"], []).append(alert["machine_name"])
    for severity, names in by_severity.items():
        assert names == sorted(names), f"{severity} tier not sorted"


# ---------- All three engineered seeds together count for at least 3 -------


def test_alerts_seed_yields_at_least_three_engineered_alerts(admin_client):
    """The seed engineers exactly three alerts on the latest readings.
    Random data shouldn't add false positives in normal seed runs (the
    AI period's load factors and temp drifts stay under thresholds), so
    we should see ~3 alerts."""
    body = admin_client.get("/api/alerts/").json()
    assert len(body) >= 3
