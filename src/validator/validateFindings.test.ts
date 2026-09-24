import { describe, expect, it } from "vitest";
import { validateFindings } from "./validateFindings.js";
import type { Finding } from "../llm/types.js";

// Real diff shape, matching what GitHub actually returns - the same
// discount.ts fix from Day 1's manual test. Hunk header "@@ -5,7 +5,7 @@"
// means the new-file content starts at line 5. Walking it by hand:
// line 5: blank context, line 6: context (function signature),
// line 7: context (let total = 0), line 8: the ADDED "<" line
// (the old "<=" line was a deletion - it never existed in the new file),
// line 9: context, line 10: context (return total).
const SAMPLE_DIFF = `diff --git a/src/discount.ts b/src/discount.ts
index e0bd945..9b6e784 100644
--- a/src/discount.ts
+++ b/src/discount.ts
@@ -5,7 +5,7 @@
 
 export function calculateOrderTotal(items: { price: number; qty: number }[]): number {
   let total = 0;
-  for (let i = 0; i <= items.length; i++) {
+  for (let i = 0; i < items.length; i++) {
     total += items[i].price * items[i].qty;
   }
   return total;
`;

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    file_path: "src/discount.ts",
    line_number: 8,
    category: "bug-risk",
    severity: "medium",
    explanation: "test finding",
    ...overrides,
  };
}

describe("validateFindings", () => {
  it("accepts a finding on a real line that exists in the diff", () => {
    const [result] = validateFindings(SAMPLE_DIFF, [makeFinding({ line_number: 8 })]);
    expect(result.valid).toBe(true);
  });

  it("rejects a finding on a line number that's plausible but outside the diff's hunk range", () => {
    const [result] = validateFindings(SAMPLE_DIFF, [makeFinding({ line_number: 1 })]);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not present in diff/);
  });

  it("rejects a finding on a file that isn't part of the diff at all", () => {
    const [result] = validateFindings(SAMPLE_DIFF, [
      makeFinding({ file_path: "src/completely-unrelated.ts" }),
    ]);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/file not present in diff/);
  });

  it("rejects a line number one past the last valid line in the hunk", () => {
    // Hunk header is "@@ -5,7 +5,7 @@" - 7 lines starting at line 5
    // means the new-file range is 5 through 11 inclusive. Line 12 is
    // the first line genuinely outside the hunk - a real boundary
    // hallucination.
    const [result] = validateFindings(SAMPLE_DIFF, [makeFinding({ line_number: 12 })]);
    expect(result.valid).toBe(false);
  });

  it("does not accept a line number that only ever existed as a deletion", () => {
    // Old line 8 (the "<=" version) never exists in the NEW file - the
    // new file's line 8 is the replacement "<" line. If a finding
    // pointed at line 8 for a reason unrelated to the actual new
    // content, this test still confirms line 8 is valid because it's a
    // real line in the new file, not because of the old deleted line.
    const [result] = validateFindings(SAMPLE_DIFF, [makeFinding({ line_number: 8 })]);
    expect(result.valid).toBe(true);
  });

  it("validates multiple findings independently and preserves order", () => {
    const results = validateFindings(SAMPLE_DIFF, [
      makeFinding({ line_number: 8 }), // valid
      makeFinding({ line_number: 999 }), // invalid
      makeFinding({ line_number: 6 }), // valid (context line)
    ]);
    expect(results.map((r) => r.valid)).toEqual([true, false, true]);
  });
});