import { studyRegistry } from "../registry.js";

const studyOrdinalById = new Map(
  studyRegistry.map((study, index) => [study.id, index + 1]),
);

function getStudyOrdinalById(studyId) {
  return studyOrdinalById.get(studyId) || null;
}

function getStudyKickerLabel(studyId) {
  const ordinal = getStudyOrdinalById(studyId);
  if (!Number.isFinite(ordinal)) {
    return "Study";
  }
  return `Study ${String(ordinal).padStart(2, "0")}`;
}

export { getStudyKickerLabel, getStudyOrdinalById };
