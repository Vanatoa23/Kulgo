import { serve } from "@hono/node-server";
import { createTestApp } from "./app.js";

const port = Number(process.env.PORT ?? 4000);
const webOrigin = process.env.WEB_ORIGIN ?? "http://127.0.0.1:5173";

const app = createTestApp({
  PORT: port,
  WEB_ORIGIN: webOrigin,
});

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(
      `[kulgo-api:memory] Listening on http://127.0.0.1:${info.port} (origin=${webOrigin})`,
    );
  },
);
