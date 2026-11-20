import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { HttpArcadeDbClient } from "./db/client.js";

const config = loadConfig();
const db = new HttpArcadeDbClient({
  url: config.ARCADEDB_URL,
  database: config.ARCADEDB_DATABASE,
  user: config.ARCADEDB_USER,
  password: config.ARCADEDB_PASSWORD,
});

const app = createApp({ config, db });

serve(
  {
    fetch: app.fetch,
    port: config.PORT,
  },
  (info) => {
    console.log(`[kulgo-api] Listening on http://127.0.0.1:${info.port}`);
  },
);
