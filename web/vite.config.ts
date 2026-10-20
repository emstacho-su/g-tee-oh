/// <reference types="vitest/config" />
// Vite build and dev server for the web package, plus the vitest block (R0.7).
//
// Mechanism: vite reads this file for `vite`, `vite build` and the dev server; vitest reads the
// same file and takes its options from the `test` key. The reference line above only adds the
// `test` key to vite's config type for the type checker; at run time nothing from vitest is
// imported, so `vite build` also works inside the Docker build stage, which installs the web
// package's own dependencies and never the root devDependencies. The include pattern keeps
// vitest on test/ so the Playwright file under e2e/ is never collected by it.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const DEV_SERVER_PORT = 5173;

export default defineConfig({
  plugins: [react()],
  server: {
    port: DEV_SERVER_PORT,
  },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
