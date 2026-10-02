import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("../db/supabase.js", () => {
  const chain = {
    insert: (rows: unknown) => {
      const arr = (Array.isArray(rows) ? rows : [rows]) as Record<string, unknown>[];
      const withIds = arr.map((r, i) => ({ id: `mock-${i}`, ...r }));
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

    expect(postReviewCommentMock).toHaveBeenCalledTimes(1);
    expect(postReviewCommentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: "src/discount.ts",
        line: 8,
      })
    );
  });
});