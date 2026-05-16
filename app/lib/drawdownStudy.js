import { DRAWDOWN_MATERIALITY_THRESHOLD } from "./metricRegistry.js";

function mean(values) {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function buildUnderwaterSeries(indexSeries) {
  let peakValue = indexSeries[0]?.value ?? 0;

  return indexSeries.map((point) => {
    peakValue = Math.max(peakValue, point.value);
    return {
      date: point.date,
      depth: Math.min(point.value / peakValue - 1, 0),
    };
  });
}

function closeEpisode({
  episode,
  endPoint,
  endIndex,
  recovered,
}) {
  const durationDays = (endPoint.date - episode.peakDate) / 86400000;
  const durationPeriods = endIndex - episode.peakIndex;
  const recoveryDays = recovered
    ? (endPoint.date - episode.troughDate) / 86400000
    : null;
  const recoveryPeriods = recovered ? endIndex - episode.troughIndex : null;

  return {
    peakDate: episode.peakDate,
    peakIndex: episode.peakIndex,
    peakValue: episode.peakValue,
    troughDate: episode.troughDate,
    troughIndex: episode.troughIndex,
    troughValue: episode.troughValue,
    recoveryDate: recovered ? endPoint.date : null,
    endDate: endPoint.date,
    endValue: endPoint.value,
    maxDepth: episode.maxDepth,
    peakToTroughDays: (episode.troughDate - episode.peakDate) / 86400000,
    peakToTroughPeriods: episode.troughIndex - episode.peakIndex,
    durationDays,
    durationPeriods,
    recoveryDays,
    recoveryPeriods,
    recovered,
  };
}

function buildDrawdownEpisodes(indexSeries, materialityThreshold = DRAWDOWN_MATERIALITY_THRESHOLD) {
  if (indexSeries.length < 2) {
    return [];
  }

  const episodes = [];
  let peakValue = indexSeries[0].value;
  let peakDate = indexSeries[0].date;
  let peakIndex = 0;
  let openEpisode = null;

  for (let index = 1; index < indexSeries.length; index += 1) {
    const point = indexSeries[index];

    if (point.value >= peakValue) {
      if (openEpisode) {
        episodes.push(
          closeEpisode({
            episode: openEpisode,
            endPoint: point,
            endIndex: index,
            recovered: true,
          }),
        );
        openEpisode = null;
      }

      peakValue = point.value;
      peakDate = point.date;
      peakIndex = index;
      continue;
    }

    const drawdownDepth = point.value / peakValue - 1;
    if (!openEpisode) {
      if (drawdownDepth <= -materialityThreshold) {
        openEpisode = {
          peakDate,
          peakIndex,
          peakValue,
          troughDate: point.date,
          troughIndex: index,
          troughValue: point.value,
          maxDepth: drawdownDepth,
        };
      }
      continue;
    }

    if (drawdownDepth < openEpisode.maxDepth) {
      openEpisode.maxDepth = drawdownDepth;
      openEpisode.troughDate = point.date;
      openEpisode.troughIndex = index;
      openEpisode.troughValue = point.value;
    }
  }

  if (openEpisode) {
    const endPoint = indexSeries[indexSeries.length - 1];
    episodes.push(
      closeEpisode({
        episode: openEpisode,
        endPoint,
        endIndex: indexSeries.length - 1,
        recovered: false,
      }),
    );
  }

  return episodes;
}

function rankEpisodesByDepth(episodes) {
  return [...episodes]
    .sort((left, right) => left.maxDepth - right.maxDepth)
    .map((episode, index) => ({
      ...episode,
      depthRank: index + 1,
    }));
}

function buildStudySummary(
  indexSeries,
  underwaterSeries,
  episodes,
  episodesByDepth,
  materialityThreshold = DRAWDOWN_MATERIALITY_THRESHOLD,
) {
  const maxDrawdownEpisode = episodesByDepth[0] ?? null;
  const longestEpisode = episodes.reduce((best, episode) => {
    if (!best || episode.durationDays > best.durationDays) {
      return episode;
    }
    return best;
  }, null);
  const longestRecovery = episodes
    .filter((episode) => Number.isFinite(episode.recoveryDays))
    .reduce((best, episode) => {
      if (!best || episode.recoveryDays > best.recoveryDays) {
        return episode;
      }
      return best;
    }, null);
  const openEpisode = episodes.find((episode) => !episode.recovered) || null;

  const depthValues = episodes.map((episode) => Math.abs(episode.maxDepth));
  const durationValues = episodes.map((episode) => episode.durationDays);
  const recoveryValues = episodes
    .map((episode) => episode.recoveryDays)
    .filter((value) => Number.isFinite(value));
  const underwaterPoints = underwaterSeries.filter(
    (point) => point.depth <= -materialityThreshold,
  ).length;
  const recoveredEpisodes = episodes.filter((episode) => episode.recovered).length;
  const latestRawDepth = underwaterSeries[underwaterSeries.length - 1]?.depth ?? 0;

  return {
    materialityThreshold,
    observations: indexSeries.length,
    totalEpisodes: episodes.length,
    recoveredEpisodes,
    unrecoveredEpisodes: episodes.length - recoveredEpisodes,
    maxDrawdownEpisode,
    longestEpisode,
    longestRecovery,
    openEpisode,
    latestDepth: latestRawDepth <= -materialityThreshold ? latestRawDepth : 0,
    rawLatestDepth: latestRawDepth,
    timeUnderwaterRate:
      underwaterSeries.length > 0 ? underwaterPoints / underwaterSeries.length : null,
    averageEpisodeDepth: mean(depthValues),
    medianEpisodeDepth: median(depthValues),
    averageEpisodeDurationDays: mean(durationValues),
    medianEpisodeDurationDays: median(durationValues),
    averageRecoveryDays: mean(recoveryValues),
    medianRecoveryDays: median(recoveryValues),
  };
}

function buildDrawdownStudy(indexSeries) {
  if (indexSeries.length < 2) {
    throw new Error("The study needs at least two index observations.");
  }

  const underwaterSeries = buildUnderwaterSeries(indexSeries);
  const episodes = buildDrawdownEpisodes(indexSeries, DRAWDOWN_MATERIALITY_THRESHOLD);
  const episodesByDepth = rankEpisodesByDepth(episodes);
  const summary = buildStudySummary(
    indexSeries,
    underwaterSeries,
    episodes,
    episodesByDepth,
    DRAWDOWN_MATERIALITY_THRESHOLD,
  );

  return {
    underwaterSeries,
    episodes,
    episodesByDepth,
    summary,
  };
}

export { DRAWDOWN_MATERIALITY_THRESHOLD, buildDrawdownStudy };
