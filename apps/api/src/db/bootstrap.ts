import { loadConfig } from "../config.js";
import { HttpArcadeDbClient } from "./client.js";
import { bootstrapSchema } from "./schema.js";

async function main() {
  const config = loadConfig();
  const client = new HttpArcadeDbClient({
    url: config.ARCADEDB_URL,
    database: config.ARCADEDB_DATABASE,
    user: config.ARCADEDB_USER,
    password: config.ARCADEDB_PASSWORD,
  });

  console.log(
    `[kulgo-db] Bootstrapping ArcadeDB schema at ${config.ARCADEDB_URL} (db: ${config.ARCADEDB_DATABASE})...`,
  );
  await bootstrapSchema(client);
  console.log("[kulgo-db] Schema bootstrap complete.");
}

main().catch((err) => {
  console.error("[kulgo-db] Schema bootstrap failed:", err);
  process.exit(1);
});
