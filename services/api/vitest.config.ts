// Vitest configuration for the api (R3.1). The global setup starts one Postgres test container
// per run (test/support/global-setup.ts); coverage is measured over src, without the three process
// entry points, which only wire configuration to buildApp (or, for create-user, to the tested
// cli/create-user-args.ts and auth/users.ts) and are exercised by the e2e job.
import { defineConfig } from "vitest/config";

const CONTAINER_START_TIMEOUT_MS = 180_000;
const TEST_TIMEOUT_MS = 30_000;

export default defineConfig({
  test: {
    globalSetup: ["./test/support/global-setup.ts"],
    hookTimeout: CONTAINER_START_TIMEOUT_MS,
    testTimeout: TEST_TIMEOUT_MS,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/main.ts", "src/openapi-export.ts", "src/cli/create-user.ts"],
      reporter: ["text-summary", "text"],
    },
  },
});
