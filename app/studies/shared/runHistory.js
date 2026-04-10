const RUN_HISTORY_STORAGE_KEY = "indexStudyLab.recentRuns";
const MAX_RUN_HISTORY_ITEMS = 12;

function getStorage() {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  try {
    return window.localStorage;
  } catch (error) {
    return null;
  }
}

function normalizeRunHistoryText(value) {
  return String(value || "").trim();
}

function toDateString(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value.slice(0, 10);
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getDate()).padStart(2, "0"),
    ].join("-");
  }

  return "";
}

function buildRunHistoryId(run) {
  return [
    run.studyId,
    run.symbol,
    run.requestedStartDate,
    run.requestedEndDate,
    run.completedAt,
  ]
    .filter(Boolean)
    .join("|");
}

function sanitizeRunHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const studyId = normalizeRunHistoryText(entry.studyId);
  const studyTitle = normalizeRunHistoryText(entry.studyTitle);
  const subjectQuery = normalizeRunHistoryText(entry.subjectQuery);
  const selectionLabel = normalizeRunHistoryText(entry.selectionLabel);
  const symbol = normalizeRunHistoryText(entry.symbol);
  const completedAt = normalizeRunHistoryText(entry.completedAt);

  if (!studyId || !studyTitle || !subjectQuery || !completedAt) {
    return null;
  }

  const run = {
    id: normalizeRunHistoryText(entry.id),
    studyId,
    studyTitle,
    subjectQuery,
    selectionLabel: selectionLabel || subjectQuery,
    symbol,
    requestedStartDate: toDateString(entry.requestedStartDate),
    requestedEndDate: toDateString(entry.requestedEndDate),
    completedAt,
  };

  return {
    ...run,
    id: run.id || buildRunHistoryId(run),
  };
}

function readStoredRunHistory() {
  const storage = getStorage();
  if (!storage) {
    return [];
  }

  try {
    const decoded = JSON.parse(storage.getItem(RUN_HISTORY_STORAGE_KEY) || "[]");
    return Array.isArray(decoded)
      ? decoded.map(sanitizeRunHistoryEntry).filter(Boolean)
      : [];
  } catch (error) {
    return [];
  }
}

function writeStoredRunHistory(runs) {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(RUN_HISTORY_STORAGE_KEY, JSON.stringify(runs));
  } catch (error) {
    // Local run history is an enhancement. Restricted storage should not block
    // study execution.
  }
}

let runHistory = readStoredRunHistory();
const runHistoryListeners = new Set();

function notifyRunHistoryListeners() {
  runHistoryListeners.forEach((listener) => {
    listener(getRecentRuns());
  });
}

function getRecentRuns() {
  return [...runHistory];
}

function recordStudyRun(entry) {
  const sanitizedEntry = sanitizeRunHistoryEntry({
    ...entry,
    completedAt: entry?.completedAt || new Date().toISOString(),
  });
  if (!sanitizedEntry) {
    return false;
  }

  runHistory = [
    sanitizedEntry,
    ...runHistory.filter((run) => run.id !== sanitizedEntry.id),
  ].slice(0, MAX_RUN_HISTORY_ITEMS);
  writeStoredRunHistory(runHistory);
  notifyRunHistoryListeners();
  return true;
}

function clearRunHistory() {
  runHistory = [];
  writeStoredRunHistory(runHistory);
  notifyRunHistoryListeners();
}

function subscribeRunHistory(listener) {
  runHistoryListeners.add(listener);
  return () => runHistoryListeners.delete(listener);
}

export {
  clearRunHistory,
  MAX_RUN_HISTORY_ITEMS,
  getRecentRuns,
  recordStudyRun,
  subscribeRunHistory,
};
