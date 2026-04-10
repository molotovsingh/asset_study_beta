import { recordStudyRun } from "./runHistory.js";

function recordIndexStudyRun(study, session) {
  const studyRun = session.lastStudyRun;
  if (!studyRun) {
    return false;
  }

  return recordStudyRun({
    studyId: study.id,
    studyTitle: study.title,
    subjectQuery: session.indexQuery,
    selectionLabel: studyRun.selection?.label || session.indexQuery,
    symbol: studyRun.selection?.symbol || "",
    requestedStartDate: studyRun.requestedStartDate,
    requestedEndDate: studyRun.requestedEndDate,
    completedAt: studyRun.exportedAt?.toISOString?.() || new Date().toISOString(),
  });
}

export { recordIndexStudyRun };
