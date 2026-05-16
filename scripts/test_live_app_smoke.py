#!/usr/bin/env python3

from __future__ import annotations

import json
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
READY_TIMEOUT_SECONDS = 20


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def request_text(base_url: str, path: str, *, method: str = "GET", body: dict | None = None) -> str:
    data = None
    headers: dict[str, str] = {}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["content-type"] = "application/json"

    request = urllib.request.Request(
        f"{base_url}{path}",
        data=data,
        headers=headers,
        method=method,
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        assert_true(
            200 <= response.status < 300,
            f"{method} {path} returned HTTP {response.status}",
        )
        return response.read().decode("utf-8")


def request_json(base_url: str, path: str, *, method: str = "GET", body: dict | None = None) -> dict:
    payload = json.loads(request_text(base_url, path, method=method, body=body))
    assert_true(isinstance(payload, dict), f"{method} {path} returned a non-object JSON payload")
    return payload


def wait_for_server(base_url: str, process: subprocess.Popen[str]) -> None:
    deadline = time.monotonic() + READY_TIMEOUT_SECONDS
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            stdout, stderr = process.communicate(timeout=1)
            raise RuntimeError(
                "dev_server.py exited before becoming ready.\n"
                f"stdout:\n{stdout}\n"
                f"stderr:\n{stderr}"
            )
        try:
            request_text(base_url, "/")
            return
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            last_error = error
            time.sleep(0.2)
    raise TimeoutError(f"dev_server.py did not become ready: {last_error}")


def run_smoke(base_url: str) -> None:
    index_html = request_text(base_url, "/")
    assert_true("app/main.js" in index_html, "index should load the app entrypoint")

    main_js = request_text(base_url, "/app/main.js")
    assert_true("parseAppRouteHash" in main_js, "main.js should use the app route parser")

    app_route_js = request_text(base_url, "/app/appRoute.js")
    assert_true('"history"' in app_route_js, "settings history route should be a first-class app route")
    assert_true("DEFAULT_SETTINGS_SECTION" in app_route_js, "settings route defaults should be explicit")

    automations = request_json(base_url, "/api/automations")
    assert_true(isinstance(automations.get("automations"), list), "automations API should return a list")
    assert_true(isinstance(automations.get("catalogs"), dict), "automations API should return catalogs")

    runtime_health = request_json(base_url, "/api/system/runtime-health")
    assert_true(isinstance(runtime_health.get("summary"), dict), "runtime-health API should return a summary")

    study_runs = request_json(base_url, "/api/study-runs?limit=5")
    assert_true(isinstance(study_runs.get("runs"), list), "study-runs API should return a runs list")

    readiness = request_json(base_url, "/api/assistant/readiness?artifactChecks=false")
    assert_true(readiness.get("version") == "assistant-readiness-v1", "assistant readiness version mismatch")
    assert_true(isinstance(readiness.get("summary"), dict), "assistant readiness should return a summary")

    builder_plan = request_json(
        base_url,
        "/api/study-builder/plan",
        method="POST",
        body={"intent": "Compare Nifty 50 against Sensex from 2021 to 2024"},
    )
    assert_true(
        builder_plan.get("version") == "study-builder-plan-response-v1",
        "study-builder plan version mismatch",
    )
    assert_true(
        builder_plan.get("plan", {}).get("studyId") == "risk-adjusted-return",
        "study-builder should map the smoke intent to risk-adjusted-return",
    )
    assert_true(
        str(builder_plan.get("preview", {}).get("routeHash", "")).startswith(
            "#risk-adjusted-return/relative"
        ),
        "study-builder should return a relative-study route preview",
    )

    study_proposal = request_json(
        base_url,
        "/api/study-factory/proposal",
        method="POST",
        body={"idea": "Can RBI policy headlines move bank index volatility?"},
    )
    assert_true(
        study_proposal.get("version") == "study-proposal-response-v1",
        "study proposal version mismatch",
    )
    execution = study_proposal.get("execution", {})
    assert_true(execution.get("executed") is False, "study proposal must not execute a study")
    assert_true(execution.get("generatedCode") is False, "study proposal must not generate code")
    assert_true(
        execution.get("fetchedExternalData") is False,
        "study proposal must not fetch external data",
    )
    assert_true(
        "news" in study_proposal.get("proposal", {}).get("missingToolKinds", []),
        "news/event proposal should report the missing news tool contract",
    )


def main() -> int:
    port = find_free_port()
    base_url = f"http://127.0.0.1:{port}"
    process = subprocess.Popen(
        [sys.executable, str(SCRIPT_DIR / "dev_server.py"), "--port", str(port)],
        cwd=str(REPO_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        wait_for_server(base_url, process)
        run_smoke(base_url)
    finally:
        process.terminate()
        try:
            process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate(timeout=5)
    print("ok live app smoke")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
