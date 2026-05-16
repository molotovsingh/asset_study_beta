import { recordStudyRunLedgerEntry } from "../../lib/syncedData.js";
import { recordStudyRun } from "./runHistory.js";

function getCurrentRouteHash() {
  if (typeof window === "undefined") {
    return "";
  }
  return String(window.location.hash || "").trim();
}

function getViewIdFromRouteHash(routeHash) {
  const normalizedHash = String(routeHash || "").trim();
  if (!normalizedHash.startsWith("#")) {
    return "";
  }
  const routeBody = normalizedHash.slice(1).split("?", 1)[0];
  const segments = routeBody.split("/").filter(Boolean);
  return segments.length >= 2 ? String(segments[1] || "").trim() : "";
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function createSummaryItem({
  key,
  label,
  valueText = "",
  valueNumber = null,
  valueKind = "text",
  sortOrder = 0,
}) {
  const normalizedLabel = String(label || "").trim();
  if (!normalizedLabel) {
    return null;
  }

  const normalizedKey = String(key || normalizedLabel).trim();
  return {
    summaryKey: normalizedKey || normalizedLabel,
    label: normalizedLabel,
    valueText: String(valueText || "").trim() || null,
    valueNumber: isFiniteNumber(valueNumber) ? Number(valueNumber) : null,
    valueKind: String(valueKind || "text").trim() || "text",
    sortOrder: Number(sortOrder) || 0,
  };
}

function createLinkItem({
  linkType,
  targetKind,
  targetId,
  targetLabel = "",
  metadata = {},
  sortOrder = 0,
}) {
  const normalizedLinkType = String(linkType || "").trim();
  const normalizedTargetKind = String(targetKind || "").trim();
  const normalizedTargetId = String(targetId || "").trim();
  if (!normalizedLinkType || !normalizedTargetKind || !normalizedTargetId) {
    return null;
  }

  return {
    linkType: normalizedLinkType,
    targetKind: normalizedTargetKind,
    targetId: normalizedTargetId,
    targetLabel: String(targetLabel || "").trim() || null,
    metadata: metadata && typeof metadata === "object" ? metadata : {},
    sortOrder: Number(sortOrder) || 0,
  };
}

function recordLocalStudyRun({
  study,
  subjectQuery = "",
  selectionLabel,
  symbol = "",
  requestedStartDate = "",
  requestedEndDate = "",
  actualStartDate = "",
  actualEndDate = "",
  detailLabel = "",
  requestedParams = {},
  resolvedParams = {},
  providerSummary = {},
  dataSnapshotRefs = [],
  summaryItems = [],
  links = [],
  status = "success",
  warningCount = 0,
  errorMessage = "",
  runKind = "analysis",
  startedAt = "",
  routeHash = getCurrentRouteHash(),
  completedAt = new Date().toISOString(),
  createdAt = completedAt,
}) {
  if (!study?.id || !study?.title || !selectionLabel) {
    return false;
  }

  const entry = {
    studyId: study.id,
    studyTitle: study.title,
    viewId: getViewIdFromRouteHash(routeHash),
    subjectQuery: String(subjectQuery || selectionLabel).trim(),
    selectionLabel: String(selectionLabel || "").trim(),
    symbol: String(symbol || "").trim(),
    requestedStartDate,
    requestedEndDate,
    actualStartDate,
    actualEndDate,
    detailLabel,
    requestedParams,
    resolvedParams,
    providerSummary,
    dataSnapshotRefs,
    summaryItems: Array.isArray(summaryItems) ? summaryItems.filter(Boolean) : [],
    links: Array.isArray(links) ? links.filter(Boolean) : [],
    status,
    warningCount,
    errorMessage,
    runKind,
    startedAt,
    routeHash,
    completedAt,
    createdAt,
  };

  const recorded = recordStudyRun(entry);
  void recordStudyRunLedgerEntry(entry).catch(() => {
    // Local run history should remain usable even if the local API is down.
  });
  return recorded;
}

export { createLinkItem, createSummaryItem, getCurrentRouteHash, isFiniteNumber, recordLocalStudyRun };
