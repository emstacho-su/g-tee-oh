// The fixture library reads of the smoke (R2.19, R2.20, O-62): what infra/compose/smoke.mjs asks
// solver-query about the committed library at validation/fixtures/library once the stack is up,
// and the pure checks of each answer. No input/output here, so scripts/library-reads.test.mjs
// covers every rule without a running stack.
//
// Mechanism: solver-query publishes no port (only Caddy does, A5 section 1), so the smoke reaches it
// on the compose network from inside the api container, whose image carries Node: `compose exec api
// node -e FETCH_SCRIPT <url>` fetches the URL and prints one JSON (JavaScript Object Notation) line
// with the status and the body text. Three reads follow. GET /v1/coverage for the G6a 10bb
// configuration and for the synthetic 6-max 100bb configuration, both BB-BTN, must each list exactly
// one preflop solution served from the fixture registry. The HTTP (Hypertext Transfer Protocol)
// answer carries no synthetic flag, so the flag is read from that solution's manifest under the
// host directory the compose file mounts (FIXTURE_LIBRARY_PATH, else validation/fixtures/library):
// false for G6a, true for the synthetic set (O-57). Then GET /v1/nodes on the G6a solution at its
// root key must answer 200 with the 169 hand classes and the fold and all-in actions.

/** The solver-query base URL on the compose network (compose.yaml, SOLVER_QUERY_BIND port 7070). */
export const SOLVER_QUERY_URL = "http://solver-query:7070";
/** The compose service that runs the fetches: it carries Node and sits on the network gto. */
export const FETCH_SERVICE = "api";
/** Printed by FETCH_SCRIPT: {"status": <number>, "body": <text>} on one line; exit 1 on a network error. */
export const FETCH_SCRIPT =
  "fetch(process.argv[1]).then(async (r) => { process.stdout.write(JSON.stringify({ status: r.status, body: await r.text() })); })" +
  ".catch((e) => { process.stderr.write(String(e && e.message)); process.exit(1); });";

/** The pair every read uses (out of position first). */
export const PAIR = "BB-BTN";
/** Hand classes at a preflop_169 node. */
export const HAND_CLASSES = 169;
/** The coverage source of a solution the startup scan of FIXTURE_LIBRARY_PATH indexed. */
export const FIXTURE_SOURCE = "fixture";
/** The G6a push/fold solution the smoke reads (O-220): rake-free heads-up at 10 bb. */
export const G6A = { configId: "cfg_2_online_norake_10", synthetic: false };
/** A synthetic set's configuration (O-225): online 6-max at 100 bb, the S20 smoke line. */
export const SYNTHETIC = { configId: "cfg_6_online_100", synthetic: true };
/** The G6a root: the button to act with fold or all-in (A3 section 1: the preflop root ends in "/"). */
export const G6A_ROOT_KEY = `${G6A.configId}/${PAIR}/`;
/** The action tokens at the G6a root, passive first. */
export const G6A_ROOT_TOKENS = ["f", "a"];
/** The library root the compose file mounts when FIXTURE_LIBRARY_PATH is empty or unset. */
export const DEFAULT_LIBRARY_PATH = "validation/fixtures/library";

// Solution ids are lowercase UUID-shaped (O-131); checked before one becomes part of a path or a URL.
const SOLUTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** GET /v1/coverage for one configuration and pair. */
export function coverageUrl(configId, pair = PAIR) {
  const query = new URLSearchParams({ config_id: configId, pair });
  return `${SOLVER_QUERY_URL}/v1/coverage?${query}`;
}

/** GET /v1/nodes for one solution at one node key. */
export function nodesUrl(solutionId, nodeKey) {
  const query = new URLSearchParams({ solution_id: solutionId, node_key: nodeKey });
  return `${SOLVER_QUERY_URL}/v1/nodes?${query}`;
}

/** The manifest path of a solution, relative to the library root (A3 section 2 layout). */
export function manifestPath(configId, solutionId) {
  return `preflop/${configId}/${solutionId}/manifest.json`;
}

/** The FETCH_SCRIPT output as { status, body }; throws when it is not that shape. */
export function parseFetchOutput(source, stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${source} printed no JSON: ${error.message}; output "${stdout.trim()}"`);
  }
  if (!Number.isInteger(parsed?.status) || typeof parsed.body !== "string") {
    throw new Error(`${source} printed ${JSON.stringify(parsed)}, expected { status, body }`);
  }
  return parsed;
}

/**
 * The one preflop solution a coverage answer lists, served from the fixture registry.
 * Throws naming what differs: a non-200 status, no or several solutions, another source or an id
 * that is not UUID-shaped.
 */
export function singleFixtureSolution(configId, response) {
  const what = `GET /v1/coverage ${configId} ${PAIR}`;
  if (response.status !== 200) {
    throw new Error(`${what} answered HTTP ${response.status} "${response.body.trim()}"`);
  }
  const preflop = parseBody(what, response.body)?.preflop;
  const ids = Array.isArray(preflop?.solution_ids) ? preflop.solution_ids : [];
  if (ids.length !== 1) {
    throw new Error(`${what} lists ${ids.length} preflop solutions (${ids.join(", ") || "none"}), expected 1`);
  }
  const source = preflop.sources?.[0];
  if (source !== FIXTURE_SOURCE) {
    throw new Error(`${what} lists source ${JSON.stringify(source)}, expected "${FIXTURE_SOURCE}"`);
  }
  if (!SOLUTION_ID_PATTERN.test(ids[0])) {
    throw new Error(`${what} lists solution id ${JSON.stringify(ids[0])}, not a lowercase UUID`);
  }
  return ids[0];
}

/** Checks a manifest's synthetic flag; an absent flag reads as false, as solver-query reads it. */
export function checkSyntheticFlag(source, manifest, expected) {
  if (manifest?.synthetic !== undefined && typeof manifest.synthetic !== "boolean") {
    throw new Error(`${source} synthetic is ${JSON.stringify(manifest.synthetic)}, not a boolean`);
  }
  const synthetic = manifest?.synthetic ?? false;
  if (synthetic !== expected) {
    throw new Error(`${source} says synthetic ${synthetic}, expected ${expected}`);
  }
  return synthetic;
}

/** Checks the G6a root node answer: 200, the root key, fold and all-in, 169 hand rows. */
export function checkG6aRoot(response) {
  const what = `GET /v1/nodes ${G6A_ROOT_KEY}`;
  if (response.status !== 200) {
    throw new Error(`${what} answered HTTP ${response.status} "${response.body.trim()}"`);
  }
  const body = parseBody(what, response.body);
  if (body?.node_key !== G6A_ROOT_KEY) {
    throw new Error(`${what} answered node_key ${JSON.stringify(body?.node_key)}`);
  }
  const tokens = Array.isArray(body.actions) ? body.actions.map((action) => action?.token) : [];
  if (tokens.join(",") !== G6A_ROOT_TOKENS.join(",")) {
    throw new Error(`${what} lists actions ${JSON.stringify(tokens)}, expected ${JSON.stringify(G6A_ROOT_TOKENS)}`);
  }
  const hands = Array.isArray(body.hands) ? body.hands.length : 0;
  if (hands !== HAND_CLASSES) {
    throw new Error(`${what} lists ${hands} hands, expected ${HAND_CLASSES}`);
  }
  return hands;
}

function parseBody(what, text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${what} did not answer JSON: ${error.message}; body "${text.trim()}"`);
  }
}
