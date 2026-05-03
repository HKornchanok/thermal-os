"""Shared pytest fixtures for the building app tests."""

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient


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
