from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class HistoryResult:
    provider: str
    provider_name: str
    price_rows: list[dict]
    action_rows: list[dict]
    currency: str | None
    coverage_note: str | None = None


@dataclass(slots=True)
class ProfileResult:
    provider: str
    provider_name: str
    info: dict
