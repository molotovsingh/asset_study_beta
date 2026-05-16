#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def assert_equal(actual, expected, message):
    if actual != expected:
        raise AssertionError(f"{message}: expected {expected!r}, got {actual!r}")


def test_refresh_wrapper_uses_configured_python_and_routes_args():
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        fake_python = temp_path / "fake-python"
        call_log = temp_path / "calls.jsonl"
        output_root = temp_path / "snapshots"
        config_path = temp_path / "datasets.json"

        fake_python.write_text(
            """#!/usr/bin/env python3
import json
import os
import sys

with open(os.environ["ASSET_STUDY_FAKE_PYTHON_LOG"], "a", encoding="utf-8") as handle:
    handle.write(json.dumps(sys.argv[1:]) + "\\n")
""",
            encoding="utf-8",
        )
        fake_python.chmod(0o755)

        env = dict(os.environ)
        env["ASSET_STUDY_PYTHON_BIN"] = str(fake_python)
        env["ASSET_STUDY_FAKE_PYTHON_LOG"] = str(call_log)

        result = subprocess.run(
            [
                str(REPO_ROOT / "scripts" / "refresh_yfinance.sh"),
                "--period",
                "5y",
                "--config-path",
                str(config_path),
                "--output-root",
                str(output_root),
            ],
            cwd=REPO_ROOT,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise AssertionError(
                f"refresh_yfinance.sh failed with {result.returncode}\n"
                f"stdout:\n{result.stdout}\n"
                f"stderr:\n{result.stderr}"
            )

        calls = [json.loads(line) for line in call_log.read_text(encoding="utf-8").splitlines()]
        assert_equal(
            calls,
            [
                [
                    "scripts/sync_yfinance.py",
                    "--period",
                    "5y",
                    "--config-path",
                    str(config_path),
                    "--output-root",
                    str(output_root),
                ],
                [
                    "scripts/validate_yfinance_snapshots.py",
                    "--require-all-configured",
                    "--config-path",
                    str(config_path),
                    "--output-root",
                    str(output_root),
                ],
                [
                    "scripts/audit_yfinance_quality.py",
                    "--output-root",
                    str(output_root),
                ],
            ],
            "refresh wrapper should dispatch sync, validate, and audit through the selected Python",
        )


def main():
    test_refresh_wrapper_uses_configured_python_and_routes_args()
    print("ok refresh yfinance wrapper")


if __name__ == "__main__":
    main()
