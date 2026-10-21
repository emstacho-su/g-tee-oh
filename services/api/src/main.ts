/**
 * Runtime entry point (R0.7): builds the app with the logger on, listens on API_PORT and closes
 * cleanly on SIGTERM (what compose sends) and SIGINT (what a terminal sends). esbuild bundles this
 * file to dist/index.js (build.mjs, O-114).
 */
import { buildApp } from "./app.js";
import { LISTEN_HOST, parseApiPort } from "./config.js";

const SHUTDOWN_SIGNALS = ["SIGTERM", "SIGINT"] as const;

const app = buildApp({ logger: true });

function shutdown(signal: NodeJS.Signals): void {
  app.log.info({ signal }, "api shutting down");
  app.close().then(
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
  const port = parseApiPort(process.env.API_PORT);
  await app.listen({ host: LISTEN_HOST, port });
} catch (error: unknown) {
  app.log.error(error, "api failed to start");
  process.exit(1);
}
