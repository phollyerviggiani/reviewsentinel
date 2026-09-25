import "dotenv/config";
import { fetchPullRequestDiff } from "../src/github/fetchDiff.js";
import { reviewDiff } from "../src/llm/reviewDiff.js";
import { validateFindings } from "../src/validator/validateFindings.js";

interface EvalCase {
  prNumber: number;
  description: string;
  // Files that SHOULD get at least one validated finding.
  // Empty array = this PR is a clean/true-negative case.
  expectedBuggyFiles: string[];
}

// Fill these in with real PR numbers from your reviewsentinel-test-fixtures
// repo once you've opened the eval PRs described in the walkthrough.
const EVAL_CASES: EvalCase[] = [
  { prNumber: 2, description: "unchecked optional access in user.ts", expectedBuggyFiles: ["src/user.ts"] },
  { prNumber: 3, description: "hardcoded secret in payments.ts", expectedBuggyFiles: ["src/payments.ts"] },
  { prNumber: 4, description: "SQL injection in search.ts", expectedBuggyFiles: ["src/search.ts"] },
  { prNumber: 5, description: "clean file, no issues expected", expectedBuggyFiles: [] },
];

async function main() {
  const owner = process.env.GITHUB_TEST_OWNER;
  const repo = process.env.GITHUB_TEST_REPO;
  const token = process.env.GITHUB_TOKEN;

  if (!owner || !repo || !token) {
    console.error("Missing GITHUB_TEST_OWNER, GITHUB_TEST_REPO, or GITHUB_TOKEN in .env");
    process.exit(1);
  }

  if (EVAL_CASES.some((c) => c.prNumber === 0)) {
    console.error("Update EVAL_CASES in this file with your real PR numbers before running.");
    process.exit(1);
  }

  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let trueNegatives = 0;

  for (const testCase of EVAL_CASES) {
    const diff = await fetchPullRequestDiff(owner, repo, testCase.prNumber, token);
    const { findings } = await reviewDiff(diff);
    const validated = validateFindings(diff, findings).filter((r) => r.valid);

    const flaggedFiles = new Set(validated.map((r) => r.finding.file_path));
    const expected = new Set(testCase.expectedBuggyFiles);
    const allFiles = new Set([...flaggedFiles, ...expected]);

    // Print the full finding whenever a "clean" file gets flagged - this
    // is your window into WHY a false positive happened, not just that
    // it happened.
    if (expected.size === 0 && validated.length > 0) {
      console.log(`  ⚠ Unexpected finding(s) on a clean PR:`);
      for (const r of validated) {
        console.log(`    ${r.finding.file_path}:${r.finding.line_number} [${r.finding.category}/${r.finding.severity}] - ${r.finding.explanation}`);
      }
    }

    let caseCaughtAll = true;

    for (const file of allFiles) {
      const wasFlagged = flaggedFiles.has(file);
      const wasExpected = expected.has(file);

      if (wasExpected && wasFlagged) truePositives++;
      else if (!wasExpected && wasFlagged) falsePositives++;
      else if (wasExpected && !wasFlagged) {
        falseNegatives++;
        caseCaughtAll = false;
      }
    }

    if (expected.size === 0 && flaggedFiles.size === 0) trueNegatives++;

    console.log(
      `PR #${testCase.prNumber} (${testCase.description}): ` +
        `expected=[${[...expected].join(", ") || "none"}], ` +
        `flagged=[${[...flaggedFiles].join(", ") || "none"}] ` +
        `${caseCaughtAll ? "correct" : "MISSED"}`
    );
  }

  const precision = truePositives / (truePositives + falsePositives) || 0;
  const recall = truePositives / (truePositives + falseNegatives) || 0;
  const f1 = (2 * precision * recall) / (precision + recall) || 0;

  console.log("\n--- Eval summary (file-level) ---");
  console.log(`True positives:  ${truePositives}`);
  console.log(`False positives: ${falsePositives}`);
  console.log(`False negatives: ${falseNegatives}`);
  console.log(`True negatives:  ${trueNegatives}`);
  console.log(`Precision: ${precision.toFixed(2)}`);
  console.log(`Recall:    ${recall.toFixed(2)}`);
  console.log(`F1:        ${f1.toFixed(2)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});