"""Shared helpers for the building app's read endpoints."""

from __future__ import annotations


def dictfetchall(cursor) -> list[dict]:
    """Return all rows from a cursor as a list of dicts keyed by column name."""
    columns = [c[0] for c in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]
