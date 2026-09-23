import "dotenv/config";
import Fastify from "fastify";
import { verifyGithubSignature } from "./github/verifySignature.js";
import { supabase } from "./db/supabase.js";
import { processReview } from "./pipeline/processReview.js";

const app = Fastify({ logger: true });

app.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (req, body, done) => {
    (req as any).rawBody = body as string;
    try {
      const json = (body as string).length ? JSON.parse(body as string) : {};
      done(null, json);
    } catch (err) {
      done(err as Error, undefined);
    }
  }
);

app.get("/health", async () => {
  return { status: "ok", service: "reviewsentinel", time: new Date().toISOString() };
});

app.post("/webhooks/github", async (request, reply) => {
  const signature = request.headers["x-hub-signature-256"] as string | undefined;
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!secret) {
    request.log.error("GITHUB_WEBHOOK_SECRET is not set");
    return reply.code(500).send({ error: "server misconfigured" });
  }

  const valid = verifyGithubSignature(request.rawBody, signature, secret);
  if (!valid) {
    request.log.warn("Rejected webhook: invalid or missing signature");
    return reply.code(401).send({ error: "invalid signature" });
  }

  const event = request.headers["x-github-event"];
  if (event !== "pull_request") {
    return reply.code(202).send({ status: "ignored", reason: `unhandled event: ${event}` });
  }

  const payload = request.body as any;

  if (payload.action !== "opened" && payload.action !== "synchronize") {
    return reply.code(202).send({ status: "ignored", reason: `unhandled action: ${payload.action}` });
  }

  const repoFullName = payload.repository.full_name;
  const owner = payload.repository.owner.login;
  const repoName = payload.repository.name;
  const prNumber = payload.pull_request.number;
  const commitSha = payload.pull_request.head.sha;

  const { data: inserted, error } = await supabase
    .from("reviews")
    .insert({
      repo: repoFullName,
      pr_number: prNumber,
      commit_sha: commitSha,
      status: "pending",
    })
    .select()
    .single();

  if (error || !inserted) {
    request.log.error(error, "failed to persist review");
    return reply.code(500).send({ error: "failed to persist review" });
  }

  request.log.info(`Recorded review ${inserted.id} for ${repoFullName}#${prNumber} @ ${commitSha}`);

  // Respond to GitHub immediately - don't make it wait on the LLM call.
  // GitHub times out webhook deliveries after ~10 seconds; an LLM call
  // plus GitHub diff fetch can easily take longer than that. We reply
  // first, then keep processing in the background. This is a deliberate
  // "no queue needed yet" decision (see the architecture doc, section 5.8) -
  // it's not durable against a server restart mid-review, which is a
  // documented, honest limitation at this stage, not an oversight.
  reply.code(201).send({ status: "accepted", reviewId: inserted.id });

  processReview({
    reviewId: inserted.id,
    owner,
    repo: repoName,
    prNumber,
  }).catch((err) => {
    request.log.error(err, `processReview failed for review ${inserted.id}`);
  });
});

const port = Number(process.env.PORT) || 3000;

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`ReviewSentinel listening on port ${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });