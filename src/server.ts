import "dotenv/config";
import Fastify from "fastify";
import { verifyGithubSignature } from "./github/verifySignature.js";
import { supabase } from "./db/supabase.js";

const app = Fastify({ logger: true });

// Capture the raw request body BEFORE Fastify parses it as JSON.
// HMAC signature verification must run against the exact bytes GitHub
// signed - if we verify against the re-serialized JSON object instead,
// formatting differences (key order, whitespace) can make a valid
// signature fail.
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

  // Only act on PR opens and new pushes to an existing PR for now.
  if (payload.action !== "opened" && payload.action !== "synchronize") {
    return reply.code(202).send({ status: "ignored", reason: `unhandled action: ${payload.action}` });
  }

  const repo = payload.repository.full_name;
  const prNumber = payload.pull_request.number;
  const commitSha = payload.pull_request.head.sha;

  const { error } = await supabase.from("reviews").insert({
    repo,
    pr_number: prNumber,
    commit_sha: commitSha,
    status: "pending",
  });

  if (error) {
    request.log.error(error);
    return reply.code(500).send({ error: "failed to persist review" });
  }

  request.log.info(`Recorded review for ${repo}#${prNumber} @ ${commitSha}`);
  return reply.code(201).send({ status: "accepted" });
});

const port = Number(process.env.PORT) || 3000;

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`ReviewSentinel listening on port ${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });