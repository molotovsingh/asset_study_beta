const LOCAL_API_COMMAND = "./.venv/bin/python scripts/dev_server.py --port 8000";

function buildApiUrl(pathname) {
  return new URL(`../../api${pathname}`, import.meta.url);
}

function buildManifestRelativePath(syncConfig) {
  return `data/snapshots/${syncConfig.provider}/${syncConfig.datasetType}/manifest.json`;
}

function buildManifestUrl(syncConfig) {
  return new URL(
    `../../${buildManifestRelativePath(syncConfig)}`,
    import.meta.url,
  );
}

function buildSnapshotRelativePath(syncConfig, relativePath) {
  if (relativePath) {
    return relativePath.startsWith("data/")
      ? relativePath
      : `data/snapshots/${relativePath}`;
  }

  return `data/snapshots/${syncConfig.provider}/${syncConfig.datasetType}/${syncConfig.datasetId}.json`;
}

function buildSnapshotUrl(syncConfig, relativePath) {
  return new URL(
    `../../${buildSnapshotRelativePath(syncConfig, relativePath)}`,
    import.meta.url,
  );
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

function normalizeSnapshotSeries(snapshot, errorMessage) {
  const series = normalizeSnapshotPoints(snapshot?.points);
  if (series.length < 2) {
    throw new Error(errorMessage);
  }

  return series;
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
  const generatedAt = snapshot?.generatedAt ? new Date(snapshot.generatedAt) : null;

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

function buildLocalApiUnavailableMessage() {
  return `Could not reach the local data API. Built-in bundled snapshots still work, but raw symbols need ${LOCAL_API_COMMAND}.`;
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

async function requestJson(
  url,
  {
    requestInit = {},
    onNetworkError = () => "The request could not be completed.",
    onHttpError = (response, payload) =>
      payload?.error || `Request failed (${response.status} ${response.statusText}).`,
  } = {},
) {
  let response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      ...requestInit,
    });
  } catch (error) {
    throw new Error(onNetworkError(error));
  }

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(onHttpError(response, payload));
  }

  return payload;
}

function validateDatasetsPayload(payload, errorMessage) {
  if (!Array.isArray(payload?.datasets)) {
    throw new Error(errorMessage);
  }

  return payload.datasets;
}

async function loadSyncManifest(syncConfig) {
  if (!syncConfig) {
    throw new Error("No synced source is configured for this dataset.");
  }

  const manifest = await requestJson(buildManifestUrl(syncConfig), {
    onHttpError: (response) => {
      if (response.status === 404) {
        return `No bundled manifest was found at ${buildManifestRelativePath(syncConfig)}.`;
      }

      return `Could not load the bundled manifest (${response.status} ${response.statusText}).`;
    },
  });

  validateDatasetsPayload(
    manifest,
    "The bundled manifest does not contain a datasets list.",
  );
  return manifest;
}

function getManifestDataset(manifest, syncConfig) {
  return (
    manifest?.datasets?.find(
      (dataset) => dataset.datasetId === syncConfig?.datasetId,
    ) || null
  );
}

async function loadSyncedSeries(syncConfig, manifestDataset = null) {
  if (!syncConfig) {
    throw new Error("No synced source is configured for this dataset.");
  }

  const snapshot = await requestJson(
    buildSnapshotUrl(syncConfig, manifestDataset?.path),
    {
      onHttpError: (response) => {
        const expectedPath = buildSnapshotRelativePath(
          syncConfig,
          manifestDataset?.path,
        );
        if (response.status === 404) {
          return `No bundled snapshot was found at ${expectedPath}.`;
        }

        return `Could not load the bundled snapshot (${response.status} ${response.statusText}).`;
      },
    },
  );

  return {
    snapshot,
    series: normalizeSnapshotSeries(
      snapshot,
      "The bundled snapshot did not contain enough observations.",
    ),
  };
}

async function loadRememberedIndexCatalog() {
  const payload = await requestJson(buildApiUrl("/yfinance/catalog"), {
    onNetworkError: () => buildLocalApiUnavailableMessage(),
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || buildLocalApiUnavailableMessage(),
  });

  validateDatasetsPayload(
    payload,
    "The local data API returned an invalid catalog payload.",
  );
  return payload.datasets;
}

async function fetchIndexSeries(request) {
  const payload = await requestJson(buildApiUrl("/yfinance/index-series"), {
    requestInit: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
    onNetworkError: () => buildLocalApiUnavailableMessage(),
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || "The local data API could not load that symbol.",
  });

  const snapshot = payload?.snapshot;
  return {
    snapshot,
    series: normalizeSnapshotSeries(
      snapshot,
      "The fetched series did not contain enough observations.",
    ),
    rememberedEntry: payload?.rememberedEntry || null,
  };
}

async function fetchInstrumentProfile(symbol) {
  const payload = await requestJson(buildApiUrl("/yfinance/instrument-profile"), {
    requestInit: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ symbol }),
    },
    onNetworkError: () => buildLocalApiUnavailableMessage(),
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || "The local data API could not load that profile.",
  });

  if (!payload?.profile?.symbol) {
    throw new Error("The local data API returned an invalid profile payload.");
  }

  return {
    profile: payload.profile,
    cache: payload.cache || null,
  };
}

async function fetchMonthlyStraddleSnapshot(request) {
  const payload = await requestJson(buildApiUrl("/yfinance/monthly-straddle"), {
    requestInit: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
    onNetworkError: () => buildLocalApiUnavailableMessage(),
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || "The local data API could not load that options snapshot.",
  });

  if (!payload?.snapshot?.symbol || !Array.isArray(payload?.snapshot?.monthlyContracts)) {
    throw new Error("The local data API returned an invalid monthly straddle payload.");
  }

  return payload.snapshot;
}

export {
  LOCAL_API_COMMAND,
  buildLocalApiUnavailableMessage,
  describeFreshness,
  fetchInstrumentProfile,
  fetchIndexSeries,
  fetchMonthlyStraddleSnapshot,
  getManifestDataset,
  getSnapshotFreshness,
  loadRememberedIndexCatalog,
  loadSyncManifest,
  loadSyncedSeries,
};
