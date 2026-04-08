function buildSnapshotRelativePath(syncConfig) {
  return `data/snapshots/${syncConfig.provider}/${syncConfig.datasetType}/${syncConfig.datasetId}.json`;
}

function buildSnapshotUrl(syncConfig) {
  return new URL(`../../${buildSnapshotRelativePath(syncConfig)}`, import.meta.url);
}

function buildManifestRelativePath(syncConfig) {
  return `data/snapshots/${syncConfig.provider}/${syncConfig.datasetType}/manifest.json`;
}

function buildManifestUrl(syncConfig) {
  return new URL(`../../${buildManifestRelativePath(syncConfig)}`, import.meta.url);
}

function getManifestCacheKey(syncConfig) {
  return syncConfig
    ? `${syncConfig.provider}:${syncConfig.datasetType}`
    : "none";
}

function normalizeSnapshotPoints(points) {
  if (!Array.isArray(points)) {
    return [];
  }

  return points
    .map((point) => {
      if (!Array.isArray(point) || point.length < 2) {
        return null;
      }

      const [dateValue, numericValue] = point;
      const date = new Date(`${dateValue}T00:00:00`);
      const value = Number(numericValue);

      if (Number.isNaN(date.getTime()) || !Number.isFinite(value)) {
        return null;
      }

      return { date, value };
    })
    .filter(Boolean)
    .sort((left, right) => left.date - right.date);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysBetween(left, right) {
  return Math.floor((startOfDay(left) - startOfDay(right)) / 86400000);
}

function getSnapshotFreshness(snapshot, now = new Date()) {
  const latestDate = snapshot?.range?.endDate
    ? new Date(`${snapshot.range.endDate}T00:00:00`)
    : null;
  const generatedAt = snapshot?.generatedAt
    ? new Date(snapshot.generatedAt)
    : null;

  const marketLagDays =
    latestDate && !Number.isNaN(latestDate.getTime())
      ? Math.max(daysBetween(now, latestDate), 0)
      : null;
  const syncAgeDays =
    generatedAt && !Number.isNaN(generatedAt.getTime())
      ? Math.max(daysBetween(now, generatedAt), 0)
      : null;

  let status = "unknown";
  if (marketLagDays !== null) {
    if (marketLagDays <= 2) {
      status = "fresh";
    } else if (marketLagDays <= 5) {
      status = "recent";
    } else {
      status = "stale";
    }
  }

  return {
    status,
    latestDate,
    marketLagDays,
    syncAgeDays,
  };
}

function describeFreshness(freshness) {
  switch (freshness.status) {
    case "fresh":
      return "Fresh";
    case "recent":
      return "Recent";
    case "stale":
      return "Stale";
    default:
      return "Unknown";
  }
}

async function loadSyncManifest(syncConfig) {
  if (!syncConfig) {
    throw new Error("No synced source is configured for this index.");
  }

  const response = await fetch(buildManifestUrl(syncConfig), {
    cache: "no-store",
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        `No manifest was found yet. Run ./scripts/refresh_yfinance.sh to create ${buildManifestRelativePath(syncConfig)}.`,
      );
    }

    throw new Error(
      `Could not load the sync manifest (${response.status} ${response.statusText}).`,
    );
  }

  const manifest = await response.json();
  if (!Array.isArray(manifest.datasets)) {
    throw new Error("The sync manifest does not contain a datasets list.");
  }

  return manifest;
}

function getManifestDataset(manifest, syncConfig) {
  return (
    manifest?.datasets?.find(
      (dataset) => dataset.datasetId === syncConfig?.datasetId,
    ) || null
  );
}

async function loadSyncedSeries(syncConfig) {
  if (!syncConfig) {
    throw new Error("No synced source is configured for this index.");
  }

  const response = await fetch(buildSnapshotUrl(syncConfig), {
    cache: "no-store",
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        `No synced snapshot was found yet. Run ./scripts/refresh_yfinance.sh to create ${buildSnapshotRelativePath(syncConfig)}.`,
      );
    }

    throw new Error(
      `Could not load the synced snapshot (${response.status} ${response.statusText}).`,
    );
  }

  const snapshot = await response.json();
  const series = normalizeSnapshotPoints(snapshot.points);

  if (series.length < 2) {
    throw new Error("The synced snapshot did not contain enough observations.");
  }

  return { snapshot, series };
}

function describeSyncSource(indexEntry) {
  if (!indexEntry?.sync) {
    return "No synced snapshot is configured for this catalog entry yet.";
  }

  const sync = indexEntry.sync;
  const relativePath = buildSnapshotRelativePath(sync);
  const isProxy = sync.sourceSeriesType && sync.sourceSeriesType !== indexEntry.seriesType;
  const prefix = isProxy
    ? `${sync.provider} bootstrap currently uses a ${sync.sourceSeriesType.toLowerCase()} proxy for this ${indexEntry.seriesType} catalog entry.`
    : `Synced snapshot available via ${sync.provider}.`;

  return `${prefix} Local snapshot path: ${relativePath}.`;
}

export {
  buildManifestRelativePath,
  buildSnapshotRelativePath,
  describeFreshness,
  describeSyncSource,
  getManifestDataset,
  getManifestCacheKey,
  getSnapshotFreshness,
  loadSyncManifest,
  loadSyncedSeries,
};
