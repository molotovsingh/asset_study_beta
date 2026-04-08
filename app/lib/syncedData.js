const LOCAL_API_COMMAND = "./.venv/bin/python scripts/dev_server.py --port 8000";

function buildApiUrl(pathname) {
  return new URL(`../../api${pathname}`, import.meta.url);
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

function buildLocalApiUnavailableMessage() {
  return `Could not reach the local data API. Start ${LOCAL_API_COMMAND} and reload the app.`;
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

async function loadRememberedIndexCatalog() {
  let response;
  try {
    response = await fetch(buildApiUrl("/yfinance/catalog"), {
      cache: "no-store",
    });
  } catch (error) {
    throw new Error(buildLocalApiUnavailableMessage());
  }

  if (!response.ok) {
    const payload = await parseJsonResponse(response);
    throw new Error(payload?.error || buildLocalApiUnavailableMessage());
  }

  const payload = await response.json();
  if (!Array.isArray(payload.datasets)) {
    throw new Error("The local data API returned an invalid catalog payload.");
  }

  return payload.datasets;
}

async function fetchIndexSeries(request) {
  let response;
  try {
    response = await fetch(buildApiUrl("/yfinance/index-series"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify(request),
    });
  } catch (error) {
    throw new Error(buildLocalApiUnavailableMessage());
  }

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(payload?.error || "The local data API could not load that symbol.");
  }

  const snapshot = payload?.snapshot;
  const series = normalizeSnapshotPoints(snapshot?.points);

  if (series.length < 2) {
    throw new Error("The fetched series did not contain enough observations.");
  }

  return {
    snapshot,
    series,
    rememberedEntry: payload?.rememberedEntry || null,
  };
}

export {
  LOCAL_API_COMMAND,
  buildLocalApiUnavailableMessage,
  describeFreshness,
  fetchIndexSeries,
  getSnapshotFreshness,
  loadRememberedIndexCatalog,
};
