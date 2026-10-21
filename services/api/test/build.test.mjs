// Tests for build.mjs (R0.7, O-114): what the api bundle keeps external and what it bundles.
// Only the api's own dependencies and Node's built-in modules resolve from node_modules inside
// the runtime image, so everything a bundled workspace package imports (openapi-fetch through
// @g-tee-oh/contracts) must be bundled in, or dist/index.js fails to start. The bundle test
// hands esbuild a small entry through stdin with the api package as its resolve directory, so
// the real workspace links and node_modules decide the resolution, and reads the output in
// memory. A plain .mjs test, run by vitest, because build.mjs is plain JavaScript.
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { describe, expect, it } from "vitest";

import {
  buildOptions,
  isExternal,
  packageName,
  readManifest,
  runtimeDependencies,
} from "../build.mjs";

const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE_ENTRY = [
  'import { createApiClient } from "@g-tee-oh/contracts";',
  'import Fastify from "fastify";',
  "export const probe = [createApiClient, Fastify];",
  "",
].join("\n");
const API_DEPENDENCIES = new Set(["fastify", "@fastify/swagger"]);
const EXTERNAL_SPECIFIERS = [
  "node:fs",
  "fs",
  "node:path",
  "fs/promises",
  "fastify",
  "@fastify/swagger",
  "@fastify/swagger/lib/x.js",
];
const BUNDLED_SPECIFIERS = [
  "openapi-fetch",
  "@g-tee-oh/contracts",
  "@g-tee-oh/learning",
  "zod",
  "fastify-type-provider-zod",
];

// An import statement for a package as esbuild writes it for an external: `import x from "pkg"`
// or `import "pkg"`.
const importOf = (name) => new RegExp(`(import|from)\\s+"${name}"`);

/** The bundled text for one entry, resolved from the api package directory. */
async function bundle(contents) {
  const result = await build(
    buildOptions(runtimeDependencies(readManifest()), {
      stdin: { contents, resolveDir: PACKAGE_DIR, loader: "ts" },
      write: false,
      logLevel: "silent",
    }),
  );
  const [output] = result.outputFiles;
  if (output === undefined) throw new Error("esbuild wrote no output");
  return output.text;
}

describe("@g-tee-oh/api build", () => {
  it("R0.7 runtimeDependencies keeps npm dependencies and drops workspace links", () => {
    const dependencies = runtimeDependencies({
      dependencies: { fastify: "^5.0.0", "@g-tee-oh/contracts": "workspace:*", zod: "^4.0.0" },
    });
    expect([...dependencies].sort()).toEqual(["fastify", "zod"]);
    expect([...runtimeDependencies({})]).toEqual([]);

    const real = runtimeDependencies(readManifest());
    expect(real.has("fastify")).toBe(true);
    expect(real.has("@g-tee-oh/contracts")).toBe(false);
    expect(real.has("openapi-fetch")).toBe(false);
  });

  it("R0.7 packageName takes the first segment, or two for a scoped package", () => {
    expect(packageName("fastify")).toBe("fastify");
    expect(packageName("fastify/lib/x.js")).toBe("fastify");
    expect(packageName("@fastify/swagger")).toBe("@fastify/swagger");
    expect(packageName("@fastify/swagger/lib/x.js")).toBe("@fastify/swagger");
  });

  it("R0.7 isExternal: node built-ins and the api's own dependencies only", () => {
    for (const specifier of EXTERNAL_SPECIFIERS) {
      expect(isExternal(specifier, API_DEPENDENCIES), specifier).toBe(true);
    }
    for (const specifier of BUNDLED_SPECIFIERS) {
      expect(isExternal(specifier, API_DEPENDENCIES), specifier).toBe(false);
    }
  });

  it("R0.7 openapi-fetch via @g-tee-oh/contracts is bundled, fastify stays external", async () => {
    const text = await bundle(FIXTURE_ENTRY);

    expect(text).not.toMatch(importOf("openapi-fetch"));
    expect(text).not.toMatch(importOf("@g-tee-oh/contracts"));
    expect(text).toMatch(importOf("fastify"));
    // The contracts package's own code and openapi-fetch's are both in the output.
    expect(text).toContain("InvalidBaseUrlError");
    expect(text).toContain("querySerializer");
  });
});
