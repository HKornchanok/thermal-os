"""SimpleJWT auth flow tests.

Covers DESIGN.md §1B authentication endpoints:
    POST /api/auth/token/         — obtain access + refresh
    POST /api/auth/token/refresh/ — exchange refresh for new access
"""

import pytest
from django.urls import reverse
from rest_framework_simplejwt.tokens import AccessToken

pytestmark = pytest.mark.django_db


# ---------- POST /api/auth/token/ ---------------------------------------------


def test_token_obtain_with_valid_credentials_returns_access_and_refresh(api_client, user):
    response = api_client.post(
        "/api/auth/token/",
        {"username": "testuser", "password": "testpass123"},
        format="json",
    )

    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) == {"access", "refresh"}
    assert isinstance(body["access"], str) and body["access"].count(".") == 2
    assert isinstance(body["refresh"], str) and body["refresh"].count(".") == 2


def test_token_obtain_with_wrong_password_returns_401(api_client, user):
    response = api_client.post(
        "/api/auth/token/",
        {"username": "testuser", "password": "wrong-password"},
        format="json",
    )
    assert response.status_code == 401


def test_token_obtain_with_unknown_user_returns_401(api_client):
    response = api_client.post(
        "/api/auth/token/",
        {"username": "nobody", "password": "anything"},
        format="json",
    )
    assert response.status_code == 401


def test_token_obtain_with_missing_password_returns_400(api_client, user):
    response = api_client.post(
        "/api/auth/token/",
        {"username": "testuser"},
        format="json",
    )
    # Missing required field is a validation error, not an auth failure.
    assert response.status_code == 400


# ---------- POST /api/auth/token/refresh/ -------------------------------------


def test_token_refresh_returns_new_access_token(api_client, user):
    obtain = api_client.post(
        "/api/auth/token/",
        {"username": "testuser", "password": "testpass123"},
        format="json",
    )
    refresh_token = obtain.json()["refresh"]

    response = api_client.post(
        "/api/auth/token/refresh/",
        {"refresh": refresh_token},
        format="json",
    )
    assert response.status_code == 200
    body = response.json()
    assert "access" in body
    assert body["access"].count(".") == 2


def test_token_refresh_with_garbage_returns_401(api_client):
    response = api_client.post(
        "/api/auth/token/refresh/",
        {"refresh": "this.is.not.a.real.jwt"},
        format="json",
    )
    assert response.status_code == 401


def test_token_refresh_with_missing_token_returns_400(api_client):
    response = api_client.post(
        "/api/auth/token/refresh/",
        {},
        format="json",
    )
    assert response.status_code == 400


# ---------- Token contents ----------------------------------------------------


def test_access_token_carries_user_id_claim(api_client, user):
    response = api_client.post(
        "/api/auth/token/",
        {"username": "testuser", "password": "testpass123"},
        format="json",
    )
    access = AccessToken(response.json()["access"])
    # SimpleJWT serialises the user_id claim as a string in newer versions —
    # cast both sides to compare value, not representation.
    assert int(access["user_id"]) == user.id


# ---------- URL reverse sanity (catch routing regressions) --------------------


def test_token_endpoint_routes_are_reachable_by_name():
    assert reverse("token_obtain_pair") == "/api/auth/token/"
    assert reverse("token_refresh") == "/api/auth/token/refresh/"
