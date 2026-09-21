import "dotenv/config";
import Fastify from "fastify";

const app = Fastify({ logger: true });

// just proving the server runs and can be curled.
app.get("/health", async () => {
  return { status: "ok", service: "reviewsentinel", time: new Date().toISOString() };
});

const port = Number(process.env.PORT) || 3000;

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`ReviewSentinel listening on port ${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
