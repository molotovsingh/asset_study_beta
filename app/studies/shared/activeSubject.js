const ACTIVE_SUBJECT_STORAGE_KEY = "indexStudyLab.activeSubjectQuery";
const DEFAULT_ACTIVE_SUBJECT_QUERY = "Nifty 50";

function normalizeSubjectQuery(value) {
  return String(value || "").trim();
}

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

function readStoredSubjectQuery() {
  const storage = getStorage();
  if (!storage) {
    return "";
  }

  try {
    return normalizeSubjectQuery(
      storage.getItem(ACTIVE_SUBJECT_STORAGE_KEY),
    );
  } catch (error) {
    return "";
  }
}

function writeStoredSubjectQuery(query) {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(ACTIVE_SUBJECT_STORAGE_KEY, query);
  } catch (error) {
    // Storage can fail in private browsing or restricted contexts. The
    // in-memory subject still keeps cross-study switching coherent.
  }
}

let activeSubjectQuery =
  readStoredSubjectQuery() || DEFAULT_ACTIVE_SUBJECT_QUERY;

function getActiveSubjectQuery() {
  return activeSubjectQuery;
}

function setActiveSubjectQuery(value) {
  const query = normalizeSubjectQuery(value);
  if (!query || query === activeSubjectQuery) {
    return false;
  }

  activeSubjectQuery = query;
  writeStoredSubjectQuery(query);
  return true;
}

function adoptActiveSubjectQuery(session, queryKey = "indexQuery") {
  const query = getActiveSubjectQuery();
  if (!query || session[queryKey] === query) {
    return false;
  }

  session[queryKey] = query;
  return true;
}

export {
  DEFAULT_ACTIVE_SUBJECT_QUERY,
  adoptActiveSubjectQuery,
  getActiveSubjectQuery,
  setActiveSubjectQuery,
};
