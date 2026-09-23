import { supabase } from "../db/supabase.js";
import { fetchPullRequestDiff } from "../github/fetchDiff.js";
import { reviewDiff } from "../llm/reviewDiff.js";

interface ProcessReviewInput {
  reviewId: string;
  owner: string;
  repo: string;
  prNumber: number;
}

export async function processReview({ reviewId, owner, repo, prNumber }: ProcessReviewInput) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");

  await supabase.from("reviews").update({ status: "processing" }).eq("id", reviewId);

  try {
    const diff = await fetchPullRequestDiff(owner, repo, prNumber, token);
    const { findings, promptTokens, completionTokens, latencyMs } = await reviewDiff(diff);

    // Note: nothing is validated or posted to the PR yet - that's Day 4.
    // Today we just prove the pipeline produces and persists structured
    // findings end to end.
    if (findings.length > 0) {
      const rows = findings.map((f) => ({
        review_id: reviewId,
        file_path: f.file_path,
        line_number: f.line_number,
        category: f.category,
        severity: f.severity,
        explanation: f.explanation,
        validated: false,
        posted: false,
      }));

      const { error: findingsError } = await supabase.from("review_findings").insert(rows);
      if (findingsError) throw findingsError;
    }

    // cost_usd is 0 for now since Groq's free tier has no per-token
    // charge - the field exists so swapping to a paid provider/model
    // later is a config change, not a schema change.
    await supabase.from("usage_events").insert({
      review_id: reviewId,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cost_usd: 0,
      latency_ms: latencyMs,
    });

    await supabase
      .from("reviews")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", reviewId);
  } catch (err) {
    await supabase.from("reviews").update({ status: "failed" }).eq("id", reviewId);
    throw err;
  }
}
