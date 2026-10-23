import { loadConfig } from "./config";
import { createPgDb } from "./db";
import { createLogger } from "./logger";
import { createCollabServer } from "./server";

async function main() {
  const config = loadConfig();
  const log = createLogger(config.logLevel);
  const db = createPgDb(config.databaseUrl);
  if (!(await db.ping())) {
    log.error("cannot reach the database; check COLLAB_DATABASE_URL");
    process.exit(1);
  }
  if (config.allowedOrigins.length === 0) {
    log.warn("COLLAB_ALLOWED_ORIGINS is empty; accepting WebSocket connections from any origin");
  }
  const collab = createCollabServer(config, db, log);
  await collab.listen();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutting down", { signal });
    const force = setTimeout(() => process.exit(1), 15_000);
    try {
      await collab.stop();
      await db.close();
      clearTimeout(force);
      process.exit(0);
    } catch (err) {
      log.error("error during shutdown", { err });
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("unhandledRejection", (err) => log.error("unhandled rejection", { err: err as Error }));
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
