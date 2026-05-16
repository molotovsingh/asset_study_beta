import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildStudyProposalResponse } from "../app/studyFactory/studyProposal.js";

function readStdinJson() {
  const input = readFileSync(0, "utf8").trim();
  if (!input) {
    throw new Error("Expected one study proposal request JSON object on stdin.");
  }
  return JSON.parse(input);
}

function main() {
  const payload = buildStudyProposalResponse(readStdinJson());
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error?.message || "Could not build study proposal payload.");
    process.exitCode = 1;
  }
}

export { buildStudyProposalResponse };
