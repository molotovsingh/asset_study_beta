#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

resolve_python_bin() {
  if [[ -n "${ASSET_STUDY_PYTHON_BIN:-}" ]]; then
    if [[ "$ASSET_STUDY_PYTHON_BIN" == */* ]]; then
      if [[ ! -x "$ASSET_STUDY_PYTHON_BIN" ]]; then
        echo "ASSET_STUDY_PYTHON_BIN is not executable: $ASSET_STUDY_PYTHON_BIN" >&2
        exit 1
      fi
      printf '%s\n' "$ASSET_STUDY_PYTHON_BIN"
      return
    fi

    if ! command -v "$ASSET_STUDY_PYTHON_BIN" >/dev/null 2>&1; then
      echo "ASSET_STUDY_PYTHON_BIN was not found on PATH: $ASSET_STUDY_PYTHON_BIN" >&2
      exit 1
    fi
    command -v "$ASSET_STUDY_PYTHON_BIN"
    return
  fi

  if [[ -x ".venv/bin/python" ]]; then
    printf '%s\n' ".venv/bin/python"
    return
  fi

  if command -v python3 >/dev/null 2>&1; then
    command -v python3
    return
  fi

  if command -v python >/dev/null 2>&1; then
    command -v python
    return
  fi

  echo "Could not find Python. Create .venv or set ASSET_STUDY_PYTHON_BIN." >&2
  exit 1
}

PYTHON_BIN="$(resolve_python_bin)"

SYNC_ARGS=("$@")
VALIDATE_ARGS=(--require-all-configured)
AUDIT_ARGS=()

while (($#)); do
  case "$1" in
    --config-path)
      if (($# < 2)); then
        echo "Missing value for $1" >&2
        exit 1
      fi
      VALIDATE_ARGS+=("$1" "$2")
      shift 2
      ;;
    --output-root)
      if (($# < 2)); then
        echo "Missing value for $1" >&2
        exit 1
      fi
      VALIDATE_ARGS+=("$1" "$2")
      AUDIT_ARGS+=("$1" "$2")
      shift 2
      ;;
    --config-path=*)
      VALIDATE_ARGS+=("$1")
      shift
      ;;
    --output-root=*)
      VALIDATE_ARGS+=("$1")
      AUDIT_ARGS+=("$1")
      shift
      ;;
    *)
      shift
      ;;
  esac
done

"$PYTHON_BIN" scripts/sync_yfinance.py "${SYNC_ARGS[@]}"
"$PYTHON_BIN" scripts/validate_yfinance_snapshots.py "${VALIDATE_ARGS[@]}"
"$PYTHON_BIN" scripts/audit_yfinance_quality.py "${AUDIT_ARGS[@]}"
