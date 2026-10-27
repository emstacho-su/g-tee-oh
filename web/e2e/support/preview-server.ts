/**
 * Whether a Playwright run needs the harness preview server (R3.13, O-264, O-267).
 *
 * Playwright's webServer option is config-wide: when it is set, every run starts it, whatever
 * projects are selected. The mock, bench and shots projects drive `vite preview` of the harness
 * build on port 4173; the stack project drives the Compose stack through Caddy and must never
 * build or start the preview. playwright.config.ts therefore sets webServer only when this
 * returns true. The decision reads the --project arguments of the command line the config is
 * loaded under (both `--project=mock` and `--project mock`): no --project means every project
 * runs, so the server is needed; a selection that is only "stack" means it is not; anything
 * else (mock, bench, shots, a pattern) means it is. PW_PREVIEW=1 forces it on and PW_PREVIEW=0
 * forces it off, for a run whose arguments do not say (a wrapper, an editor integration).
 */
export const STACK_PROJECT = "stack";
const PROJECT_FLAG = "--project";
const PROJECT_FLAG_JOINED = `${PROJECT_FLAG}=`;
const PREVIEW_VARIABLE = "PW_PREVIEW";
const FORCE_ON = "1";
const FORCE_OFF = "0";

export type PreviewEnvironment = Readonly<Record<string, string | undefined>>;

/** The project names given on the command line, in order; empty when none were given. */
export function selectedProjects(argv: readonly string[]): string[] {
  return argv.flatMap((argument, index) => {
    if (argument.startsWith(PROJECT_FLAG_JOINED)) return [argument.slice(PROJECT_FLAG_JOINED.length)];
    if (argument === PROJECT_FLAG) {
      const value = argv[index + 1];
      return value === undefined ? [] : [value];
    }
    return [];
  });
}

/** True when the run selects a project that drives the preview server; see the header. */
export function needsPreviewServer(argv: readonly string[], env: PreviewEnvironment): boolean {
  const forced = env[PREVIEW_VARIABLE];
  if (forced === FORCE_ON) return true;
  if (forced === FORCE_OFF) return false;
  const projects = selectedProjects(argv);
  return projects.length === 0 || projects.some((project) => project !== STACK_PROJECT);
}
