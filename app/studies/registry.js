import { drawdownStudy } from "./drawdownStudy.js";
import { lumpsumVsSipStudy } from "./lumpsumVsSip.js";
import { rollingReturnsStudy } from "./rollingReturns.js";
import { riskAdjustedReturnStudy } from "./riskAdjustedReturn.js";
import { seasonalityStudy } from "./seasonality.js";
import { sipSimulatorStudy } from "./sipSimulator.js";

const studyRegistry = [
  riskAdjustedReturnStudy,
  seasonalityStudy,
  rollingReturnsStudy,
  sipSimulatorStudy,
  lumpsumVsSipStudy,
  drawdownStudy,
];

function getStudyById(studyId) {
  return studyRegistry.find((study) => study.id === studyId) || null;
}

export { studyRegistry, getStudyById };
