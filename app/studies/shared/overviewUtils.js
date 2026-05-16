import { formatDate } from "../../lib/format.js";
import { getSnapshotFreshness } from "../../lib/syncedData.js";

const BUNDLED_INDEX_MANIFEST_SYNC_CONFIG = {
  provider: "yfinance",
  datasetType: "index",
};

function toInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseSnapshotRangeDate(value) {
  if (!value) {
    return null;
  }

  const parsedDate = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function buildDefaultStudyWindow(yearsBack = 5, baseDate = new Date()) {
  const endDate = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
  );
  const startDate = new Date(endDate);
  startDate.setFullYear(startDate.getFullYear() - yearsBack);

  return {
    startDate,
    endDate,
  };
}

function buildAvailableStudyWindow({
  selection,
  runtimeSnapshot = null,
  yearsBack = 5,
  fallbackBaseDate = new Date(),
} = {}) {
  const rangeSource = runtimeSnapshot?.range || selection?.range || null;
  const availableStartDate = parseSnapshotRangeDate(rangeSource?.startDate);
  const availableEndDate = parseSnapshotRangeDate(rangeSource?.endDate);

  const endDate = availableEndDate
    ? new Date(availableEndDate)
    : new Date(
        fallbackBaseDate.getFullYear(),
        fallbackBaseDate.getMonth(),
        fallbackBaseDate.getDate(),
      );
  const startDate = new Date(endDate);
  startDate.setFullYear(startDate.getFullYear() - yearsBack);

  if (availableStartDate && startDate < availableStartDate) {
    startDate.setTime(availableStartDate.getTime());
  }

  return {
    startDate,
    endDate,
    anchoredToAvailableEndDate: Boolean(availableEndDate),
    clippedToAvailableStartDate:
      Boolean(availableStartDate) &&
      startDate.getTime() === availableStartDate.getTime(),
  };
}

function appendCoverageWarnings(series, startDate, endDate, warnings) {
  if (!series.length) {
    return;
  }

  const firstDate = series[0].date;
  const lastDate = series[series.length - 1].date;

  if (firstDate > startDate) {
    warnings.push(
      `The loaded data starts on ${formatDate(firstDate)}, later than your requested start date.`,
    );
  }

  if (lastDate < endDate) {
    warnings.push(
      `The loaded data ends on ${formatDate(lastDate)}, earlier than your requested end date.`,
    );
  }
}

function appendSnapshotWarnings(snapshot, warnings) {
  const freshness = getSnapshotFreshness(snapshot);

  if (freshness.marketLagDays !== null && freshness.marketLagDays > 5) {
    warnings.push(
      `Latest market date is ${formatDate(freshness.latestDate)}, which is ${freshness.marketLagDays} days behind today.`,
    );
  }

  if (freshness.syncAgeDays !== null && freshness.syncAgeDays > 2) {
    const fetchLabel = snapshot.cache ? "fetched" : "synced";
    warnings.push(
      `This series was last ${fetchLabel} ${freshness.syncAgeDays} days ago.`,
    );
  }
}

export {
  BUNDLED_INDEX_MANIFEST_SYNC_CONFIG,
  appendCoverageWarnings,
  appendSnapshotWarnings,
  buildAvailableStudyWindow,
  buildDefaultStudyWindow,
  toInputDate,
};
