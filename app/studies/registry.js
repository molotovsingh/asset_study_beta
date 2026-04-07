import { riskAdjustedReturnStudy } from "./riskAdjustedReturn.js";

const studyRegistry = [riskAdjustedReturnStudy];

function getStudyById(studyId) {
  return studyRegistry.find((study) => study.id === studyId) || null;
}

export { studyRegistry, getStudyById };
