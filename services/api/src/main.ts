/**
 * Runtime entry point (R0.7, R3.1): reads the process configuration (failing fast on a bad
 * variable), opens the database as app_login (O-28), builds the app with the logger on, listens
 * on API_PORT and closes cleanly on SIGTERM (what compose sends) and SIGINT (what a terminal
 * sends). esbuild bundles this file to dist/index.js (build.mjs, O-114).
 */
import { buildApp } from "./app.js";
import { LISTEN_HOST, loadProcessConfig } from "./config.js";
import { createDatabase } from "./db.js";

const SHUTDOWN_SIGNALS = ["SIGTERM", "SIGINT"] as const;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let processConfig;
try {
  processConfig = loadProcessConfig(process.env);
} catch (error: unknown) {
  console.error(`api failed to start: ${describeError(error)}`);
  process.exit(1);
}

const database = createDatabase(processConfig.database);
const app = buildApp({ logger: true, config: processConfig.app, database });

function shutdown(signal: NodeJS.Signals): void {
  app.log.info({ signal }, "api shutting down");
  app
    .close()
    .then(() => database.destroy())
    .then(
      () => {
        process.exit(0);
      },
      (error: unknown) => {
        app.log.error(error, "api failed to close");
        process.exit(1);
      },
    );
}

for (const signal of SHUTDOWN_SIGNALS) {
  process.once(signal, shutdown);
}

try {
  await app.listen({ host: LISTEN_HOST, port: processConfig.port });
} catch (error: unknown) {
  app.log.error(error, "api failed to start");
  process.exit(1);
}
