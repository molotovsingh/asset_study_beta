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
import { STUDY_ORDER_IDS } from "./shared/studyOrdinal.js";

const studiesById = new Map(
  [
    drawdownStudy,
    lumpsumVsSipStudy,
    monthlyStraddleStudy,
    optionsScreenerStudy,
    optionsValidationStudy,
    rollingReturnsStudy,
    riskAdjustedReturnStudy,
    seasonalityStudy,
    sectorSnapshotStudy,
    sipSimulatorStudy,
  ].map((study) => [study.id, study]),
);

const missingStudyIds = STUDY_ORDER_IDS.filter(
  (studyId) => !studiesById.has(studyId),
);
if (missingStudyIds.length) {
  throw new Error(
    `Study registry is missing configured studies: ${missingStudyIds.join(", ")}`,
  );
}

const orphanStudyIds = [...studiesById.keys()].filter(
  (studyId) => !STUDY_ORDER_IDS.includes(studyId),
);
if (orphanStudyIds.length) {
  throw new Error(`Study registry has unranked studies: ${orphanStudyIds.join(", ")}`);
}

const studyRegistry = STUDY_ORDER_IDS.map((studyId) => studiesById.get(studyId));

function getStudyById(studyId) {
  return studyRegistry.find((study) => study.id === studyId) || null;
}

export { studyRegistry, getStudyById };
