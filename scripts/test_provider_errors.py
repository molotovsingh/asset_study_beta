#!/usr/bin/env python3

from __future__ import annotations

import os
import sys
import urllib.error
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from providers import finnhub, yahoo_finance15  # noqa: E402
from providers.base import ProviderRequestError  # noqa: E402


def assert_equal(actual, expected, message):
    if actual != expected:
        raise AssertionError(f"{message}: expected {expected!r}, got {actual!r}")


def assert_true(condition, message):
    if not condition:
        raise AssertionError(message)


def test_finnhub_http_errors_are_typed_and_sanitized():
    original_key = os.environ.get("FINNHUB_API_KEY")
    original_urlopen = finnhub.urllib.request.urlopen
    os.environ["FINNHUB_API_KEY"] = "SECRET_TOKEN_FOR_TEST"

    def fake_urlopen(_request, timeout):
        del timeout
        raise urllib.error.HTTPError(
            "https://finnhub.io/api/v1/search?token=SECRET_TOKEN_FOR_TEST",
            429,
            "Too Many Requests",
            {},
            None,
        )

    finnhub.urllib.request.urlopen = fake_urlopen
    try:
        try:
            finnhub._request_json("/search", q="AAPL")
        except ProviderRequestError as error:
            assert_equal(error.provider, "finnhub", "provider id should be exposed")
            assert_equal(error.status_code, 429, "HTTP status should be retained")
            assert_equal(error.retryable, True, "rate limits should be retryable")
            assert_true("SECRET_TOKEN_FOR_TEST" not in str(error), "provider errors must not leak API tokens")
            assert_true("token=" not in str(error), "provider errors must not leak request URLs")
        else:
            raise AssertionError("Finnhub HTTP failures should raise ProviderRequestError")
    finally:
        finnhub.urllib.request.urlopen = original_urlopen
        if original_key is None:
            os.environ.pop("FINNHUB_API_KEY", None)
        else:
            os.environ["FINNHUB_API_KEY"] = original_key


def test_yahoo_finance15_network_errors_are_retryable():
    original_key = os.environ.get("YAHOO_FINANCE15_RAPIDAPI_KEY")
    original_urlopen = yahoo_finance15.urllib.request.urlopen
    os.environ["YAHOO_FINANCE15_RAPIDAPI_KEY"] = "SECRET_TOKEN_FOR_TEST"

    def fake_urlopen(_request, timeout):
        del timeout
        raise urllib.error.URLError("timed out")

    yahoo_finance15.urllib.request.urlopen = fake_urlopen
    try:
        try:
            yahoo_finance15._request_json("/api/yahoo/qu/quote/AAPL")
        except ProviderRequestError as error:
            assert_equal(error.provider, "yahoo_finance15", "provider id should be exposed")
            assert_equal(error.status_code, None, "network errors should not fake an HTTP status")
            assert_equal(error.retryable, True, "network errors should be retryable")
            assert_true("SECRET_TOKEN_FOR_TEST" not in str(error), "provider errors must not leak API tokens")
        else:
            raise AssertionError("Yahoo Finance 15 network failures should raise ProviderRequestError")
    finally:
        yahoo_finance15.urllib.request.urlopen = original_urlopen
        if original_key is None:
            os.environ.pop("YAHOO_FINANCE15_RAPIDAPI_KEY", None)
        else:
            os.environ["YAHOO_FINANCE15_RAPIDAPI_KEY"] = original_key


def main() -> int:
    test_finnhub_http_errors_are_typed_and_sanitized()
    test_yahoo_finance15_network_errors_are_retryable()
    print("ok provider errors")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

