"""Shared pytest fixtures for the building app tests."""

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient


@pytest.fixture(scope="session")
def django_db_setup(django_db_setup, django_db_blocker):
    """Override pytest-django setup to seed once per session.

    Read endpoints all need the same shape of data — twelve machines, a few
    days of sensor readings, AI decisions, and an admin user. Seeding once
    per session amortises the ~6s cost. Per-test transactions still roll
    back any incidental writes, leaving the seed intact for the next test.
    """
    with django_db_blocker.unblock():
        from django.core.management import call_command

        call_command("seed", "--days", "7", "--clear")


@pytest.fixture
def api_client() -> APIClient:
    """Unauthenticated DRF test client."""
    return APIClient()


@pytest.fixture
def user(db):
    """A non-staff user used for auth-flow tests."""
    User = get_user_model()
    return User.objects.create_user(
        username="testuser",
        email="testuser@example.com",
        password="testpass123",
    )


@pytest.fixture
def auth_client(api_client, user) -> APIClient:
    """A client with a fresh access token bound as Bearer for `user`."""
    response = api_client.post(
        "/api/auth/token/",
        {"username": "testuser", "password": "testpass123"},
        format="json",
    )
    assert response.status_code == 200, response.content
    access = response.json()["access"]
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
    return api_client


@pytest.fixture
def admin_client(api_client, db) -> APIClient:
    """A client authenticated as the seeded `admin/admin` superuser.

    Use this for read-endpoint tests that need to hit IsAuthenticated-gated
    routes — the seeded admin already exists, so no per-test user creation.
    """
    response = api_client.post(
        "/api/auth/token/",
        {"username": "admin", "password": "admin"},
        format="json",
    )
    assert response.status_code == 200, response.content
    access = response.json()["access"]
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
    return api_client
