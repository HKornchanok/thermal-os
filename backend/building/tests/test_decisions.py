"""Tests for GET /api/decisions/."""

from math import ceil

import pytest


pytestmark = pytest.mark.django_db


# ---------- Auth gating ------------------------------------------------------


def test_decisions_requires_authentication(api_client):
    response = api_client.get("/api/decisions/")
    assert response.status_code == 401


# ---------- 400 paths --------------------------------------------------------


def test_decisions_invalid_action_returns_400(admin_client):
    response = admin_client.get("/api/decisions/?action=delete_everything")
    assert response.status_code == 400
    assert "Invalid action" in response.json()["detail"]


def test_decisions_invalid_datetime_returns_400(admin_client):
    response = admin_client.get("/api/decisions/?from=garbage")
    assert response.status_code == 400


@pytest.mark.parametrize("page", ["abc", "-1", "0"])
def test_decisions_invalid_page_returns_400(admin_client, page):
    response = admin_client.get(f"/api/decisions/?page={page}")
    assert response.status_code == 400


@pytest.mark.parametrize("page_size", ["0", "101", "abc"])
def test_decisions_invalid_page_size_returns_400(admin_client, page_size):
    response = admin_client.get(f"/api/decisions/?page_size={page_size}")
    assert response.status_code == 400


# ---------- Envelope shape ---------------------------------------------------


ENVELOPE_KEYS = {"count", "page", "page_size", "total_pages", "results"}
RESULT_KEYS = {
    "id",
    "decided_at",
    "machine",
    "machine_name",
    "action_type",
    "value",
    "reason",
}


def test_decisions_returns_paginated_envelope(admin_client):
    response = admin_client.get("/api/decisions/")
    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) == ENVELOPE_KEYS
    assert isinstance(body["results"], list)


def test_decisions_each_result_has_expected_keys(admin_client):
    body = admin_client.get("/api/decisions/").json()
    for entry in body["results"]:
        assert set(entry.keys()) == RESULT_KEYS


def test_decisions_results_are_chronological_descending(admin_client):
    body = admin_client.get("/api/decisions/").json()
    timestamps = [r["decided_at"] for r in body["results"]]
    assert timestamps == sorted(timestamps, reverse=True)


# ---------- Pagination math --------------------------------------------------


def test_decisions_default_page_size_is_20(admin_client):
    body = admin_client.get("/api/decisions/").json()
    assert body["page_size"] == 20
    # Results length == min(page_size, count) on the first page
    assert len(body["results"]) == min(20, body["count"])


def test_decisions_total_pages_matches_ceil(admin_client):
    body = admin_client.get("/api/decisions/").json()
    expected = ceil(body["count"] / body["page_size"]) if body["count"] else 0
    assert body["total_pages"] == expected


def test_decisions_pagination_returns_distinct_pages(admin_client):
    """Page 1 and page 2 should contain different rows (assuming count > 20)."""
    p1 = admin_client.get("/api/decisions/?page=1").json()
    if p1["total_pages"] < 2:
        pytest.skip("not enough rows for two pages")
    p2 = admin_client.get("/api/decisions/?page=2").json()
    p1_ids = {r["id"] for r in p1["results"]}
    p2_ids = {r["id"] for r in p2["results"]}
    assert p1_ids.isdisjoint(p2_ids)


def test_decisions_page_size_50_returns_more_results(admin_client):
    p1 = admin_client.get("/api/decisions/?page_size=10").json()
    p2 = admin_client.get("/api/decisions/?page_size=50").json()
    if p1["count"] < 11:
        pytest.skip("not enough rows to differentiate page sizes")
    assert len(p2["results"]) >= len(p1["results"])


def test_decisions_page_beyond_total_returns_empty_results(admin_client):
    body = admin_client.get("/api/decisions/?page=99999").json()
    assert body["results"] == []
    # Count is unchanged regardless of page bounds.
    assert body["count"] >= 0


# ---------- Action filter ----------------------------------------------------


@pytest.mark.parametrize("action", ["turn_on", "turn_off", "set_temp"])
def test_decisions_action_filter_returns_only_matching_rows(admin_client, action):
    body = admin_client.get(f"/api/decisions/?action={action}").json()
    for entry in body["results"]:
        assert entry["action_type"] == action


def test_decisions_action_filter_changes_count(admin_client):
    """Sum of per-action counts == total count (each decision has one action)."""
    total = admin_client.get("/api/decisions/?page_size=1").json()["count"]
    by_action = sum(
        admin_client.get(f"/api/decisions/?action={a}&page_size=1").json()["count"]
        for a in ("turn_on", "turn_off", "set_temp")
    )
    assert total == by_action


def test_decisions_action_filter_accepts_comma_separated_list(admin_client):
    """Multi-action filter via comma-separated list returns rows matching ANY
    of the supplied actions."""
    body = admin_client.get(
        "/api/decisions/?action=turn_on,set_temp&page_size=100"
    ).json()
    assert body["count"] > 0
    seen = {entry["action_type"] for entry in body["results"]}
    assert seen.issubset({"turn_on", "set_temp"})


def test_decisions_action_filter_multi_count_equals_sum_of_singles(admin_client):
    """count for ?action=A,B should equal count(A) + count(B)."""
    a = admin_client.get("/api/decisions/?action=turn_on&page_size=1").json()["count"]
    b = admin_client.get("/api/decisions/?action=set_temp&page_size=1").json()["count"]
    ab = admin_client.get(
        "/api/decisions/?action=turn_on,set_temp&page_size=1"
    ).json()["count"]
    assert ab == a + b


def test_decisions_action_filter_rejects_unknown_in_list(admin_client):
    """Even one bad token in the comma-separated list returns 400."""
    response = admin_client.get(
        "/api/decisions/?action=turn_on,delete_everything"
    )
    assert response.status_code == 400


# ---------- Decision content -------------------------------------------------


def test_decisions_set_temp_carries_value_other_actions_null(admin_client):
    """set_temp records the new setpoint in `value`; turn_on/turn_off
    leave it null (no numeric payload)."""
    body = admin_client.get("/api/decisions/?page_size=100").json()
    for entry in body["results"]:
        if entry["action_type"] == "set_temp":
            assert entry["value"] is not None
        else:
            assert entry["value"] is None


def test_decisions_machine_name_is_populated_for_existing_machines(admin_client):
    """LEFT JOIN to building_machine — every seeded decision references a
    real machine, so machine_name should be a non-empty string."""
    body = admin_client.get("/api/decisions/").json()
    for entry in body["results"]:
        assert entry["machine"] is not None
        assert isinstance(entry["machine_name"], str)
        assert entry["machine_name"]


def test_decisions_reason_is_non_empty(admin_client):
    body = admin_client.get("/api/decisions/?page_size=50").json()
    for entry in body["results"]:
        assert isinstance(entry["reason"], str)
        assert len(entry["reason"]) > 0
