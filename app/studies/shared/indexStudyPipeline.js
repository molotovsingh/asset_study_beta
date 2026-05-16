import { filterSeriesByDate } from "../../lib/stats.js";
import {
  appendCoverageWarnings,
  appendSnapshotWarnings,
} from "./overviewUtils.js";
import {
  buildReturnBasisWarning,
  isReturnBasisProxy,
} from "./returnBasis.js";

function buildIndexStudyMethodLabel(snapshot) {
  return snapshot.cache
    ? `Local ${snapshot.providerName || "market-data"} fetch using ${snapshot.symbol}`
    : `Bundled snapshot using ${snapshot.symbol}`;
}

function appendUniqueWarning(warnings, message) {
  const normalized = String(message || "").trim();
  if (normalized && !warnings.includes(normalized)) {
    warnings.push(normalized);
  }
}

function isProxyCaveatNote(note) {
  return /\bproxy\b/i.test(String(note || ""));
}

async function prepareIndexStudySeries({
  selection,
  start,
  end,
  warnings,
  loadSelectionData,
  applyLoadedSnapshot,
}) {
  const { snapshot, series, rememberedEntry } =
    await loadSelectionData(selection);
  const filteredSeries = filterSeriesByDate(series, start, end);

  if (filteredSeries.length < 2) {
    throw new Error(
      "The selected date range leaves fewer than two index observations.",
    );
  }

  appendCoverageWarnings(filteredSeries, start, end, warnings);
  appendSnapshotWarnings(snapshot, warnings);

  const returnBasisWarning = buildReturnBasisWarning({
    returnBasis: snapshot.returnBasis || selection.returnBasis,
    targetSeriesType: snapshot.targetSeriesType || selection.targetSeriesType,
    sourceSeriesType: snapshot.sourceSeriesType || selection.sourceSeriesType,
  });
  if (returnBasisWarning) {
    appendUniqueWarning(warnings, returnBasisWarning);
  }

  const proxyBasis = isReturnBasisProxy({
    returnBasis: snapshot.returnBasis || selection.returnBasis,
    targetSeriesType: snapshot.targetSeriesType || selection.targetSeriesType,
    sourceSeriesType: snapshot.sourceSeriesType || selection.sourceSeriesType,
  });
  if (snapshot.note && !(proxyBasis && isProxyCaveatNote(snapshot.note))) {
    appendUniqueWarning(warnings, snapshot.note);
  }

  return {
    snapshot,
    series,
    filteredSeries,
    methodLabel: buildIndexStudyMethodLabel(snapshot),
    commitLoadedSnapshot() {
      applyLoadedSnapshot(selection, snapshot, rememberedEntry);
    },
  };
}

export {
  buildIndexStudyMethodLabel,
  prepareIndexStudySeries,
};
