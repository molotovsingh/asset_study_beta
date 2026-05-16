const STUDY_ORDER_IDS = [
  "risk-adjusted-return",
  "sector-snapshot",
  "monthly-straddle",
  "options-screener",
  "options-validation",
  "seasonality",
  "rolling-returns",
  "sip-simulator",
  "lumpsum-vs-sip",
  "drawdown-study",
];

const studyOrdinalById = new Map(
  STUDY_ORDER_IDS.map((studyId, index) => [studyId, index + 1]),
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

export { STUDY_ORDER_IDS, getStudyKickerLabel, getStudyOrdinalById };
