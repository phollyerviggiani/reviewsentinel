# ReviewSentinel

An AI code review agent that reviews GitHub pull requests, but treats the
LLM's output as a claim to verify, not a fact to trust. Every finding is
independently checked against the real diff before it's ever posted -
citation *and* content are verified, not just "does this line exist."

**Live demo:** _add your Render URL here once deployed_
**Repo:** https://github.com/<your-username>/reviewsentinel

## Why this exists

Most "AI code review" demos are a single prompt wrapped around a diff.
This one is built around a specific question: how do you stop an LLM's
confident-sounding mistake from becoming a real comment on someone's
pull request? The answer here is a validation layer that sits between
the model and GitHub, and an eval harness that measures - rather than
assumes - how well the whole pipeline actually performs.

## Architecture

```
GitHub PR event --> Webhook receiver (Fastify/TS, signature-verified)
                        |
                        v
                Diff fetch (GitHub REST API, scoped read-only token)
                        |
                        v
                LLM call (forced structured/tool-call output only)
                        |
                        v
        Validator: does the cited line exist? Does the model's
        claim about that line's content actually match reality?
        (fails closed - anything unverified is dropped, never posted)
                        |
        +---------------+----------------+
        v                                v
 Post validated findings           Log to Postgres (Supabase):
 as real PR review comments        reviews, findings, usage/cost
```

No queue, no Redis, no microservices - see "Design decisions" below for
why each of those was deliberately left out.

## Tech stack

- **Backend:** TypeScript, Fastify
- **Database:** PostgreSQL via Supabase (free tier)
- **LLM:** Groq API, forced function/tool calling, temperature 0
- **Testing:** Vitest (unit + integration)
- **CI/CD:** GitHub Actions
- **Deployment:** Docker, Render (free tier)

## How it works

1. A GitHub webhook fires on `pull_request` (`opened`/`synchronize`) and is
   verified via HMAC signature before anything else happens.
2. The PR's diff is fetched using a fine-grained token scoped to exactly
   one repo, with `Pull requests: Read and write` + `Contents: Read-only`
   - nothing else.
3. The diff is sent to an LLM with a forced tool-call schema requiring,
   for every finding: file path, line number, **a verbatim quote of that
   line**, category, severity, and explanation.
4. The validator independently re-parses the diff and checks two
   things per finding: does the cited line exist, and does the model's
   quoted text actually match what's really there. Anything that fails
   either check is dropped - never posted, never surfaced.
5. Only validated findings are posted as real inline PR comments.
   Everything (validated or not) is logged to Postgres for analysis.

## Design decisions (and why)

- **No job queue.** The webhook responds to GitHub immediately, then
  processes in the background within the same request lifecycle. This
  isn't durable against a mid-review server crash - a documented,
  known limitation at this scale, not an oversight. A queue would be
  the right next step if throughput or durability ever became a real
  problem; it isn't one yet.
- **No caching / Redis.** Nothing in this system's access pattern
  repeats often enough at portfolio scale to justify it.
- **Single-shot LLM call, no multi-step agent.** A diff is genuinely
  enough context for this task - a full agentic loop would add
  complexity without solving a real problem this system has.
- **File-level eval, not exact-line eval.** The eval harness checks
  whether the right *file* got flagged, not the exact line, since
  exact-line matching would depend on the model guessing the same line
  a human happened to pick when planting a bug. This is a simplification,
  stated here rather than hidden.

## Evaluation

Run against `N` hand-labeled test PRs, `T` trials each (LLM output isn't
fully deterministic even at temperature 0, so a single run is not a
reliable number):

```bash
npm run eval
```

_Fill in your real numbers here, e.g.:_
"Aggregate precision: X.XX, recall: X.XX across N cases x T trials.
Precision stayed at/near 1.00 across all runs - every finding that
passed validation was a real, correctly-cited issue. Recall varied
more, particularly for [category], which reflects real inference-time
non-determinism rather than a flaw in the validation layer itself."

## Known limitations

- **Diff-only context.** The model only ever sees the diff, not the
  full file or codebase. A real, planted bug outside the touched lines
  of a diff will never be seen - this is a known, deliberate MVP
  boundary, not a bug. (Documented Intermediate-tier fix: a bounded
  tool loop letting the model request specific files on demand.)
- **Content hallucination vs. citation hallucination.** The validator
  catches a model citing a fake line, and catches a model citing a
  real line while lying about its content. It cannot catch a model
  correctly quoting a real line and then drawing a wrong conclusion
  from it - that requires actually understanding the code, not just
  verifying citations.
- **Free-tier infrastructure trade-offs.** The backend spins down after
  15 minutes idle (cold start ~30-60s on the next request). The
  database pauses after 7 days of inactivity (mitigated by a scheduled
  keep-alive ping, see `.github/workflows/keep-alive.yml`).
- **Small eval set.** N hand-labeled PRs is enough to catch real,
  specific failure modes (and did - see commit history / eval notes),
  but is not a statistically rigorous benchmark.

## Running it locally

```bash
npm install
cp .env.example .env   # fill in your own keys
npm run dev
```

See `.env.example` for the required environment variables.

## Testing

```bash
npm test        # unit + integration tests
npm run lint     # ESLint
npx tsc --noEmit # typecheck
```
