import { filterSeriesByDate } from "../../lib/stats.js";
import {
  appendCoverageWarnings,
  appendSnapshotWarnings,
} from "./overviewUtils.js";

function buildIndexStudyMethodLabel(snapshot) {
  return snapshot.cache
    ? `Local ${snapshot.providerName || "market-data"} fetch using ${snapshot.symbol}`
    : `Bundled snapshot using ${snapshot.symbol}`;
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

  if (snapshot.sourceSeriesType !== selection.targetSeriesType) {
    warnings.push(
      `Loaded data currently uses ${snapshot.sourceSeriesType} series as a bootstrap proxy for ${selection.targetSeriesType}.`,
    );
  }

  if (snapshot.note) {
    warnings.push(snapshot.note);
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
