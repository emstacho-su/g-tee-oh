// esbuild bundle for the api runtime (R0.7, O-114).
//
// Mechanism: the two entry points are bundled to dist/index.js (the server) and
// dist/openapi-export.js (the document writer). Workspace packages (@g-tee-oh/*) export .ts
// sources, so they are bundled in; every other bare import (npm packages and node: builtins)
// stays external and resolves from node_modules at runtime, which the Docker runtime stage
// copies whole. Relative imports are bundled as usual.
import { isAbsolute } from "node:path";

import { build } from "esbuild";

const WORKSPACE_SCOPE = "@g-tee-oh/";
const NODE_TARGET = "node24";
const ENTRY_POINTS = {
  index: "src/main.ts",
  "openapi-export": "src/openapi-export.ts",
};

/** Matches specifiers that are neither relative (./ ../) nor rooted (/). */
const BARE_SPECIFIER = /^[^./]/;

/** @type {import("esbuild").Plugin} */
const externalizeBareImports = {
  name: "externalize-bare-imports",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: BARE_SPECIFIER }, (args) => {
      const bundled =
        args.kind === "entry-point" || isAbsolute(args.path) || args.path.startsWith(WORKSPACE_SCOPE);
      if (bundled) {
        return null;
      }
      return { path: args.path, external: true };
    });
  },
};

try {
  await build({
    absWorkingDir: import.meta.dirname,
    entryPoints: ENTRY_POINTS,
    outdir: "dist",
    bundle: true,
    platform: "node",
    format: "esm",
    target: NODE_TARGET,
    logLevel: "info",
    plugins: [externalizeBareImports],
  });
} catch {
  // esbuild already printed the diagnostics at logLevel "info".
  process.exitCode = 1;
}
