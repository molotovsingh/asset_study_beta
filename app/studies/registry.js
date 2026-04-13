import { drawdownStudy } from "./drawdownStudy.js";
import { lumpsumVsSipStudy } from "./lumpsumVsSip.js";
import { monthlyStraddleStudy } from "./monthlyStraddle.js";
import { optionsScreenerStudy } from "./optionsScreener.js";
import { optionsValidationStudy } from "./optionsValidation.js";
import { rollingReturnsStudy } from "./rollingReturns.js";
import { riskAdjustedReturnStudy } from "./riskAdjustedReturn.js";
import { seasonalityStudy } from "./seasonality.js";
import { sectorSnapshotStudy } from "./sectorSnapshot.js";
import { sipSimulatorStudy } from "./sipSimulator.js";

const studyRegistry = [
  riskAdjustedReturnStudy,
  sectorSnapshotStudy,
  monthlyStraddleStudy,
  optionsScreenerStudy,
  optionsValidationStudy,
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
