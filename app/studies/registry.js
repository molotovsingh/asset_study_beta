import { rollingReturnsStudy } from "./rollingReturns.js";
import { riskAdjustedReturnStudy } from "./riskAdjustedReturn.js";
import { seasonalityStudy } from "./seasonality.js";

const studyRegistry = [
  riskAdjustedReturnStudy,
  seasonalityStudy,
  rollingReturnsStudy,
];

function getStudyById(studyId) {
  return studyRegistry.find((study) => study.id === studyId) || null;
}

export { studyRegistry, getStudyById };
