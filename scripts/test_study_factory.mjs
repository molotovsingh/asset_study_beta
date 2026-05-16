#!/usr/bin/env node

import { checkStudyProposalContractSync } from "./export_study_proposal_contract.mjs";
import {
  STUDY_PROPOSAL_RESPONSE_VERSION,
  STUDY_PROPOSAL_VERSION,
  buildStudyProposalResponse,
  getStudyProposalContractManifest,
} from "../app/studyFactory/studyProposal.js";

let assertions = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
  assertions += 1;
}

function testExistingStudyProposal() {
  const payload = buildStudyProposalResponse({
    idea: "Compare Nifty 50 against Sensex from 2021 to 2024",
  });
  assert(payload.version === STUDY_PROPOSAL_RESPONSE_VERSION, "response version mismatch");
  assert(payload.mode === "read-only", "proposal response should be read-only");
  assert(payload.execution.executed === false, "proposal should not execute studies");
  assert(payload.execution.generatedCode === false, "proposal should not generate code");
  assert(payload.proposal.version === STUDY_PROPOSAL_VERSION, "proposal version mismatch");
  assert(
    payload.proposal.feasibility.status === "testable-now",
    "existing study idea should be testable now",
  );
  assert(
    payload.proposal.existingCoverage.coverage === "existing-study",
    "existing study idea should map to existing coverage",
  );
  assert(
    payload.proposal.studyPlanCandidate.plan.studyId === "risk-adjusted-return" &&
      payload.proposal.studyPlanCandidate.plan.viewId === "relative",
    "proposal should include the mapped StudyPlan candidate",
  );
}

function testNewsStudyProposalNeedsArchive() {
  const payload = buildStudyProposalResponse({
    idea: "Can RBI policy headlines move bank index volatility?",
    approvedTools: [
      {
        id: "news-api",
        label: "News API",
        kind: "news",
        capabilities: ["article_search", "published_at"],
      },
      {
        id: "economic-calendar",
        label: "Economic Calendar",
        kind: "economic-data",
        capabilities: ["release_timestamps"],
      },
    ],
  });
  assert(
    payload.proposal.feasibility.status === "needs-evidence-archive",
    "news/event idea should require evidence archive before conclusions",
  );
  assert(
    payload.proposal.requiredData.some((item) => item.id === "news-event-archive"),
    "news/event idea should require a news archive",
  );
  assert(
    payload.proposal.requiredTools.some((tool) => tool.kind === "news"),
    "approved news tool should be surfaced",
  );
  assert(
    payload.proposal.caveats.some((caveat) => caveat.includes("archived source IDs")),
    "news/event idea should include source archive caveat",
  );
}

function testNewsStudyProposalMissingTool() {
  const payload = buildStudyProposalResponse({
    idea: "Can RBI policy headlines move bank index volatility?",
  });
  assert(
    payload.proposal.feasibility.status === "needs-data-contract",
    "missing news tool should block feasibility",
  );
  assert(
    payload.proposal.missingToolKinds.includes("news"),
    "missing news tool kind should be reported",
  );
}

function testContractManifest() {
  const contract = getStudyProposalContractManifest();
  assert(contract.version === STUDY_PROPOSAL_VERSION, "contract version mismatch");
  assert(
    contract.hardStops.some((item) => item.includes("proposal is not evidence")),
    "contract should state proposal is not evidence",
  );
  assert(
    checkStudyProposalContractSync().ok,
    "docs/study-proposal-contract.json should stay generated from JS source",
  );
}

function main() {
  testExistingStudyProposal();
  testNewsStudyProposalNeedsArchive();
  testNewsStudyProposalMissingTool();
  testContractManifest();
  console.log(`study factory checks passed (${assertions} assertions)`);
}

main();
