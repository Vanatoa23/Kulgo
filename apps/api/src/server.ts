import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ArcadeDbAuthRepository } from "./auth/repository.js";
import { loadConfig } from "./config.js";
import { HttpArcadeDbClient } from "./db/client.js";
import { bootstrapSchema } from "./db/schema.js";

const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

async function startServer() {
  const config = loadConfig();
  const db = new HttpArcadeDbClient({
    url: config.ARCADEDB_URL,
    database: config.ARCADEDB_DATABASE,
    user: config.ARCADEDB_USER,
    password: config.ARCADEDB_PASSWORD,
  });

  await bootstrapSchema(db);

  const authRepo = new ArcadeDbAuthRepository(db);
  await authRepo.deleteExpiredSessions(new Date().toISOString());

  setInterval(() => {
    void authRepo
      .deleteExpiredSessions(new Date().toISOString())
      .catch((err) => {
        console.error("[kulgo-api] Failed to prune expired sessions:", err);
      });
  }, SESSION_CLEANUP_INTERVAL_MS).unref();

  const app = createApp({ config, db, authRepo });

  serve(
    {
      fetch: app.fetch,
      port: config.PORT,
    },
    (info) => {
      console.log(`[kulgo-api] Listening on http://127.0.0.1:${info.port}`);
    },
  );
}

startServer().catch((err) => {
  console.error("[kulgo-api] Failed to start server:", err);
  process.exit(1);
});
