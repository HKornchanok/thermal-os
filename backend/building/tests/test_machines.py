"""Tests for GET /api/machines/."""

import pytest

pytestmark = pytest.mark.django_db


# ---------- Auth gating ------------------------------------------------------


def test_machines_list_requires_authentication(api_client):
    response = api_client.get("/api/machines/")
    assert response.status_code == 401


# ---------- Happy path -------------------------------------------------------


def test_machines_list_returns_twelve_machines(admin_client):
    response = admin_client.get("/api/machines/")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    assert len(body) == 12


def test_machines_list_each_entry_has_expected_keys(admin_client):
    response = admin_client.get("/api/machines/")
    body = response.json()
    expected_machine_keys = {
        "id",
        "name",
        "machine_type",
        "zone",
        "rated_power_kw",
        "is_critical",
        "latest_reading",
    }
    expected_reading_keys = {
        "machine_id",
        "recorded_at",
        "power_kw",
        "temperature",
        "setpoint",
        "speed_pct",
        "status",
    }
    for entry in body:
        assert set(entry.keys()) == expected_machine_keys
        # Seeded data always has at least one reading per machine.
        assert entry["latest_reading"] is not None
        assert set(entry["latest_reading"].keys()) == expected_reading_keys


def test_machines_list_returns_results_in_id_order(admin_client):
    body = admin_client.get("/api/machines/").json()
    ids = [m["id"] for m in body]
    assert ids == sorted(ids)


def test_machines_list_includes_seed_names(admin_client):
    """The seed fixture defines specific machine names; surface them all."""
    body = admin_client.get("/api/machines/").json()
    names = {m["name"] for m in body}
    expected = {
        "AC-L1", "AC-L2", "AC-L3",
        "AC-S1", "AC-S2", "AC-S3", "AC-S4", "AC-S5",
        "FAN-01", "FAN-02", "FAN-03", "FAN-04",
    }
    assert names == expected


# ---------- Reading shape ----------------------------------------------------


def test_fans_have_no_temperature_or_setpoint_in_latest_reading(admin_client):
    body = admin_client.get("/api/machines/").json()
    for entry in body:
        if entry["machine_type"] == "fan":
            r = entry["latest_reading"]
            assert r["temperature"] is None
            assert r["setpoint"] is None


def test_acs_have_no_speed_pct_in_latest_reading(admin_client):
    body = admin_client.get("/api/machines/").json()
    for entry in body:
        if entry["machine_type"] in ("large_ac", "small_ac"):
            assert entry["latest_reading"]["speed_pct"] is None


# ---------- Engineered alert seeds (asserts reproducibility of seed) ---------


def _by_name(body, name):
    return next(m for m in body if m["name"] == name)


def test_seed_engineered_power_spike_visible_on_ac_l1(admin_client):
    """AC-L1 latest reading should be ~92% of 45 kW rated → 41.4 kW (status ON)."""
    body = admin_client.get("/api/machines/").json()
    ac_l1 = _by_name(body, "AC-L1")
    assert ac_l1["latest_reading"]["status"] == "ON"
    assert ac_l1["latest_reading"]["power_kw"] == pytest.approx(41.4, abs=0.01)


def test_seed_engineered_temp_drift_visible_on_ac_s2(admin_client):
    """AC-S2 latest reading should be temp 27.1°C vs setpoint 24.0°C."""
    body = admin_client.get("/api/machines/").json()
    ac_s2 = _by_name(body, "AC-S2")
    assert ac_s2["latest_reading"]["temperature"] == pytest.approx(27.1, abs=0.01)
    assert ac_s2["latest_reading"]["setpoint"] == pytest.approx(24.0, abs=0.01)


def test_seed_engineered_nonstop_runtime_visible_on_ac_l3(admin_client):
    """AC-L3 latest reading is ON (latest of a 19-hour nonstop window)."""
    body = admin_client.get("/api/machines/").json()
    ac_l3 = _by_name(body, "AC-L3")
    assert ac_l3["latest_reading"]["status"] == "ON"


# ---------- Performance -- single index walk, no N+1 ------------------------


def test_machines_list_single_query_for_latest_reading(admin_client, django_assert_max_num_queries):
    """List view + LATERAL JOIN must not produce N+1 queries.

    The endpoint pulls the registry and the latest reading in a single SQL
    statement. Accept a small budget (<=3) for any auth/cache lookups DRF
    might do — the constraint is that it does NOT scale with the number of
    machines.
    """
    with django_assert_max_num_queries(3):
        response = admin_client.get("/api/machines/")
        assert response.status_code == 200
