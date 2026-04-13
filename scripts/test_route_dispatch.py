#!/usr/bin/env python3

from __future__ import annotations

import sys
from http import HTTPStatus
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import dev_server  # noqa: E402


def assert_equal(actual, expected, message):
    if actual != expected:
        raise AssertionError(f"{message}: expected {expected!r}, got {actual!r}")


def assert_true(condition, message):
    if not condition:
        raise AssertionError(message)


def test_get_route_success():
    status, payload = dev_server.dispatch_api_request("GET", "/api/yfinance/catalog")
    assert_equal(status, HTTPStatus.OK, "catalog GET should succeed")
    assert_equal(payload["provider"], "yfinance", "catalog provider")
    assert_equal(payload["datasetType"], "index", "catalog dataset type")
    assert_true(isinstance(payload.get("datasets"), list), "catalog should return dataset list")


def test_post_route_success_parses_json_body():
    original_dispatch = dev_server.server_routes.dispatch_request
    captured: dict[str, object] = {}

    def fake_dispatch(method, path, request=None):
        captured["method"] = method
        captured["path"] = path
        captured["request"] = request
        return {"ok": True}

    dev_server.server_routes.dispatch_request = fake_dispatch
    try:
        status, payload = dev_server.dispatch_api_request(
            "POST",
            "/api/yfinance/index-series",
            b'{"symbol":"AAPL","remember":true}',
        )
    finally:
        dev_server.server_routes.dispatch_request = original_dispatch

    assert_equal(status, HTTPStatus.OK, "POST dispatch should succeed")
    assert_equal(payload, {"ok": True}, "POST payload should be forwarded")
    assert_equal(captured["method"], "POST", "dispatch should receive request method")
    assert_equal(captured["path"], "/api/yfinance/index-series", "dispatch should receive route path")
    assert_equal(
        captured["request"],
        {"symbol": "AAPL", "remember": True},
        "dispatch should receive decoded JSON payload",
    )


def test_malformed_json_maps_to_bad_request():
    status, payload = dev_server.dispatch_api_request(
        "POST",
        "/api/yfinance/index-series",
        b"{bad-json",
    )
    assert_equal(status, HTTPStatus.BAD_REQUEST, "malformed JSON should return 400")
    assert_equal(
        payload,
        {"error": "Request body must be valid JSON."},
        "malformed JSON error message",
    )


def test_unknown_route_maps_to_not_found():
    status, payload = dev_server.dispatch_api_request(
        "POST",
        "/api/unknown",
        b"{}",
    )
    assert_equal(status, HTTPStatus.NOT_FOUND, "unknown routes should return 404")
    assert_equal(payload, {"error": "Unknown API endpoint."}, "unknown route error message")


def test_exception_mapping():
    original_dispatch = dev_server.server_routes.dispatch_request

    scenarios = [
        (ValueError("bad input"), HTTPStatus.BAD_REQUEST, {"error": "bad input"}),
        (RuntimeError("upstream failed"), HTTPStatus.BAD_GATEWAY, {"error": "upstream failed"}),
        (
            SystemExit(),
            HTTPStatus.SERVICE_UNAVAILABLE,
            {"error": "A required local market-data provider is unavailable."},
        ),
    ]

    try:
        for error, expected_status, expected_payload in scenarios:
            def fake_dispatch(_method, _path, _request=None, error=error):
                raise error

            dev_server.server_routes.dispatch_request = fake_dispatch
            status, payload = dev_server.dispatch_api_request(
                "POST",
                "/api/yfinance/index-series",
                b'{"symbol":"AAPL"}',
            )
            assert_equal(status, expected_status, f"{type(error).__name__} should map to the expected status")
            assert_equal(payload, expected_payload, f"{type(error).__name__} payload")
    finally:
        dev_server.server_routes.dispatch_request = original_dispatch


def main() -> int:
    test_get_route_success()
    test_post_route_success_parses_json_body()
    test_malformed_json_maps_to_bad_request()
    test_unknown_route_maps_to_not_found()
    test_exception_mapping()
    print("ok route dispatch")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
