/**
 * Runtime entry point (R0.7, R3.1): reads the process configuration (failing fast on a bad
 * variable), opens the database as app_login (O-28), starts the LISTEN connection behind GET
 * /events (O-243; closed after the app on shutdown), builds the app with the logger on, listens
 * on API_PORT and closes cleanly on SIGTERM (what compose sends) and SIGINT (what a terminal
 * sends). esbuild bundles this file to dist/index.js (build.mjs, O-114).
 *
 * S31 (O-275, PM condition): the app_job worker starts here, once the server listens, and nowhere
 * else (never from buildApp or a request); shutdown stops it before the app closes.
 */
import { buildApp } from "./app.js";
import { LISTEN_HOST, loadProcessConfig } from "./config.js";
import { createDatabase } from "./db.js";
import { createPgNotificationSource, LISTEN_APPLICATION_NAME } from "./events/pg-source.js";
import { startJobWorker, type JobWorker } from "./jobs/worker.js";
import { createAnthropicModel } from "./explain/anthropic-model.js";
import { createSolverQuery } from "./solver-query/client.js";

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
const solverQuery = createSolverQuery(processConfig.solverQueryUrl, { timeoutMs: processConfig.solverQueryTimeoutMs });
// One LISTEN connection per process for GET /events and the builder state (O-243), as the same
// app login; LISTEN needs no grant. It connects in the background and reconnects on its own.
const notifications = createPgNotificationSource({
  host: processConfig.database.host,
  port: processConfig.database.port,
  database: processConfig.database.database,
  user: processConfig.database.user,
  password: processConfig.database.password,
  application_name: LISTEN_APPLICATION_NAME,
});
// Ask (O-305): the model adapter exists only when the flag is on; loadProcessConfig already refused
// the flag without a key. The key goes to the adapter and nowhere else.
const modelClient =
  processConfig.app.explainAskEnabled && processConfig.anthropicApiKey !== null
    ? createAnthropicModel({ apiKey: processConfig.anthropicApiKey, model: processConfig.app.askModel })
    : undefined;
const app = buildApp({
  logger: true,
  config: processConfig.app,
  database,
  solverQuery,
  notifications,
  ...(modelClient === undefined ? {} : { modelClient }),
});
notifications.start(app.log);
let jobWorker: JobWorker | undefined;

function shutdown(signal: NodeJS.Signals): void {
  app.log.info({ signal }, "api shutting down");
  const stopped = jobWorker === undefined ? Promise.resolve() : jobWorker.stop();
  stopped
    .then(() => app.close())
    .then(() => notifications.close())
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
  jobWorker = startJobWorker(app, { timeZone: processConfig.app.timeZone });
} catch (error: unknown) {
  app.log.error(error, "api failed to start");
  process.exit(1);
}
