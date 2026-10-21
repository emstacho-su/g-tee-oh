// esbuild bundle for the api runtime (R0.7, O-114).
//
// Mechanism: the two entry points are bundled to dist/index.js (the server) and
// dist/openapi-export.js (the document writer). What stays external is decided per bare import
// by isExternal: Node's built-in modules (with or without the node: prefix; node:module's
// isBuiltin knows both) and the packages listed under dependencies in this package.json, which
// the Docker runtime stage has in services/api/node_modules. Everything else is bundled in: the
// workspace packages (@g-tee-oh/*, declared as workspace:* and exporting .ts sources) and
// whatever they import. That last part is why the list exists: openapi-fetch is a dependency of
// @g-tee-oh/contracts, not of the api, so pnpm installs it under packages/contracts/node_modules
// only, where a bare import left in dist/index.js would not resolve at runtime. Relative imports
// are bundled as usual. test/build.test.mjs imports the helpers; the build itself runs only when
// this file is the program node was given.
import { readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(PACKAGE_DIR, "package.json");
const WORKSPACE_PROTOCOL = "workspace:";
const SCOPE_PREFIX = "@";
const NODE_TARGET = "node24";
const OUTPUT_DIRECTORY = "dist";
const ENTRY_POINTS = {
  index: "src/main.ts",
  "openapi-export": "src/openapi-export.ts",
};

/** Matches specifiers that are neither relative (./ ../) nor rooted (/). */
const BARE_SPECIFIER = /^[^./]/;

/** This package's manifest, parsed. */
export function readManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

/** The npm package name of a bare specifier: its first path segment, or two for a scoped one. */
export function packageName(specifier) {
  const nameSegments = specifier.startsWith(SCOPE_PREFIX) ? 2 : 1;
  return specifier.split("/").slice(0, nameSegments).join("/");
}

/**
 * The dependencies of `manifest` that resolve from node_modules at runtime: every entry under
 * dependencies whose version is not a workspace link, as a set of package names.
 */
export function runtimeDependencies(manifest) {
  const entries = Object.entries(manifest.dependencies ?? {});
  const installed = entries.filter(([, version]) => !version.startsWith(WORKSPACE_PROTOCOL));
  return new Set(installed.map(([name]) => name));
}

/** Whether a bare specifier stays external: a Node built-in or a package in `dependencies`. */
export function isExternal(specifier, dependencies) {
  return isBuiltin(specifier) || dependencies.has(packageName(specifier));
}

/** The esbuild plugin that applies isExternal to every bare import. */
export function externalsPlugin(dependencies) {
  return {
    name: "api-externals",
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: BARE_SPECIFIER }, (args) => {
        if (args.kind === "entry-point" || isAbsolute(args.path)) return null;
        return isExternal(args.path, dependencies) ? { path: args.path, external: true } : null;
      });
    },
  };
}

/**
 * The esbuild options shared by the build and its tests; `overrides` adds the input (entryPoints
 * or stdin) and the output settings.
 */
export function buildOptions(dependencies, overrides) {
  return {
    absWorkingDir: PACKAGE_DIR,
    bundle: true,
    platform: "node",
    format: "esm",
    target: NODE_TARGET,
    plugins: [externalsPlugin(dependencies)],
    ...overrides,
  };
}

async function main() {
  const options = buildOptions(runtimeDependencies(readManifest()), {
    entryPoints: ENTRY_POINTS,
    outdir: OUTPUT_DIRECTORY,
    logLevel: "info",
  });
  try {
    await build(options);
  } catch {
    // esbuild already printed the diagnostics at logLevel "info".
    process.exitCode = 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();
