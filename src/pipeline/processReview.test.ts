import { beforeEach, describe, expect, it, vi } from "vitest";

// A real diff shape, fixed in the test so results are deterministic -
// no live GitHub or LLM call happens anywhere in this test.
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

vi.mock("../github/fetchDiff.js", () => ({
  fetchPullRequestDiff: vi.fn().mockResolvedValue(SAMPLE_DIFF),
}));

// Deliberately mock in ONE real finding (line 8 - a genuine line in the
// diff) and ONE hallucinated finding (line 999 - doesn't exist anywhere
// in the diff), to prove the validator actually filters the pipeline's
// real output, not just in isolation in its own unit tests.
vi.mock("../llm/reviewDiff.js", () => ({
  reviewDiff: vi.fn().mockResolvedValue({
    findings: [
      {
        file_path: "src/discount.ts",
        line_number: 8,
        category: "bug-risk",
        severity: "medium",
        explanation: "Off-by-one loop bound.",
      },
      {
        file_path: "src/discount.ts",
        line_number: 999,
        category: "bug-risk",
        severity: "low",
        explanation: "Hallucinated - this line does not exist in the diff.",
      },
    ],
    promptTokens: 100,
    completionTokens: 50,
    latencyMs: 500,
  }),
}));

const postReviewCommentMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../github/postComment.js", () => ({
  postReviewComment: postReviewCommentMock,
}));

// A minimal fake Supabase client - just enough for processReview to run
// without throwing. Not a full fake database; the point of this test is
// the validator's effect on posting behavior, not DB round-tripping.
vi.mock("../db/supabase.js", () => {
  const chain = {
    insert: (rows: unknown) => {
      const arr = Array.isArray(rows) ? rows : [rows];
      const withIds = arr.map((r: any, i: number) => ({ id: `mock-${i}`, ...r }));
      return {
        select: () => Promise.resolve({ data: withIds, error: null }),
        then: (resolve: (v: unknown) => void) =>
          Promise.resolve({ data: withIds, error: null }).then(resolve),
      };
    },
    update: () => ({
      eq: () => Promise.resolve({ data: null, error: null }),
    }),
  };
  return { supabase: { from: () => chain } };
});

const { processReview } = await import("./processReview.js");

describe("processReview (integration)", () => {
  beforeEach(() => {
    postReviewCommentMock.mockClear();
    // fetchPullRequestDiff is mocked above, so this value is never
    // actually used to call GitHub - it just needs to exist so
    // processReview's own guard clause doesn't short-circuit first.
    process.env.GITHUB_TOKEN = "test-token";
  });

  it("posts a comment only for the finding that passes validation", async () => {
    await processReview({
      reviewId: "review-1",
      owner: "test-owner",
      repo: "test-repo",
      prNumber: 1,
      commitSha: "abc123",
    });

    // The hallucinated line-999 finding must never reach GitHub.
    expect(postReviewCommentMock).toHaveBeenCalledTimes(1);
    expect(postReviewCommentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: "src/discount.ts",
        line: 8,
      })
    );
  });
});