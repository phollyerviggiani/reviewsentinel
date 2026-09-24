import { supabase } from "../db/supabase.js";
import { fetchPullRequestDiff } from "../github/fetchDiff.js";
import { reviewDiff } from "../llm/reviewDiff.js";
import { validateFindings } from "../validator/validateFindings.js";
import { postReviewComment } from "../github/postComment.js";

interface ProcessReviewInput {
  reviewId: string;
  owner: string;
  repo: string;
  prNumber: number;
  commitSha: string;
}

export async function processReview({
  reviewId,
  owner,
  repo,
  prNumber,
  commitSha,
}: ProcessReviewInput) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");

  await supabase.from("reviews").update({ status: "processing" }).eq("id", reviewId);

  try {
    const diff = await fetchPullRequestDiff(owner, repo, prNumber, token);
    const { findings, promptTokens, completionTokens, latencyMs } = await reviewDiff(diff);

    // Independently check every AI finding against the real diff before
    // anything is persisted as "validated" or posted anywhere.
    const validationResults = validateFindings(diff, findings);

    const insertedRows: { id: string; valid: boolean; finding: (typeof validationResults)[number]["finding"] }[] = [];

    if (validationResults.length > 0) {
      const rows = validationResults.map((r) => ({
        review_id: reviewId,
        file_path: r.finding.file_path,
        line_number: r.finding.line_number,
        category: r.finding.category,
        severity: r.finding.severity,
        explanation: r.finding.explanation,
        validated: r.valid,
        posted: false,
      }));

      const { data: inserted, error: findingsError } = await supabase
        .from("review_findings")
        .insert(rows)
        .select();

      if (findingsError) throw findingsError;

      inserted?.forEach((row, idx) => {
        insertedRows.push({
          id: row.id,
          valid: validationResults[idx].valid,
          finding: validationResults[idx].finding,
        });
      });
    }

    // Only validated findings ever get posted. Anything that failed
    // validation is still stored (useful for your own eval/debugging
    // later) but never reaches the actual pull request.
    for (const row of insertedRows) {
      if (!row.valid) continue;

      try {
        await postReviewComment({
          owner,
          repo,
          prNumber,
          commitId: commitSha,
          filePath: row.finding.file_path,
          line: row.finding.line_number,
          body: `**[${row.finding.severity.toUpperCase()}] ${row.finding.category}** — flagged by ReviewSentinel\n\n${row.finding.explanation}`,
          token,
        });

        await supabase.from("review_findings").update({ posted: true }).eq("id", row.id);
      } catch (postErr) {
        // One failed comment shouldn't take the whole review down -
        // log it and keep going with the rest.
        console.error(`Failed to post comment for finding ${row.id}:`, postErr);
      }
    }

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