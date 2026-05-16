import { studyRegistry } from "../studies/registry.js";
import {
  getDefaultStudyViewId,
  getStudyViews,
} from "../studies/studyShell.js";

const STUDY_CATALOG_MANIFEST_VERSION = "study-catalog-manifest-v1";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function toJsonSafeCapabilities(capabilities) {
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) {
    return {};
  }
  return cloneJson(capabilities);
}

function toCatalogView(view) {
  return {
    id: view.id,
    label: view.label,
    summary: view.summary || "",
    description: view.description || "",
    status: view.status || "ready",
    default: Boolean(view.default),
  };
}

function toCatalogStudy(study) {
  return {
    id: study.id,
    title: study.title,
    description: study.description || "",
    inputSummary: study.inputSummary || "",
    capabilities: toJsonSafeCapabilities(study.capabilities),
    defaultViewId: getDefaultStudyViewId(study),
    views: getStudyViews(study).map(toCatalogView),
  };
}

function getStudyCatalogManifest() {
  return {
    version: STUDY_CATALOG_MANIFEST_VERSION,
    purpose:
      "JSON-safe catalog of app-supported studies and views for deterministic assistant planning.",
    studies: studyRegistry.map(toCatalogStudy),
  };
}

function getStudyCatalogEntry(studyId) {
  return getStudyCatalogManifest().studies.find((study) => study.id === studyId) || null;
}

export {
  STUDY_CATALOG_MANIFEST_VERSION,
  getStudyCatalogEntry,
  getStudyCatalogManifest,
};
