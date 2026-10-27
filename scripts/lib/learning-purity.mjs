// The purity rules of packages/learning (S30, A1 section 2): no I/O, no clock and no randomness
// except an injected RandomSource. eslint.config.js applies them to packages/learning/src only, so
// tests and every other package are unaffected; `just ts-lint` (pnpm -r lint) runs them in CI.
//
// Mechanism: three core ESLint rules cover the ways a module could reach the outside world.
// no-restricted-imports refuses every node: module and the bare Node built-ins that do I/O,
// no-restricted-globals refuses the host globals that do I/O, timing or randomness, and
// no-restricted-properties refuses the clock and random members of otherwise allowed globals
// (Math and Date stay usable for arithmetic and for copying a Date the caller passed in).
// no-restricted-syntax refuses reading the clock through the Date constructor or function with no
// argument, Reflect.construct with Date, and dynamic import. globalThis, global and self are refused
// outright, so the globalThis.Math.random, new globalThis.Date and globalThis.fetch spellings cannot
// reach around the rules above. Each refusal names the injected alternative.
//
// Limits: a lint is best-effort. Aliasing (const D = Date; new D()), computed member access and
// values passed in from outside are beyond what these syntax rules can see. The rule catches the
// common and accidental forms; code review and the tests (fixed vectors, seeded replays and the
// "never reads a clock" rows under fake timers) are the backstop.

/** The files the purity block applies to, relative to the repo root that holds eslint.config.js. */
export const LEARNING_PURITY_FILES = ["packages/learning/src/**/*.ts"];

const PURE_HINT = "packages/learning is pure (A1 section 2)";

/** Node built-ins that do I/O, spawn work or read the environment, by bare name. */
const IO_MODULES = [
  "fs",
  "fs/promises",
  "module",
  "path",
  "os",
  "http",
  "https",
  "http2",
  "net",
  "dgram",
  "dns",
  "tls",
  "child_process",
  "cluster",
  "worker_threads",
  "crypto",
  "process",
  "timers",
  "timers/promises",
  "perf_hooks",
  "readline",
  "stream",
  "url",
  "v8",
  "vm",
];

/**
 * Host globals that do I/O, read time or the environment, or draw randomness, and the global-object
 * aliases (globalThis, global, self) that would reach every other global around these rules.
 */
const IO_GLOBALS = [
  "globalThis",
  "global",
  "self",
  "fetch",
  "process",
  "require",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "clearTimeout",
  "clearInterval",
  "performance",
  "XMLHttpRequest",
  "WebSocket",
  "crypto",
  "console",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "document",
  "window",
  "navigator",
];

/** Members that read the clock or draw randomness from globals that are otherwise allowed. */
const CLOCK_AND_RANDOM_PROPERTIES = [
  { object: "Math", property: "random", message: `${PURE_HINT}: take a RandomSource argument instead.` },
  { object: "Date", property: "now", message: `${PURE_HINT}: take the time as an argument instead.` },
  { object: "performance", property: "now", message: `${PURE_HINT}: take the time as an argument instead.` },
  { object: "Intl", property: "DateTimeFormat", message: `${PURE_HINT}: date formatting reads the clock and locale.` },
  { object: "Temporal", property: "Now", message: `${PURE_HINT}: take the time as an argument instead.` },
];

/** The rule set, one object so the config and the test share the same reference. */
export const LEARNING_PURITY_RULES = Object.freeze({
  "no-restricted-imports": [
    "error",
    {
      paths: IO_MODULES.map((name) => ({ name, message: `${PURE_HINT}: no I/O modules.` })),
      patterns: [{ group: ["node:*"], message: `${PURE_HINT}: no Node built-in modules.` }],
    },
  ],
  "no-restricted-globals": [
    "error",
    ...IO_GLOBALS.map((name) => ({ name, message: `${PURE_HINT}: no I/O, clock or host randomness.` })),
  ],
  "no-restricted-properties": ["error", ...CLOCK_AND_RANDOM_PROPERTIES],
  "no-restricted-syntax": [
    "error",
    {
      selector: "NewExpression[callee.name='Date'][arguments.length=0]",
      message: `${PURE_HINT}: new Date() reads the clock; take the time as an argument.`,
    },
    {
      selector: "CallExpression[callee.name='Date']",
      message: `${PURE_HINT}: Date() reads the clock; take the time as an argument.`,
    },
    {
      selector: "CallExpression[callee.object.name='Reflect'][callee.property.name='construct'][arguments.0.name='Date']",
      message: `${PURE_HINT}: Reflect.construct(Date) can read the clock; take the time as an argument.`,
    },
    { selector: "ImportExpression", message: `${PURE_HINT}: no dynamic import.` },
  ],
});

/** The config block eslint.config.js adds after the shared TypeScript block. */
export function learningPurityBlock() {
  return { files: LEARNING_PURITY_FILES, rules: LEARNING_PURITY_RULES };
}
