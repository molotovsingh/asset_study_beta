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


class ProviderRequestError(RuntimeError):
    def __init__(
        self,
        *,
        provider: str,
        provider_name: str,
        operation: str,
        status_code: int | None = None,
        reason: str | None = None,
        retryable: bool = False,
    ):
        self.provider = provider
        self.provider_name = provider_name
        self.operation = operation
        self.status_code = status_code
        self.reason = reason
        self.retryable = retryable

        details = f"{provider_name} {operation} request failed"
        if status_code is not None:
            details = f"{details} with HTTP {status_code}"
        if reason:
            details = f"{details}: {reason}"
        super().__init__(details)
