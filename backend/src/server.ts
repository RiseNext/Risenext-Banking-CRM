import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { closeDb, getDb } from "./db/index.js";
import { logger } from "./lib/logger.js";
import { sql } from "drizzle-orm";

async function main(): Promise<void> {
  const config = env();

  try {
    await getDb().execute(sql`select 1`);
    logger.info("Database connection verified");
  } catch (error) {
    logger.error({ err: error }, "Cannot reach the database — refusing to start");
    process.exit(1);
  }

  const server = createApp().listen(config.PORT, () => {
    logger.info(`API listening on port ${config.PORT} (${config.NODE_ENV})`);
  });

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, draining connections`);
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error) => {
  logger.error({ err: error }, "Fatal startup error");
  process.exit(1);
});
