import {
  buildStudyViewHash,
  parseStudyViewHash,
} from "../studyShell.js";

function isValidInputDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function getCurrentRouteParams() {
  return parseStudyViewHash().params;
}

function readTextParam(params, key) {
  return String(params.get(key) || "").trim();
}

function readDateParam(params, key) {
  const value = readTextParam(params, key);
  return isValidInputDate(value) ? value : "";
}

function readBooleanParam(params, key) {
  const value = readTextParam(params, key).toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function replaceRouteInputParams(studyId, viewId, params) {
  if (typeof window === "undefined") {
    return;
  }

  const nextHash = buildStudyViewHash(studyId, viewId, params);
  if (window.location.hash !== nextHash) {
    window.history.replaceState(null, "", nextHash);
  }
}

function readCommonIndexParams(session, params = getCurrentRouteParams()) {
  const subject = readTextParam(params, "subject");
  const start = readDateParam(params, "start");
  const end = readDateParam(params, "end");
  const applied = {
    changed: false,
    subject: false,
    start: false,
    end: false,
  };

  if (subject) {
    applied.subject = true;
    if (session.indexQuery !== subject) {
      session.indexQuery = subject;
      applied.changed = true;
    }
  }
  if (start) {
    applied.start = true;
    if (session.startDateValue !== start) {
      session.startDateValue = start;
      applied.changed = true;
    }
  }
  if (end) {
    applied.end = true;
    if (session.endDateValue !== end) {
      session.endDateValue = end;
      applied.changed = true;
    }
  }

  return applied;
}

function buildCommonIndexParams(session) {
  return {
    subject: session.indexQuery,
    start: session.startDateValue,
    end: session.endDateValue,
  };
}

export {
  buildCommonIndexParams,
  getCurrentRouteParams,
  readBooleanParam,
  readCommonIndexParams,
  readDateParam,
  readTextParam,
  replaceRouteInputParams,
};
