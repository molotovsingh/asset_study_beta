import { rollingReturnsStudy } from "./rollingReturns.js";
import { riskAdjustedReturnStudy } from "./riskAdjustedReturn.js";
import { seasonalityStudy } from "./seasonality.js";
import { sipSimulatorStudy } from "./sipSimulator.js";

const studyRegistry = [
  riskAdjustedReturnStudy,
  seasonalityStudy,
  rollingReturnsStudy,
  sipSimulatorStudy,
];

function getStudyById(studyId) {
  return studyRegistry.find((study) => study.id === studyId) || null;
}

export { studyRegistry, getStudyById };
