from __future__ import annotations

try:
    from runtime_store import list_study_runs, record_study_run
except ModuleNotFoundError:
    from scripts.runtime_store import list_study_runs, record_study_run


def _clean_text(value) -> str:
    return str(value or "").strip()


def build_study_run_history_payload(request: dict) -> dict:
    try:
        limit = int(request.get("limit") or 12)
    except (TypeError, ValueError) as error:
        raise ValueError("Study run limit must be an integer.") from error

    normalized_limit = max(1, min(limit, 100))
    study_id = _clean_text(request.get("studyId") or request.get("study_id"))
    status = _clean_text(request.get("status"))
    runs = list_study_runs(
        limit=normalized_limit,
        study_id=study_id or None,
        status=status or None,
    )
    return {
        "runs": runs,
    }


def record_study_run_entry(request: dict) -> dict:
    study_id = _clean_text(request.get("studyId"))
    study_title = _clean_text(request.get("studyTitle"))
    selection_label = _clean_text(request.get("selectionLabel"))
    subject_query = _clean_text(request.get("subjectQuery"))

    if not study_id:
        raise ValueError("Study id is required.")
    if not study_title:
        raise ValueError("Study title is required.")
    if not selection_label:
        raise ValueError("Selection label is required.")
    if not subject_query:
        raise ValueError("Subject query is required.")

    recorded_run = record_study_run(request)
    return {
        "run": recorded_run,
    }
