import { parseStudyViewHash } from "./studies/studyShell.js";

const SETTINGS_ROUTE_ID = "settings";
const DEFAULT_SETTINGS_SECTION = "automations";
const STUDY_BUILDER_SETTINGS_SECTION = "study-builder";
const VALID_SETTINGS_SECTIONS = new Set([
  DEFAULT_SETTINGS_SECTION,
  "history",
  STUDY_BUILDER_SETTINGS_SECTION,
]);

function toRouteSearchParams(params) {
  if (!params) {
    return new URLSearchParams();
  }

  if (params instanceof URLSearchParams) {
    return new URLSearchParams(params);
  }

  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      searchParams.set(key, String(value));
    }
  });
  return searchParams;
}

function normalizeSettingsSection(section) {
  const normalized = String(section || "").trim().toLowerCase();
  if (!normalized || !VALID_SETTINGS_SECTIONS.has(normalized)) {
    return DEFAULT_SETTINGS_SECTION;
  }
  return normalized;
}

function buildSettingsRouteHash(section = DEFAULT_SETTINGS_SECTION, params = null) {
  const normalizedSection = normalizeSettingsSection(section);
  const searchParams = toRouteSearchParams(params);
  const queryString = searchParams.toString();
  return `#${SETTINGS_ROUTE_ID}/${normalizedSection}${queryString ? `?${queryString}` : ""}`;
}

function parseAppRouteHash(hashValue = window.location.hash) {
  const [path = "", queryString = ""] = String(hashValue)
    .replace(/^#/, "")
    .split("?");
  const [firstSegment = "", secondSegment = ""] = path.split("/");

  if (firstSegment === SETTINGS_ROUTE_ID) {
    return {
      kind: "settings",
      section: normalizeSettingsSection(secondSegment),
      rawSection: String(secondSegment || "").trim().toLowerCase(),
      params: new URLSearchParams(queryString),
    };
  }

  const studyRoute = parseStudyViewHash(hashValue);
  return {
    kind: "study",
    studyId: studyRoute.studyId,
    viewId: studyRoute.viewId,
    params: studyRoute.params,
  };
}

function isRecognizedSettingsRoute(route) {
  return (
    route?.kind === "settings" &&
    VALID_SETTINGS_SECTIONS.has(route.section) &&
    (!route.rawSection || VALID_SETTINGS_SECTIONS.has(route.rawSection))
  );
}

export {
  DEFAULT_SETTINGS_SECTION,
  STUDY_BUILDER_SETTINGS_SECTION,
  buildSettingsRouteHash,
  isRecognizedSettingsRoute,
  normalizeSettingsSection,
  parseAppRouteHash,
};
