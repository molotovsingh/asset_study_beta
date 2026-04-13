import {
  DEFAULT_OPTIONS_SCREENER_UNIVERSE_ID,
  getOptionsScreenerUniverseById,
} from "../app/catalog/optionsScreenerCatalog.js";
import {
  DEFAULT_OPTIONS_VALIDATION_GROUP_KEY,
  DEFAULT_OPTIONS_VALIDATION_HORIZON_DAYS,
  buildOptionsValidationStudyRun,
  flattenOptionsValidationGroups,
  flattenOptionsValidationObservations,
} from "../app/lib/optionsValidation.js";
import {
  buildCsvRows,
  buildWorkbookXml,
} from "../app/lib/optionsValidationExport.js";
import { getStudyById } from "../app/studies/registry.js";
import {
  optionsValidationTemplate,
  renderOptionsValidationResults,
} from "../app/studies/optionsValidationView.js";
import { renderOptionsValidationVisuals } from "../app/studies/optionsValidationVisuals.js";

let assertionCount = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
  assertionCount += 1;
}

function buildFixtureStudyRun(overrides = {}) {
  const universe =
    getOptionsScreenerUniverseById(DEFAULT_OPTIONS_SCREENER_UNIVERSE_ID);
  return buildOptionsValidationStudyRun({
    universe,
    horizonDays: DEFAULT_OPTIONS_VALIDATION_HORIZON_DAYS,
    groupKey: DEFAULT_OPTIONS_VALIDATION_GROUP_KEY,
    validationPayload: {
      runCount: 3,
      observationCount: 5,
      maturedCount: 4,
      pendingCount: 1,
      observations: [
        {
          runId: 4,
          symbol: "AAPL",
          asOfDate: "2026-04-10",
          baseDate: "2026-04-10",
          forwardDate: "2026-04-17",
          matured: true,
          basePrice: 100,
          forwardPrice: 106,
          forwardReturn: 0.06,
          absoluteMove: 0.06,
          availableTradingDays: 5,
          pricingLabel: "Cheap",
          pricingBucket: "cheap",
          candidateAdvisory: "Long Premium Candidate",
          candidateBucket: "long-premium",
          directionLabel: "Long Bias",
          directionBucket: "long",
          ivHv20Ratio: 0.82,
          directionScore: 74,
          executionScore: 88,
          confidenceScore: 90,
        },
        {
          runId: 4,
          symbol: "MSFT",
          asOfDate: "2026-04-10",
          baseDate: "2026-04-10",
          forwardDate: "2026-04-17",
          matured: true,
          basePrice: 100,
          forwardPrice: 103,
          forwardReturn: 0.03,
          absoluteMove: 0.03,
          availableTradingDays: 5,
          pricingLabel: "Cheap",
          pricingBucket: "cheap",
          candidateAdvisory: "Long Premium Candidate",
          candidateBucket: "long-premium",
          directionLabel: "Neutral",
          directionBucket: "neutral",
          ivHv20Ratio: 0.88,
          directionScore: 58,
          executionScore: 80,
          confidenceScore: 84,
        },
        {
          runId: 3,
          symbol: "TSLA",
          asOfDate: "2026-04-09",
          baseDate: "2026-04-09",
          forwardDate: "2026-04-16",
          matured: true,
          basePrice: 100,
          forwardPrice: 95,
          forwardReturn: -0.05,
          absoluteMove: 0.05,
          availableTradingDays: 5,
          pricingLabel: "Rich",
          pricingBucket: "rich",
          candidateAdvisory: "Short Premium Candidate",
          candidateBucket: "short-premium",
          directionLabel: "Short Bias",
          directionBucket: "short",
          ivHv20Ratio: 1.42,
          directionScore: 32,
          executionScore: 76,
          confidenceScore: 79,
        },
        {
          runId: 2,
          symbol: "NVDA",
          asOfDate: "2026-04-08",
          baseDate: "2026-04-08",
          forwardDate: "2026-04-15",
          matured: true,
          basePrice: 100,
          forwardPrice: 98,
          forwardReturn: -0.02,
          absoluteMove: 0.02,
          availableTradingDays: 5,
          pricingLabel: "Rich",
          pricingBucket: "rich",
          candidateAdvisory: "Short Premium Candidate",
          candidateBucket: "short-premium",
          directionLabel: "Neutral",
          directionBucket: "neutral",
          ivHv20Ratio: 1.35,
          directionScore: 49,
          executionScore: 72,
          confidenceScore: 75,
        },
        {
          runId: 1,
          symbol: "AMD",
          asOfDate: "2026-04-12",
          baseDate: "2026-04-11",
          forwardDate: null,
          matured: false,
          basePrice: 100,
          forwardPrice: null,
          forwardReturn: null,
          absoluteMove: null,
          availableTradingDays: 1,
          pricingLabel: "Fair",
          pricingBucket: "fair",
          candidateAdvisory: "No Vol Edge",
          candidateBucket: "watch",
          directionLabel: "Long Bias",
          directionBucket: "long",
          ivHv20Ratio: 1.04,
          directionScore: 61,
          executionScore: 69,
          confidenceScore: 52,
          reason: "Only 1 trading day has elapsed since the archived row.",
        },
      ],
    },
    ...overrides,
  });
}

