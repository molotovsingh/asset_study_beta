import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildStudyRunAssistantHandoff } from "../app/studyBuilder/studyRunHandoff.js";
import { buildStudyRunExplanationBriefFromHandoff } from "../app/studyBuilder/studyRunExplanationBrief.js";

function buildStudyRunAssistantPayload(run) {
  const handoff = buildStudyRunAssistantHandoff(run);
  return {
    handoff,
    explanationBrief: buildStudyRunExplanationBriefFromHandoff(handoff),
  };
}

function readStdinJson() {
  const input = readFileSync(0, "utf8").trim();
  if (!input) {
    throw new Error("Expected one study-run JSON object on stdin.");
  }
  return JSON.parse(input);
}

function main() {
  const payload = buildStudyRunAssistantPayload(readStdinJson());
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error?.message || "Could not build study-run assistant payload.");
    process.exitCode = 1;
  }
}

export { buildStudyRunAssistantPayload };
