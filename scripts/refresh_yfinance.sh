#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ ! -x ".venv/bin/python" ]]; then
  echo "Missing .venv/bin/python. Create the local virtualenv and install requirements-sync.txt first." >&2
  exit 1
fi

SYNC_ARGS=("$@")
VALIDATE_ARGS=(--require-all-configured)

while (($#)); do
  case "$1" in
    --config-path|--output-root)
      if (($# < 2)); then
        echo "Missing value for $1" >&2
        exit 1
      fi
      VALIDATE_ARGS+=("$1" "$2")
      shift 2
      ;;
    --config-path=*|--output-root=*)
      VALIDATE_ARGS+=("$1")
      shift
      ;;
    *)
      shift
      ;;
  esac
done

".venv/bin/python" scripts/sync_yfinance.py "${SYNC_ARGS[@]}"
".venv/bin/python" scripts/validate_yfinance_snapshots.py "${VALIDATE_ARGS[@]}"