function testStudyRun() {
  const studyRun = buildFixtureStudyRun();
  assert(studyRun.runCount === 3, "run count should round-trip");
  assert(studyRun.maturedCount === 4, "matured rows should round-trip");
  assert(studyRun.pendingCount === 1, "pending rows should round-trip");
  assert(studyRun.groupedResults.length === 2, "candidate grouping should produce two matured groups");
  assert(studyRun.bestGroup?.label === "Long Premium", "long premium should lead average returns");
  assert(studyRun.weakestGroup?.label === "Short Premium", "short premium should trail average returns");

  const groups = flattenOptionsValidationGroups(studyRun);
  assert(groups.length === 2, "flattened groups should match grouped results");
  assert(groups[0].group === "Long Premium", "flattened groups should preserve labels");

  const observations = flattenOptionsValidationObservations(studyRun);
  assert(observations.length === 5, "flattened observations should include matured and pending rows");
  assert(observations[0].symbol === "AAPL", "flattened observations should preserve symbol ordering");

  const csvRows = buildCsvRows(studyRun);
  assert(csvRows.length === 8, "csv export should include header plus groups and observations");
  assert(csvRows[0][0] === "Section", "csv header should start with Section");

  const workbookXml = buildWorkbookXml(studyRun);
  assert(workbookXml.includes('Worksheet ss:Name="Summary"'), "workbook should include Summary sheet");
  assert(workbookXml.includes('Worksheet ss:Name="Groups"'), "workbook should include Groups sheet");
  assert(workbookXml.includes('Worksheet ss:Name="Observations"'), "workbook should include Observations sheet");
  console.log("ok options validation study");
}

function testViews() {
  const universe =
    getOptionsScreenerUniverseById(DEFAULT_OPTIONS_SCREENER_UNIVERSE_ID);
  const template = optionsValidationTemplate({
    universeCatalog: [universe],
    universeId: universe.id,
    groupKey: DEFAULT_OPTIONS_VALIDATION_GROUP_KEY,
    horizonDaysValue: String(DEFAULT_OPTIONS_VALIDATION_HORIZON_DAYS),
  });
  assert(template.includes('id="options-validation-form"'), "template should include the validation form");
  assert(template.includes("Forward Horizon"), "template should include the horizon selector");

  const resultsMarkup = renderOptionsValidationResults(buildFixtureStudyRun());
  assert(resultsMarkup.includes("Grouped Outcomes"), "results should include grouped outcomes section");
  assert(resultsMarkup.includes("Latest Matured Observations"), "results should include matured observations table");
  assert(resultsMarkup.includes("Pending Rows"), "results should include pending rows block");
  assert(resultsMarkup.includes("Long Premium"), "results should include group labels");

  const visualsMarkup = renderOptionsValidationVisuals(buildFixtureStudyRun());
  assert(visualsMarkup.includes("Options Validation Visuals"), "visuals should include the hero");
  assert(visualsMarkup.includes("Average Forward Return"), "visuals should include return bars");
  assert(visualsMarkup.includes("Return / Move Map"), "visuals should include the scatter section");
  console.log("ok options validation views");
}

function testRegistry() {
  const study = getStudyById("options-validation");
  assert(Boolean(study), "registry should return the options validation study");
  assert(study.views.length === 2, "options validation should register overview and visuals");
  assert(study.views.some((view) => view.id === "visuals"), "options validation should register a visuals view");
  assert(study.capabilities.exports.includes("csv"), "options validation should support exports");
  console.log("ok options validation registry");
}

testStudyRun();
testViews();
testRegistry();
console.log(`options validation checks passed (${assertionCount} assertions)`);
