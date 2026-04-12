from __future__ import annotations

import os
from pathlib import Path


def _strip_matching_quotes(value: str) -> str:
    text = value.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in {"'", '"'}:
        return text[1:-1]
    return text


def load_local_env(env_path: str | Path | None = None) -> list[str]:
    target_path = Path(env_path) if env_path is not None else Path(__file__).resolve().parent.parent / ".env"
    if not target_path.exists():
        return []

    loaded_keys: list[str] = []
    for raw_line in target_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue

        key, raw_value = line.split("=", 1)
        env_key = key.strip()
        if not env_key or env_key in os.environ:
            continue

        os.environ[env_key] = _strip_matching_quotes(raw_value)
        loaded_keys.append(env_key)

    return loaded_keys

