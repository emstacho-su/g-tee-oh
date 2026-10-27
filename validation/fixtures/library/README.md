# Fixture library

This directory is the host side of the solutions library that the end to end (e2e) job and the compose dev profile mount into the solver-query container (O-62). The mount is read only and the path inside the container is fixed at /fixtures/library. The compose file takes the host path from FIXTURE_LIBRARY_PATH and falls back to this directory when that variable is empty or unset; the e2e job sets it to this directory explicitly. At startup solver-query scans the path, reads every manifest under it and indexes each solution by configuration and pair (O-144), so a request path reads this library and never starts a solve (architecture decision record (ADR) 0018).

## Layout

One directory per solution, in the library format of A3 section 2:

    preflop/<config_id>/<solution_id>/manifest.json
    preflop/<config_id>/<solution_id>/chunks/0000.bin.zst

The manifest names the kind (preflop), the source, the engine version, the configuration and its id, the position pair, each chunk with its sha256 and node count, the tree hash, the seed, the synthetic flag and created_at. The chunk is a zstd-compressed run of preflop_169 node records (169 hand classes per node); .gitattributes marks .zst files binary. The solution id is derived from the sha256 of the node dump the solution was packed from (O-131), so packing the same dump twice gives the same id and the same bytes.

## What it holds (session S19)

132 solutions, about 1.2 MB, in two groups.

| Group | Directories | Solutions | Source and flag | Produced by |
|---|---|---|---|---|
| Gate G6a push/fold (R2.19) | `preflop/cfg_2_online_norake_<d>/`, d from 1 to 15 bb, pair BB-BTN | 15 | source own, synthetic false, seed 0, the certificate's exploitability | `just g6a-pack` |
| Synthetic sets (R2.20) | `preflop/cfg_6_online_100/`, `_150/`, `_200/` (15 pairs each); `preflop/cfg_9_live_13_100/` and `preflop/cfg_9_live_25_100/` (36 pairs each) | 117 | source reference, engine label synthetic, synthetic true, the set seed | `just fixtures` |

The G6a solutions are the exact heads-up push/fold equilibrium at each depth: the game is rake-free with no ante, both stacks d big blinds before the blinds, the button folding or moving all-in and the big blind folding or calling (O-220). `validate g6a-pack` solves the class game with exact card removal from the committed equity table, refines the support to the indifference equations, certifies each seat's best-response gain at or below 1e-9 big blinds (O-223), dumps the result and packs it here. `just g6a` and `just g6a-check` solve again and fail when a committed solution no longer decodes to the recomputation within the O-133 tolerances (frequency within 1/255, expected value exact as f32), or when its manifest's tree hash or node count no longer matches the recomputed dump (the checks of `library_pack::verify`). `validation/fixtures/PROVENANCE-g6a.md` has the game, the published chart it is compared with and why that chart is not committed (O-221).

The synthetic solutions are labeled test data, never reference solutions (O-57): real gto-tree pair trees from the seed sizing conventions (O-136), filled with a seeded score-band strategy (O-226) and pot-share expected values (O-224), so the trainer, solver-query and the integration tests have real tree shapes and node keys to run against. `tools/fixture-gen` builds them from `validation/fixtures/synthetic/sets.json`; that directory's README describes the model and the three sets. The 6-max set includes BB-BTN at 100 big blinds, the line S20 smoke-builds from (O-52, O-61), and the two live sets hold the same lines at 1/3 and 2/5 under different configuration ids, with the stakes' own rake caps (R3.21). `just fixtures-check`, which the rust job and `just ci` run, regenerates the sets into target/fixtures-check and byte-compares every synthetic configuration directory with this one, failing on a changed, missing or extra file.

Nothing here is edited by hand. To change a solution, change its producer, rerun the recipe and commit what it wrote.

## How it is checked

- services/solver-query/tests/r2_20_fixture_library.rs scans this directory with the real reader: 15 G6a solutions plus 117 synthetic ones indexed, every checksum verified, both push/fold nodes of each G6a depth read, and a synthetic BB-BTN root read in each set with the synthetic flag surfaced.
- The smoke script (infra/compose/smoke.mjs, run by just smoke and the e2e job) proves the mount from inside the container: the solver-query health response carries a fixture_library block with the configured path and whether that directory exists there, and the check fails unless it reports path /fixtures/library with present true. It then reads this library through solver-query (infra/compose/library-reads.mjs): GET /v1/coverage for cfg_2_online_norake_10 and for cfg_6_online_100, both BB-BTN, must each list exactly one solution from the fixture registry, whose manifest here says synthetic false and true respectively, and GET /v1/nodes on the G6a solution at its root key cfg_2_online_norake_10/BB-BTN/ must answer 200 with the fold and all-in actions over 169 hands.

## Serving another library

FIXTURE_LIBRARY_PATH in .env points the compose mount elsewhere, for example at target/fixtures/library, which `just fixture-synthetic` fills with a seeded synthetic dump (O-149). The smoke's library reads expect the solutions above, so they fail against a library that lacks them, and say which configuration had no solution.
