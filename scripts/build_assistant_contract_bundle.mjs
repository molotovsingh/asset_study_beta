import { fileURLToPath } from "node:url";

import { getMetricRegistryManifest } from "../app/lib/metricRegistry.js";
import { getStudyProposalContractManifest } from "../app/studyFactory/studyProposal.js";
import { getAssistantContractManifest } from "../app/studyBuilder/assistantContract.js";
import { getIntentPlannerContractManifest } from "../app/studyBuilder/intentPlanner.js";
import { getStudyCatalogManifest } from "../app/studyBuilder/studyCatalog.js";
import { getStudyPlanContractManifest } from "../app/studyBuilder/studyPlan.js";
import { getStudyPlanRecipeContractManifest } from "../app/studyBuilder/studyPlanRecipes.js";
import { getStudyRunExplanationContractManifest } from "../app/studyBuilder/studyRunExplanation.js";
import { getStudyRunExplanationBriefContractManifest } from "../app/studyBuilder/studyRunExplanationBrief.js";
import { getStudyRunHandoffContractManifest } from "../app/studyBuilder/studyRunHandoff.js";

const ASSISTANT_CONTRACT_BUNDLE_VERSION = "assistant-contract-bundle-v1";

function buildAssistantContractBundle() {
  return {
    version: ASSISTANT_CONTRACT_BUNDLE_VERSION,
    purpose:
      "Backend-readable bundle of deterministic assistant contracts. Use this instead of scraping UI or generated docs.",
    contracts: {
      assistant: getAssistantContractManifest(),
      metricRegistry: getMetricRegistryManifest(),
      studyCatalog: getStudyCatalogManifest(),
      studyProposal: getStudyProposalContractManifest(),
      intentPlanner: getIntentPlannerContractManifest(),
      studyPlan: getStudyPlanContractManifest(),
      studyPlanRecipe: getStudyPlanRecipeContractManifest(),
      studyRunExplanation: getStudyRunExplanationContractManifest(),
      studyRunHandoff: getStudyRunHandoffContractManifest(),
      studyRunExplanationBrief: getStudyRunExplanationBriefContractManifest(),
    },
  };
}

function main() {
  process.stdout.write(`${JSON.stringify(buildAssistantContractBundle(), null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error?.message || "Could not build assistant contract bundle.");
    process.exitCode = 1;
  }
}

export {
  ASSISTANT_CONTRACT_BUNDLE_VERSION,
  buildAssistantContractBundle,
};
