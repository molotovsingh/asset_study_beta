import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getIntentPlannerContractManifest } from "../app/studyBuilder/intentPlanner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, "docs", "intent-planner-contract.json");

function serializeIntentPlannerContract() {
  return `${JSON.stringify(getIntentPlannerContractManifest(), null, 2)}\n`;
}

function parseArgs(argv) {
  const options = {
    check: false,
    write: false,
    outputPath: DEFAULT_OUTPUT_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") {
      options.check = true;
    } else if (arg === "--write") {
      options.write = true;
    } else if (arg === "--output") {
      options.outputPath = path.resolve(argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.check && options.write) {
    throw new Error("Use either --check or --write, not both.");
  }

  return options;
}

function checkIntentPlannerContractSync(outputPath = DEFAULT_OUTPUT_PATH) {
  const expected = serializeIntentPlannerContract();
  const actual = readFileSync(outputPath, "utf8");
  return {
    ok: actual === expected,
    expected,
    actual,
    outputPath,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const serialized = serializeIntentPlannerContract();

  if (options.write) {
    writeFileSync(options.outputPath, serialized);
    console.log(`wrote ${path.relative(REPO_ROOT, options.outputPath)}`);
    return;
  }

  if (options.check) {
    const result = checkIntentPlannerContractSync(options.outputPath);
    if (!result.ok) {
      throw new Error(
        `${path.relative(REPO_ROOT, options.outputPath)} is out of sync with app/studyBuilder/intentPlanner.js. Run node scripts/export_intent_planner_contract.mjs --write.`,
      );
    }
    console.log(`ok ${path.relative(REPO_ROOT, options.outputPath)} is in sync`);
    return;
  }

  process.stdout.write(serialized);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export {
  DEFAULT_OUTPUT_PATH,
  checkIntentPlannerContractSync,
  serializeIntentPlannerContract,
};
