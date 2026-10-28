# Validation reports

This directory holds the reports that prove requirement identifiers (R IDs) for the public gates (A1 section 1 reserves `validation/reports/` for generated gate reports, public gates only). A report is evidence, so two rules apply:

1. A report is written by the tool that measured it, never by hand. `just bench` writes `bench-zenbook.json` through `scripts/bench-report.mjs`; `just library-size-estimate` writes `library-size-estimate.md` through `library-pack estimate` (S14); the Phase 2 validation gates G1 to G7 (04 section 6) write theirs through `tools/validate`, G1 to G3 since S13 as JSON reports with tool-written Markdown twins (the gate reports section below). To change a number, check out the commit you want on record, rerun the tool and commit what it wrote. The phase summaries (`phase-0-gate.md`, and `mac-bootstrap.md` once S04 lands) are the exception in form only: the session that closes a phase gate writes them from tool output and run links, and they are not edited after the gate closes.
2. Every report names the R IDs it proves: the `r_ids` field in a JSON (JavaScript Object Notation) report, the R ID column in a Markdown gate report. A reviewer can then go from a requirement to its evidence without reading the tool.

S05 added the schema every JSON report follows and the table of report files (R0.11). Later sessions add their report kinds below as they write them: S13 added the G1 to G3 gate reports, S17 the G4 report, S19 the G6a report and the preflop spike, S29 adds the Phase 3 reports.

## Benchmark reports: `bench-<machine>.json` (R0.10)

Produced by `just bench`. `cargo bench -p gto-solve -p gto-library -p solver-query --features gto-library/synthetic` runs the three criterion targets A9 section 1 names (solve iteration, chunk decode, node read) and the grade bench S16 added (one `POST /v1/grade` through the solver-query router, O-154), six bench ids in all since S16, each writing `target/criterion/<group>/<function>/new/estimates.json`; `node scripts/bench-report.mjs` then reads every such file plus the `benchmark.json` and `sample.json` beside it and writes the report. The script refuses to write when no estimate exists and when one of the six ids is missing, so the committed file is always one complete run. `BENCH_MACHINE=<name>` changes the machine name and the file name; the default is `zenbook`, the baseline the phase docs call the Zenbook baseline, which later becomes the 95th percentile latency (p95) guard baseline (O-40).

Top-level fields, in the order the file carries them:

| Field | Type | Meaning |
|---|---|---|
| `report` | string | Always `bench`. |
| `r_ids` | string array | The R IDs the file proves; `["R0.10", "R2.13"]` since the grade bench joined. |
| `machine.name` | string | The machine label, also the file name suffix. |
| `machine.os` | string | Node's `os.platform()` and `os.release()`, space separated (operating system and kernel release). |
| `machine.cpu` | string | The model string of the first central processing unit (CPU) core. |
| `machine.cores` | integer | Logical cores, `os.cpus().length`. |
| `machine.memory_gb` | integer | Physical memory in gibibytes, rounded. |
| `commit` | string | `git rev-parse HEAD` when the report was written, 40 hex characters. |
| `date` | string | When the report was written, ISO 8601 in Coordinated Universal Time (UTC). |
| `toolchain` | string | `rustc --version` of the compiler that built the benches. |
| `measurements` | object array | One entry per bench id, sorted by id. |

Each measurement:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | The criterion id, `<group>/<function>`. |
| `mean_ns` | number | criterion's mean point estimate of one routine call, nanoseconds. |
| `median_ns` | number | criterion's median point estimate of one routine call, nanoseconds. |
| `unit` | string | Always `ns`. |
| `stub` | boolean | True when the id ends in `/stub`: the routine is a placeholder and the number is not a product measurement. False for every v1 id since S14 replaced the two stubs; the field stays so a later placeholder is marked. |
| `p95_ns` | number, when present | The nearest-rank 95th percentile of one routine call's time, nanoseconds: criterion's `new/sample.json` holds every sample's iteration count and total time, each sample's time over its count is one per-iteration time, and the value at rank `ceil(0.95 n)` of those sorted ascending is reported (O-154). Written for every id whose run left a `sample.json`, which every criterion run does; `scripts/check-reports.mjs` holds `grade/warm_cache` to 30,000,000 ns, the A9 section 6 grade budget (O-86). |

The six ids in v1 (S14 replaced the `chunk_decode/stub` and `node_read/stub` placeholders with the library format, R2.7; S16 added the grade bench, R2.13):

| id | Measures | Status |
|---|---|---|
| `solve_iteration/simple_tree_flop` | One discounted counterfactual regret minimization (DCFR) iteration of the vendored engine on a small simple-tree heads-up flop spot; the spot is described in `crates/gto-solve/benches/solve_iteration.rs`. | Real measurement. |
| `chunk_decode/preflop_169` | One data frame of a library file (about 64 KiB of dense 169-hand preflop records, seed 0 synthetic tree) decompressed with `decode_frame` and every record in it decoded; `crates/gto-library/benches/chunk_decode.rs`. | Real measurement, synthetic data. |
| `chunk_decode/postflop_1326_sparse` | The same for a frame of flop records that hold half of the live combos. | Real measurement, synthetic data. |
| `node_read/warm_cache` | One `Reader::node` read of a preflop node whose frame sits in the least recently used (LRU) cache: key hash, index lookup and record decode; `crates/gto-library/benches/node_read.rs`. | Real measurement, synthetic data. |
| `node_read/cold_cache` | The same read through a reader whose cache holds 0 bytes, so every read fetches the frame from the in-memory store and decompresses it: the cost of a cache miss. | Real measurement, synthetic data. |
| `grade/warm_cache` | One `POST /v1/grade` through the solver-query router in process over the packed synthetic fixture of the integration tests (seed 7, 40 dense preflop nodes): the request-id and latency middleware, JSON parsing, key and hand parsing, the reader's warm-cache node read, the grade math and the serialization, no socket; `services/solver-query/benches/grade.rs`. Its `p95_ns` is held under 30 ms by `just report-check` (A9 section 6, O-154, O-86). | Real measurement, synthetic data. |

Example, shortened:

```json
{
  "report": "bench",
  "r_ids": ["R0.10", "R2.13"],
  "machine": { "name": "zenbook", "os": "win32 10.0.26200", "cpu": "...", "cores": 20, "memory_gb": 32 },
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "date": "2026-10-20T18:00:00.000Z",
  "toolchain": "rustc 1.99.1 (58cf8f9c3 2026-10-13)",
  "measurements": [
    { "id": "chunk_decode/postflop_1326_sparse", "mean_ns": 9800.5, "median_ns": 9700.0, "unit": "ns", "stub": false },
    { "id": "chunk_decode/preflop_169", "mean_ns": 1500.2, "median_ns": 1480.0, "unit": "ns", "stub": false },
    { "id": "grade/warm_cache", "mean_ns": 24000.0, "median_ns": 23500.0, "unit": "ns", "stub": false, "p95_ns": 26000.0 },
    { "id": "node_read/cold_cache", "mean_ns": 2200.0, "median_ns": 2100.0, "unit": "ns", "stub": false },
    { "id": "node_read/warm_cache", "mean_ns": 95.5, "median_ns": 95.0, "unit": "ns", "stub": false },
    { "id": "solve_iteration/simple_tree_flop", "mean_ns": 21500000.5, "median_ns": 21000000.0, "unit": "ns", "stub": false }
  ]
}
```

Reading a baseline: compare `median_ns` of the same id across commits on the same machine; the mean is kept because criterion reports both and outliers move it first. Numbers from different machines are different baselines, never a regression.

## Library size estimate: `library-size-estimate.md` (R2.7, R-19)

Produced by `just library-size-estimate`, which runs `library-pack estimate --seed <n> --out
validation/reports/library-size-estimate.md` (`tools/library-pack/src/estimate.rs`). Rule 1
applies: the tool writes the whole file, and the committed report carries the seed, so rerunning
the recipe at the recorded commit with that seed gives the same bytes.

What the tool does, in order: `gto_library::synthetic_tree` builds one turn and river runout
tree and one flop tree per scenario (pessimistic, central, optimistic: node counts, range share,
pure share and action counts around the planning figures of 02 section 5.2) from the seed;
`NodeRecord::from_solved` quantizes them into the records the writer stores; `encode_file`
turns the records into a file at the writer's setting (zstd level 19, 64 KiB frames), at level 3
and at 256 KiB frames (O-129). The report states that method, the inputs and the seed, then one
table per tree kind (raw bytes, file bytes, ratio, bytes per node) and a last table that sets
each scenario against the plan: 1 to 10 MB per runout, 40 KB to 342 KB per flop tree, one build
of 4 lines with K = 20 runouts, and the 650 GB budget of O-51.

The data is synthetic (O-57) and the report says so in its first line: it bounds the format's
bytes per node, not a solver's output, and S20 replaces it with measured bytes (O-51). It is
Markdown, not JSON, so `report.schema.json` does not apply; the R ID line in the report stands
in for `r_ids`.

## Report schema: `report.schema.json` (R0.11)

Every JSON report in this directory validates against `report.schema.json`, a JSON Schema (draft 2020-12). The schema fixes the envelope, so a reviewer or a tool (the `just v1-gate` check in S34, R4.17) reads every report the same way; the measurement ids and the thresholds inside the envelope are each report's own and are documented in that report's section of this file. Markdown files do not use the schema: a gate report's Markdown twin is rendered by the tool from the same value as its JSON file, and the phase summaries in the table below carry the R ID column instead.

The envelope, in the order a report carries the fields:

| Field | Type | Required | Meaning |
|---|---|---|---|
| `report` | string | yes | The report id: the file name without the machine suffix and the extension. `bench-zenbook.json` carries `bench`, `perf-zenbook.json` carries `perf`, `recompute.json` carries `recompute`. |
| `r_ids` | string array | yes | The R IDs the report proves, `R<phase>.<n>`, at least one, no duplicates. |
| `machine` | object | yes | `name`, `os`, `cpu`, `cores` and `memory_gb` as the benchmark section above defines them. A tool may add fields, for example the Docker virtual machine memory on the Mac (O-20). |
| `commit` | string | yes | `git rev-parse HEAD` when the report was written, 40 hex characters. |
| `date` | string | yes | When the report was written, ISO 8601 in UTC with the `Z` suffix. |
| `toolchain` | string | no | The compiler or runtime that built what was measured. |
| `pass` | boolean | gate reports | True when every measurement meets its threshold. |
| `thresholds` | object | gate reports | The limits the measurements were judged against, keyed by measurement id or by a named limit. Each value is a number in the measurement's unit, or an object with `max` or `min` and `unit`. |
| `measurements` | object array | yes | One entry per measured quantity, at least one. |
| `seed` | integer or string | no | The seed of a seeded sample, for example the 200 recompute attempts (O-60). |
| `notes` | string | no | What the tool wants a reader to know: an extrapolated figure, an input that was unavailable. |

Each measurement carries `id` (string), `unit` (string) and either `value` (number) or the criterion pair `mean_ns` and `median_ns`; `stub` (boolean) marks a placeholder routine as the benchmark section describes; `threshold` and `pass` may repeat the verdict per measurement. A tool may add fields to a measurement, and a report may add top-level fields of its own; the schema names the shared ones and leaves the rest open, so a new report kind documents its extra fields here rather than in the schema.

Baseline versus gate report: a gate report is judged, so `pass` and `thresholds` are required. The bench baseline is what later thresholds are measured against (O-40: `perf-zenbook.json` is checked against 300 ms node read, 60 ms grade and 500 ms decision to feedback, twice the A9 section 6 budgets), so it is not itself judged, and when `report` is `bench` the schema forbids `pass` and `thresholds`. That is the schema's only conditional rule; `bench-zenbook.json` as `just bench` writes it validates without a change to `scripts/bench-report.mjs`.

Validating a report: `just report-check` runs `scripts/check-reports.mjs`, which compiles `report.schema.json` with ajv (draft 2020-12, a root development dependency), validates every `*.json` file directly under this directory (or the directory given as its one argument) against it, then checks that each gate report's verdict agrees with its measurements, and finally requires `pass: true` on every report other than the bench baseline. The agreement rule reads a measurement as judged when its `pass` is a boolean: a report whose `pass` is true while any measurement carries `pass: false` is rejected, and so is one whose `pass` is false while every judged measurement passes. It prints one line per broken field and exits 1 on any finding; the ts job runs it on the committed files, `just gates-check` runs it on a fresh run under `target/gate-reports`, and `scripts/check-reports.test.mjs` covers it. A report that fails the schema, the agreement rule or its own pass rule is not evidence.

## Gate reports: `g1-kuhn`, `g2-akq` and `g3-leduc` (R2.4, R2.5, R2.6, O-125)

Produced by `just gates`, which runs `cargo run --release -p validate -- gates --out validation/reports`. For each gate `tools/validate` loads the fixture under `validation/fixtures/`, solves the game through `gto-solve`, judges every measurement against the threshold the fixture's tolerance gives it, and builds one report value. It then writes that value twice in the same run: `<id>.json` in the envelope above, and the Markdown twin `<id>.md` with the title, R ID, commit, date, machine, the notes line and one table row per measurement with its threshold and verdict. Both files come from one value, so they cannot disagree, and neither is assembled or edited by hand. The tests in `tools/validate/tests/gates.rs` call the same `validate::gates` functions, so the tests and the reports judge through one code path. The tool writes every file first and exits 1 when any gate fails. `--machine NAME`, else the `VALIDATE_MACHINE` environment variable, else the host name (lowercased, every character outside `[a-z0-9-]` turned into a dash, refused when the result does not start with a letter), names the machine; the Zenbook run sets `VALIDATE_MACHINE=zenbook`, or its host name is used. `--commit SHA` overrides `git rev-parse HEAD`. Before anything runs, the tool reads `git status --porcelain` and refuses a dirty working tree with exit 2, naming the first dirty path, so the commit a report names is the code that produced it; `--allow-dirty` lets the run go ahead and every report's notes then end with the line "working tree dirty at run time". Gate report names carry no machine suffix, so `report` equals the file stem.

`just gates-check`, which `just ci` runs, writes the same six files to `target/gate-reports` with `--allow-dirty` and runs `scripts/check-reports.mjs` on that directory, so a local ci run checks a fresh gate run without touching the committed reports here.

| Report id | Files | R ID | Fixture | Judged measurements | Informational measurements |
|---|---|---|---|---|---|
| `g1-kuhn` | `g1-kuhn.json`, `g1-kuhn.md` | R2.4 | `toy-games/kuhn.json` | `kuhn/standard/value-abs-error` at most 0.001 chips; `kuhn/standard/nash-conv` below 0.001 chips, strictly | `kuhn/standard/value-player-0`, `kuhn/standard/iterations`, `kuhn/standard/parameter-a` and one `kuhn/standard/<fact-id>` per strategy fact |
| `g2-akq` | `g2-akq.json`, `g2-akq.md` | R2.5 | `toy-games/akq.json`: the three AKQ (ace, king, queen) bet sizes and the polar river game | One `akq/<case>/<fact-id>` per strategy fact and ratio fact, `{ min, max, unit: "frequency" }` the fact plus or minus 0.005 (0.5 percentage points) | `akq/<case>/nash-conv` and `akq/<case>/iterations` |
| `g3-leduc` | `g3-leduc.json`, `g3-leduc.md` | R2.6 | `toy-games/leduc.json` and `openspiel/leduc_exploitability.json` | `leduc/plain-cfr/exploitability@<iteration>` at 1, 10, 100, 1000 and 5000, `{ min, max, unit: "chips" }` the fixture value plus or minus max(0.001, 0.1 x fixture) (O-79) | `leduc/plain-cfr/value-player-0@5000` and `leduc/dcfr-default/exploitability@<iteration>`, the engine's default discounted curve on the same model (O-124) |

G1 and G2 solve with the engine's DCFR default schedule in chunks of 1,000 iterations until NashConv, the sum of the two players' best-response gains, is below the gate's stop target or the iteration cap is reached; `notes` records the stop rule and the iteration count is a measurement, so a stall shows in the report. G3 runs plain counterfactual regret minimization (CFR) with alternating updates as OpenSpiel's `CFRSolver` does (O-124, O-128) in one continuous run of 5000 iterations, and its exploitability is NashConv divided by 2 (O-108); `notes` carries that mode line and the fixture provenance path.

Where the committed files come from (O-125). Continuous integration regenerates all six files in the rust job with `VALIDATE_MACHINE=github-ubuntu` and uploads them as the `gate-reports` artifact; it never commits them (the workflow has `contents: read`). The files committed here are the Zenbook run, written by `just gates` at the commit they name, and `just report-check` validates those in the ts job.

## Gate G4: `g4-oracle` (R2.11, O-125, O-170)

Produced by `just g4 ORACLE OUT`, which runs `cargo run --release -p validate -- g4 --oracle ORACLE --out OUT --write-engine OUT/engine-dump.json` on the Zenbook with `VALIDATE_MACHINE=zenbook` on a clean tree. The tool loads the spot list `validation/fixtures/g4-spots.json` (O-87), solves every spot with the engine under the list's stop rule (each seat's gain at or below 0.1 percent of the pot, 50,000 iterations, 600 seconds per spot, O-168), writes the engine-side node dump beside the report, loads the oracle dump the private program wrote by linking the AGPL crate (ADR 0002, O-31, O-81), refuses either dump when it breaks the criterion 2 invariants of `tools/library-pack` or when the two disagree on a node's actor, pot, stacks, actions or hand set (never a silent partial compare), and judges each gated spot on four measurements. `--engine PATH` compares a committed engine dump instead of solving, `--spots PATH` points at another list, `--report-id ID` names the report and its two files (default `g4-oracle`), and `--out`, `--machine`, `--commit` and `--allow-dirty` work as for `gates`. The report lands in the private capture repository under `validation/reports/g4/` (09 section 7, O-170) beside `oracle-dump.json`, `engine-dump.json` and the oracle's provenance note; this directory holds no G4 file, only the pass note in the table below.

Judged measurements per gated spot, thresholds from 04 section 6 (O-160): `g4/<spot>/engine/exploitability` and `g4/<spot>/oracle/exploitability` at most 0.3 `pct_pot`, each dump's root `accuracy_pct_pot`, the larger of that spot's two seat gains; `g4/<spot>/root/frequency-mad` under 2.0 `percentage_points`, strictly, the mean over the root hands, weighted by the engine dump's reach for the actor, of the mean absolute frequency difference over the actions, times 100; `g4/<spot>/root/ev-abs-error` at most 0.3 `pct_pot`, the difference of the two reach-weighted root expected values as a percent of the root pot. Informational: `g4/<spot>/root/frequency-mad-unweighted`, `frequency-max-abs-diff`, `hands-compared`, `ev-engine-bb`, `ev-oracle-bb` and `ev-engine-vs-best-response-bb` (solved runs only, a consistency check of the reach and EV conventions), `g4/<spot>/<line>/frequency-mad` for every deeper root-street node both dumps carry and reach (a deeper node is a key that adds actions to the spot's root key on the root street; a turn spot never absorbs the nodes of the river spot that extends it), `g4/<spot>/nodes/compared`, `g4/<spot>/engine/iterations`, `seconds`, `estimate-bytes` and `peak-bytes` (solved runs only), and `g4/dump/<side>/exploitability/<seat>`, the dump-level pair; the raked list's two twins carry the four rule rows as informational (O-161, the next paragraph). A deeper node whose actor has zero reach on either side (the engine's 16-bit walk writes one for a never-taken action) is skipped and named in `notes`; a root nobody reaches is a mismatch. `notes` records the engine mode line when the engine side was solved in this run (the adapter's DCFR schedule, the storage the solve report records, the measurement cadence and the memory cap of the options, O-138; absent under `--engine`, since the tool does not know how a committed dump was solved), the oracle target (a mean gain of 0.05 percent of the pot, O-162), the spot list, the tree hash, the sha256 of each dump (O-169, since the node-dump schema has no free-text field), each solved spot's stop reason and gains, and the skipped nodes. The strict frequency rule is judged by a strict threshold, so a value of exactly 2.0 fails in the verdict and in the threshold alike; the Markdown twin prints it as `under 2 percentage_points` against `at most 0.3 pct_pot`, while the JSON carries `{ "max": 2, "unit": "percentage_points" }` beside the verdict, because `report.schema.json` has no field for strictness (a `strict` boolean on the object form would let the JSON say it too).

The rake comparison (O-161) is a run of its own: `just g4-raked ORACLE OUT` runs `cargo run --release -p validate -- g4 --spots validation/fixtures/g4-spots-raked.json --oracle ORACLE --out OUT --report-id g4-oracle-raked --write-engine OUT/engine-dump-raked.json` on the two raked twins of `g4-spots-raked.json` (the roots of `turn-01-dry-ace` and `river-01-dry-ace` at the online rake) against the oracle dump the private program wrote for that list, and writes `g4-oracle-raked.json`, `g4-oracle-raked.md` and `engine-dump-raked.json` beside the G4 report. Every spot of that list is informational, so the report's `pass` is true by construction and its rows are read, not judged; S18 learns the rake gap there. The lists are separate because a node dump holds each key once: a raked twin sharing its root key with a gated spot in one list would make the compare read the rake-free nodes for both, and the loader now refuses a list in which a key repeats.

`just g4-smoke` runs the compare on the committed synthetic tiny pair under `validation/fixtures/g4/` with no solve into `target/gate-reports/g4` with `--allow-dirty`; the rust job runs it after the G1 to G3 gates. `just g4-check`, called by `just gates-check` and so by `just ci`, runs the smoke and then validates its report with `scripts/check-reports.mjs`, so the envelope and the pass rule are checked locally without touching this directory (the rust job cannot run check-reports, which needs the ajv package the ts job installs). The R2.11 tests in `tools/validate/tests/g4.rs` and `g4_engine.rs` call the same `validate::gates::g4` functions.

## Gate G6a: `g6a-pushfold` (R2.19, O-63, O-125)

Produced by `just g6a`, which needs `G6A_CHART_PATH` and runs `cargo run --release -p validate -- g6a --out validation/reports`. For every depth from 1 to 15 big blinds (bb) the tool solves heads-up push/fold on the rake-free configuration `cfg_2_online_norake_<d>` (O-220) through `gto_solve::preflop`: counterfactual regret minimization plus (CFR+) over the 169 hand classes with exact card removal finds the support, the mixed classes are solved from their indifference equations, and an exact best response certifies the result (O-223). It then reads the committed G6a solution of that depth under `validation/fixtures/library` and compares it with the recomputation within the O-133 tolerances, and, when `--chart PATH` or `G6A_CHART_PATH` names the local transcription of the published chart, lists every hand where the chart and the solution disagree with its expected value (EV) gap. The report is written as `g6a-pushfold.json` with its tool-written Markdown twin, `--machine`, `--commit` and `--allow-dirty` working as for `gates`.

| Measurement id | Judged | Threshold |
|---|---|---|
| `depth-<d>/certificate-gain` | yes | at most 1e-9 bb: the larger of the two seats' best-response gains against the refined equilibrium (O-223) |
| `depth-<d>/library-frequency-diff` | yes | at most 1/255 `frequency`: the largest frequency difference between the committed solution and the recomputation (O-133) |
| `depth-<d>/library-differences` | yes | at most 0 `count`: nodes, actions or EVs of the committed solution that differ beyond those tolerances, each named in `notes` |
| `depth-<d>/iterations` | no | the CFR+ iterations before the refinement |
| `chart/max-ev-gap` | yes, with a chart only | at most 0.02 bb: the largest absolute EV gap of a disagreeing hand, the near-indifferent bound (O-222, the O-22 preflop floor fallback) |
| `chart/disagreements` | no, with a chart only | how many hands and depths disagree with the chart |

`notes` opens with the solve method and the EV convention (O-224), gives one line per depth (iterations, both seats' gains, the mixed push and call classes, the committed solution and its differences), names the chart, its address and its parameters, and states that the chart's per-hand thresholds are not redistributed (O-221, `validation/fixtures/PROVENANCE-g6a.md`). With a chart it then lists each disagreement with its depth, side, our frequency and EV gap; without one it says the chart comparison was run locally and is recorded in the committed report.

Where the committed files come from (O-125, O-221). The committed `g6a-pushfold.json` and `.md` are the Zenbook run: `just g6a` with `VALIDATE_MACHINE=zenbook` and `G6A_CHART_PATH` set on a clean tree, so the committed report carries the chart result. `just g6a` refuses to run when `G6A_CHART_PATH` is unset or empty, so a chart-less run never overwrites the committed files. `just g6a-smoke` writes the chart-less report into `target/gate-reports/g6a` with `--allow-dirty`; the rust job runs it with `VALIDATE_MACHINE=github-ubuntu` after the gates step has rewritten the committed G1 to G3 reports in its checkout, and uploads it with the other gate reports as the `gate-reports` artifact, leaving the committed `g6a-pushfold` files out of the artifact; that run's notes say the tree was dirty and that the chart part is run locally. `just g6a-check`, called by `just gates-check` and so by `just ci`, runs the smoke and then `scripts/check-reports.mjs` on its directory. `just g6a-pack` regenerates the committed solutions and is never run by CI. The R2.19 tests in `tools/validate/tests/g6a.rs` call the same `validate::gates::g6a` functions.

## Preflop spike: `spike-preflop-<machine>` (R2.21, O-48, O-49, O-80, O-227, O-228)

Produced by `just spike-preflop MACHINE PLATFORM` (defaults `zenbook` and `linux/amd64`), a measurement that runs alone, with no other build, test or bench at the same time. The recipe builds `infra/docker/spike-preflop.Dockerfile` for the platform and runs `validate spike-preflop --out /out --machine <MACHINE> --commit <HEAD> --allow-dirty` in it under `docker run --rm --memory 5g --memory-swap 5g`, with `validation/reports` bind-mounted at `/out` (O-228). The tool times the 15 push/fold solves of G6a end to end and a minimal heads-up 100bb run (O-227: BB-BTN, the online seed sizing spec, rake-free, a realization factor of 1.0 for both seats as a labeled placeholder) and reads peak bytes three ways, the allocator's accounted peak, the process `VmHWM` and the container's cgroup `memory.peak`, judging the largest that is readable. The report id carries the machine, as O-87 names the files: `spike-preflop-zenbook` for the Zenbook (S19) and `spike-preflop-mac` for the Mac rerun of the same image for linux/arm64 (S20). The JSON follows `report.schema.json`; its Markdown twin is tool-written from the same value.

| Measurement id | Judged | Threshold |
|---|---|---|
| `push-fold/peak-bytes` | yes | under 5 GiB, the container cap (O-80, O-48) |
| `push-fold/certificate-gain` | yes | at most 1e-9 bb at every depth (O-80, O-223) |
| `push-fold/seconds`, `push-fold/iterations` | no | wall seconds over the 15 depths are recorded, not gated (O-80) |
| `hu100/peak-bytes` | yes when measured | under 4 GiB (O-49) |
| `hu100/seconds` | yes when measured | under 12 hours to the target (O-49) |
| `hu100/gain-pct-pot` | yes when measured | each seat's gain at most 0.3 percent of the starting pot (O-227, the O-138 measure) |
| `hu100/iterations` | no | iterations to the target |
| `hu100/measured` | yes, present only when the 100bb run errored | at least 1; the value is 0, so an errored run fails the report (O-49) |
| `<run>/peak-accounted`, `<run>/peak-vmhwm`, `<run>/peak-cgroup` | no | the three readings behind each judged peak; a reading the host cannot give is left out |

When the 100bb run errors, nothing was measured and the report fails: a judged row `hu100/measured` with the value 0 against at least 1 says so, and the first line of `notes` reads "100bb: not measured" with the error. Its peak and seconds are then an extrapolation from push/fold, recorded as informational only. A run with no peak reading at all (validate built without the `peak-alloc` feature, off Linux) fails its peak row instead of counting as 0 bytes; the image builds with the feature. `notes` also quotes both pass rules, gives one line per run (seconds, iterations, gain and the three readings) and ends with the caller's two lines: `SPIKE_CONTAINER`, the docker run line with its memory limit (the recipe passes its own line unless the variable is set), and `SPIKE_CONCURRENT`, the other heavy work that was running (reported as not recorded when unset). The image holds no git checkout, so `--commit` records HEAD and `--allow-dirty` records the tree as dirty. CI never runs the spike; the R2.21 tests in `tools/validate/tests/spike.rs` validate the committed JSON and run one depth in process.

## Flop-line benchmark: `bench-flop-line-<machine>` (R2.12, R2.16 to R2.18, O-50, O-190, O-200)

The library builder solves one flop of the O-52 line (online 6-max 100 big blinds, button versus big blind single-raised pot) on hand-made ranges (O-201) and the report judges that run against O-50: peak resident set size (RSS) under 5 GB and every preflop line at most 30 minutes to 0.3 percent of the pot for both seats. Three steps produce it, each through `library-builder` (`services/library-builder/src/spec.rs` and `bench.rs`):

1. `library-builder estimate --job-spec /fixtures/builder/bench-bb-btn-srp.json --out sweep.json` estimates the memory of every line of the spec on all 1,755 canonical flops at the spec's storage, building the betting skeleton only (the O-194 recheck), and writes the largest and smallest estimate per line.
2. `library-builder --once --job-spec <spec> --summary-out <file>` runs one job without a database (O-205) through the same staging, upload and read-back verification as the loop, inside `docker run --memory 5g --memory-swap 5g` with `LIBRARY_ROOT` on a volume, once for `bench-bb-btn-srp.json` (32-bit storage, target 0.3 percent, the judged run) and once for `bench-bb-btn-srp.16bit.json` (16-bit storage at the 0.5 percent floor of O-194, informational per O-200). Each prints one JSON summary line: outcome (`staged` or `failed`), per line seconds, iterations, both seats' gains, stop reason, memory estimate, flop file bytes and runout file bytes, bytes written, peak RSS (`VmHWM` from `/proc/self/status`) and wall seconds. A run that fails still writes its summary with outcome `failed`, so the miss reaches the report (O-178).
3. `library-builder bench-report --judged <summary> --informational <summary> --sweep sweep.json --out validation/reports` writes `bench-flop-line-<machine>.json` and its Markdown twin `bench-flop-line-<machine>.md` from one value, so they cannot disagree. The machine name comes from `VALIDATE_MACHINE` (default `zenbook`) and must match the schema's name pattern, the commit from `git rev-parse HEAD`, the date is now in UTC, and the machine block comes from sysinfo (long operating system name, first CPU brand, logical cores, memory rounded to whole gibibytes). The command exits 1 when the report fails, after writing both files.

The report id is `bench-flop-line`, not `bench`, so the schema requires `pass` and `thresholds`. `toolchain` is the engine version every build records (`g-tee-oh-builder/<version>`), since the report is written after the measured run by another process.

| Thresholds key | Value |
|---|---|
| `peak_rss_bytes` | `{ "max": 5000000000, "unit": "bytes" }`, judged strictly: a peak of exactly 5,000,000,000 bytes fails. The judged row carries `"strict": true` and the Markdown twin prints "under". |
| `seconds_per_line` | `{ "max": 1800, "unit": "seconds" }` |
| `exploitability_pct_pot` | `{ "max": 0.3, "unit": "pct_pot" }` |

| Measurement id | Judged | Meaning |
|---|---|---|
| `flop-line/staged` | yes, at least 1 | 1 when the judged run staged, uploaded and verified its build, 0 otherwise; a failed run fails here, so a failing report always has a failed row (the agreement rule of `scripts/check-reports.mjs`). |
| `flop-line/peak-rss` | yes, under 5,000,000,000 bytes | The judged run's peak RSS. |
| `flop-line/<line>/seconds` | yes, at most 1,800 | Wall seconds of the line's solve. |
| `flop-line/<line>/gain-oop`, `flop-line/<line>/gain-ip` | yes, at most 0.3 | Each seat's best-response gain in percent of the pot at the stop. |
| `flop-line/<line>/iterations`, `estimate-bytes`, `flop-bytes`, `mean-runout-bytes` | no | The iterations run, the memory estimate, the flop file's bytes and the mean runout file's bytes (the O-180 measured figure for S20). |
| `flop-line/bytes-written`, `flop-line/job-seconds` | no | The build's uploaded bytes and the run's wall seconds. |
| `flop-line-16bit/...` | no | The same quantities for the 16-bit run, never judged (O-200). |
| `sweep/flops`, `sweep/cap-bytes`, `sweep/<line>/max-estimate-bytes`, `sweep/<line>/min-estimate-bytes` | no | The O-194 sweep: flops estimated per line, the memory cap, and each line's largest and smallest estimate. |

`notes` states the O-50 rule, the verdict with one sentence per rule naming the numbers, the storage of each run (the judged summary is the 32-bit run by the bench method, O-194 and O-200), each line's stop reason, and the flop with the largest estimate per line. `just report-check` validates the JSON with the other reports, so a committed `bench-flop-line-zenbook.json` that misses O-50 fails that check: the miss is recorded, and the phase gate has to answer it.

## Builder settings: `builder_setting` keys (O-188)

The library builder reads every `builder_setting` row on every claim (A1 section 6, R2.18), so a change takes effect on the next job without a restart; the same keys appear in a job spec's `settings` (O-205). Every key has a default and a missing key takes it. A row whose value fails its check (wrong JSON type, out of range, or 16-bit storage with a target under 0.5 percent of the pot) falls back to the default alone and is listed in `/healthz` under `settings_errors` as `key: reason`, the reason naming the default used; an unknown key is listed the same way. In a job spec any such error refuses the spec instead. `services/library-builder/src/settings.rs` holds the checks.

| Key | Default | Check | Meaning |
|---|---|---|---|
| `paused` | `false` | boolean | Claim nothing. |
| `cpu_share` | `0.5` | above 0, at most 1 | Share of `BUILDER_THREADS` outside the boost window. |
| `overnight` | `{"start_hour": 0, "end_hour": 7, "utc_offset_minutes": 0, "cpu_share": 1.0}` | hours 0 to 23, offset within a day, share above 0 and at most 1, no other field | The O-13 boost: inside `[start_hour, end_hour)` local time (wrapping midnight when the start is after the end, empty when they are equal) the share is the window's. |
| `budget_bytes` | `650000000000` | positive integer | The library budget (ADR 0018). |
| `bytes_per_runout` | `14156873` | positive integer | Planner estimate per runout file (O-180). |
| `bytes_per_flop_tree` | `752365` | positive integer | Planner estimate per flop tree file (O-180). |
| `k_runouts` | `20` | positive integer up to 65,535 | Runouts kept for the frequent pairs (O-14). |
| `k_runouts_rare` | `10` | positive integer up to 65,535 | Runouts kept for the other pairs (O-191). |
| `k_frequent_pairs` | `1` | positive integer up to 65,535 | Pairs per configuration that take `k_runouts` (O-191). |
| `plan_configs` | `["cfg_6_online_100"]` | non-empty list of `v1_configs` ids | The configurations the planner enumerates. |
| `target_pct_pot` | `0.3` | positive number | Stop and publish target per seat, percent of the pot (04 section 6, O-138). |
| `max_iterations` | `20000` | positive integer | Iterations per line on the first attempt; attempt n runs n times as many. |
| `max_seconds_per_line` | `1800` | positive integer | Wall seconds per line (O-178). |
| `storage_bits` | `32` | 16 or 32; 16 only with `target_pct_pot` at least 0.5 | Solver storage (O-194). |
| `memory_cap_bytes` | `4294967296` | positive integer, clamped to `BUILDER_MEMORY_CEILING_BYTES` | A solve whose estimate plus one runout walk is above it is refused before allocation (O-139, O-187); 4 GiB leaves headroom under the 5 GiB container limit for runtime, extraction and staging (PR #22 review). |
| `max_attempts` | `3` | integer from 1 to 32,767 | Failures before a job parks (A5 section 4, O-176). |
| `stale_hours` | `6` | positive integer | Age of a `running` row the stale reclaim re-queues (O-185). |
| `verify_interval_hours` | `24` | positive integer | Hours between verify passes (O-186). |
| `plan_interval_minutes` | `60` | positive integer | Minutes between automatic plans. |
| `poll_seconds` | `30` | positive integer | Sleep when paused or idle. |

## Matrix frame bench: `matrix-frame-<machine>.json` (R3.12)

Produced by `just bench-web` (S24, O-260), which runs the Playwright bench project (`web/e2e/bench/matrix-frame.bench.ts`) against `vite preview` of the harness build (`vite build --mode harness`, `dist-harness/`, never the production image, O-267). The spec opens `/bench.html`, calls `window.__runMatrixBench` (`web/src/bench/`), builds the report with `web/e2e/bench/report.ts` and writes it here. Rule 1 applies: the tool writes the whole file. The run happens on the Zenbook under the bench lock, since other heavy work on the machine moves frame times.

What is timed. The A7 section 4 budget is a range matrix frame under 16 ms. The page draws the matrix with the same `drawMatrix` the `RangeMatrix` component uses, at a forced device pixel ratio of 2 (a 1040 by 1040 backing store for the 520 pixel matrix, whatever the screen's ratio is), in each of the three modes (frequency, expected value, range weight). Per mode it runs 30 untimed warm-up frames, then 600 recorded frames, each paced by `requestAnimationFrame`. Every frame takes the next of five synthetic nodes (fixture formula at shifted grid positions, one with missing hands, one with two raise sizes), so no two neighboring frames draw the same data, and moves the focus and selection outlines. One frame time, from `performance.now()`, is the model build, the full draw and a one-pixel `getImageData(0, 0, 1, 1)` read; the read makes the browser finish the deferred canvas work, so the time is the cost of the pixels, not of queuing the calls. The canvas is not created with `willReadFrequently`, so it stays on the browser's default (accelerated when a GPU is there) path.

How p95 is taken and judged: nearest rank, the value at rank `ceil(0.95 n)` of the recorded times sorted ascending, as for `p95_ns` in the benchmark section. A mode passes when its p95 is under 16 ms, strictly; `pass` is true only when all three modes pass. The JSON carries `{ "max": 16, "unit": "ms" }` as each threshold because the schema has no field for strictness (the G4 section has the same note). The spec writes the file before it asserts, so an over-budget run still leaves its evidence, and then the test fails.

The renderer. Headless Chromium on a machine without a usable GPU path renders with SwiftShader (llvmpipe on Linux), which is pessimistic. The page reads `UNMASKED_RENDERER_WEBGL` through `WEBGL_debug_renderer_info` from a throwaway WebGL context (else the plain `RENDERER` string) and classifies it `software` when it names SwiftShader, llvmpipe or Software, `gpu` otherwise, `unknown` when WebGL is unavailable. The WebGL string names the graphics backend the browser picked; in Chromium an accelerated 2D canvas rasterizes on that same backend.

Fields beyond the envelope:

| Field | Type | Meaning |
|---|---|---|
| `report`, `r_ids` | | `matrix-frame` and `["R3.12"]`. |
| `machine` | object | As the benchmark section defines it, from `node:os`; `BENCH_MACHINE` names it (default `zenbook`, must match `^[a-z][a-z0-9-]*$`). |
| `toolchain` | string | `Chromium <browser.version()>, Playwright <version>`. |
| `measurements` | array | Per mode `<mode>/p95` (judged: `threshold` and `pass`), `<mode>/p50` and `<mode>/max` (informational, no `pass`), all in `ms`, three decimals. |
| `renderer` | object | `string` (the renderer string or null) and `kind` (`gpu`, `software` or `unknown`). |
| `pixel_ratio`, `size_px` | number | 2 and 520. |
| `frames_per_mode`, `warmup_frames_per_mode` | integer | Recorded and untimed frames per mode; `BENCH_FRAMES` overrides the 600 for development runs only. |
| `concurrent_work` | string | `BENCH_CONCURRENT_WORK` as given (free text, for example "S18 and S19 cargo builds running"), else `none recorded`. |
| `user_agent` | string | `navigator.userAgent` of the page. |
| `frame_times_ms` | object | Every recorded frame time per mode, sorted, so a reader can recompute the percentiles. |
| `notes` | string | The renderer, ratio, frame counts, the timing rule and the concurrent work in one sentence each. |

`BENCH_REPORT_DIR` sends the file elsewhere (development smoke runs); the default is this directory. Hosted continuous integration (CI) never reruns the bench, because runner timing noise would make the number meaningless; the ts job only checks the committed file with `just report-check` (schema, verdict agreement and `pass: true`).

## Trainer latency: `perf-<machine>.json` (R3.3, O-40, O-91, O-248)

Produced by `just perf`, which runs `node scripts/perf.mjs` (modules under `scripts/perf/`) against the running Compose dev stack through Caddy at `https://localhost`. The caller brings the stack up with the fixture library (`just dev-up`, `just db-migrate`) and takes the bench lock, since other heavy work on the machine moves the numbers; the script never starts or stops the stack. Rule 1 applies: the script writes the whole file. S23 built the tool; the committed `perf-zenbook.json` is the Zenbook run at the commit it names.

What the script does, in order:

1. Trust. Caddy serves `tls internal`, a certificate signed by its own root. The script copies that root out of the caddy container (`docker compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt`) and passes it as the certificate authority of its own HTTPS requests only, so certificate checks stay on and no process-wide setting changes. `--ca-file PATH` reads the root from a file instead.
2. Stack check. `GET /api/v1/healthz` must answer 200; otherwise the script stops with "the dev stack is not up" and the command to bring it up.
3. Owner. A fresh owner, `perf-<16 hex digits>@example.com`, is created through the api container's bundled create-user with a random password on its standard input, as the e2e chain does (O-263): never an argument, never printed, never written to disk. The script logs in with `POST /api/v1/auth/login`, keeps the session cookie and sends the returned `csrf_token` as `x-csrf-token`, with `Origin` set to the base URL, on every mutating request.
4. Study node read. The pairs of `cfg_6_online_100` come from `GET /api/v1/configs/cfg_6_online_100/pairs`; every pair whose root `GET /api/v1/study/node` serves is a target, and so is each node along its likeliest line, which the api names as `next_likely_node_key` (read back with `node_key`, at most 4 steps below the root), at most 64 targets. The reads cycle over the targets, so neighboring samples read different nodes; a node on a likeliest line may come from the api's prefetch cache, as it would in use. A sample is the client round trip of one read.
5. Session. One drill on the BB-BTN pair (button versus big blind preflop, after-action stop rule) through `POST /api/v1/drills`, and one session through `POST /api/v1/sessions` with mode `drill` and the fixed seed `0000000000005eed` (O-249), so two runs deal the same hands.
6. Grade and decision to feedback. Each sample fetches the prompt with `GET /api/v1/sessions/{id}/next` (not timed), then answers it with `POST /api/v1/sessions/{id}/decisions` carrying the prompt's `state_version` and its own Idempotency-Key. The decision to feedback sample is the client round trip of that POST. The grade sample is the `sq-grade` entry of the response's `Server-Timing` header, the api's own measurement of its solver-query grade call (`services/api/src/http/server-timing.ts`), because solver-query publishes no port on the dev stack (O-248).
7. Report. The report is built, validated against `report.schema.json` with the same ajv settings as `scripts/check-reports.mjs`, written here, and `scripts/check-reports.mjs` then runs on this directory. A run with a p95 over its limit still writes its file, so the miss is on record, and the command exits 1.

Each path takes 20 untimed warm-up samples and then 200 timed samples, one request at a time. Requests start at least 250 ms apart: the api allows 300 requests per client address per minute, a run makes about 700, and a throttled answer (429) stops the run instead of being timed. A run takes about three minutes.

How p95 is taken and judged: nearest rank, the value at rank `ceil(0.95 n)` of the timed samples sorted ascending, as for `p95_ns` in the benchmark section. A path passes when its p95 is at most its O-40 limit, twice the A9 section 6 budget; `pass` is true only when all three pass.

| Thresholds key | Value | Path |
|---|---|---|
| `study-node/p95` | `{ "max": 300, "unit": "ms" }` | Study node read, client round trip of `GET /study/node`. |
| `grade/p95` | `{ "max": 60, "unit": "ms" }` | The solver-query grade call, from `Server-Timing: sq-grade;dur=<ms>`. |
| `decision-feedback/p95` | `{ "max": 500, "unit": "ms" }` | Decision to feedback, client round trip of `POST /sessions/{id}/decisions`. |

Fields beyond the envelope:

| Field | Type | Meaning |
|---|---|---|
| `report`, `r_ids` | | `perf` and `["R3.3"]`. |
| `machine` | object | As the benchmark section defines it, from `node:os`; `BENCH_MACHINE` names it and the file (default `zenbook`, must match `^[a-z][a-z0-9-]*$`). |
| `measurements` | array | Per path `<path>/p95` (judged: `threshold`, `pass` and `samples`), `<path>/p50` and `<path>/max` (informational, no `pass`), all in `ms`, three decimals. |
| `base_url`, `config_id`, `pair` | string | The origin measured, `cfg_6_online_100` and `BB-BTN`. |
| `warmup_per_path`, `samples_per_path` | integer | 20 and 200. |
| `study_targets` | integer | How many distinct nodes the study reads cycled over. |
| `timings_ms` | object | Every timed sample per path, sorted, so a reader can recompute the percentiles. |
| `notes` | string | The method, the sample counts, the targets and the timing rule in one sentence each. |

`--out-dir DIR` sends the file elsewhere (development runs); `--base-url URL` measures another origin, which must equal the api's `APP_ORIGIN` because it is also the `Origin` header. Hosted CI never reruns `just perf`; the ts job checks the committed file with `just report-check`, and the in-process latency test (`services/api/test/latency.test.ts`, R3.3) times the same three paths against the fixture solver-query as the CI stand-in.

## Report files (O-87)

09 section 7 names where each gate report lands and O-87 fixes the file names 09 left open; `v1-gate.md` and the Phase 0 names come from 09 section 7 and the phase doc. The table lists every public report, who writes it and what it proves, so a session knows the name before it writes. Markdown files are gate summaries; JSON files follow `report.schema.json`. The two O-87 names that are fixtures rather than reports, `PROVENANCE-g6a.md` and `g4-spots.json`, live under `validation/fixtures/` and are described in that directory's README. Private reports (the Phase 1 exit, the G4 report, the coverage and quality assurance reports) stay in the capture repo and are only linked from here.

| File | Written by | Form | Proves |
|---|---|---|---|
| `phase-0-gate.md` | S06, started by S01 | Markdown | Phase 0 gate, repo part: R0.1 to R0.8 and R0.10 to R0.12, with the throwaway AGPL (GNU Affero General Public License) and guard runs linked and the private continuous integration (CI) result for R0.8 noted. |
| `mac-bootstrap.md` | S04 | Markdown | Phase 0 gate, Mac part: R0.9 against O-50 (peak resident set size (RSS) under 5 GB and under 30 minutes to 0.3 percent pot per preflop line), the Docker memory per O-20, nothing left running per O-47. |
| `bench-zenbook.json` | S02, `just bench`; S16 adds the grade id | JSON baseline | R0.10 and R2.13 (the `grade/warm_cache` id under its 30 ms budget). The p95 guard baseline that O-40's thresholds are later measured against; the benchmark section above has the fields. |
| `g1-kuhn.json`, `g1-kuhn.md` | S13, `just gates` on the Zenbook; CI uploads its own run as an artifact only (O-125) | JSON gate report with its tool-written Markdown twin | R2.4: Kuhn against minus 1/18 and the 0.001 chip floor, the 04 section 6 pass rules as thresholds. |
| `g2-akq.json`, `g2-akq.md` | S13, `just gates` on the Zenbook; CI as above | JSON gate report with its tool-written Markdown twin | R2.5: the AKQ cases and the polar river game against their closed forms within 0.5 percentage points. |
| `g3-leduc.json`, `g3-leduc.md` | S13, `just gates` on the Zenbook; CI as above | JSON gate report with its tool-written Markdown twin | R2.6: Leduc against the committed OpenSpiel exploitability curve (O-30) within the O-79 tolerance. |
| `library-size-estimate.md` | S14, `just library-size-estimate` (`library-pack estimate`) | Markdown, tool-written | R2.7: bytes per runout and per flop tree on synthetic trees with the method and seed, set against 02 section 5.2 and O-51 (the section above); the chunk decode number lives in the bench JSON. |
| `g4-oracle.json`, `g4-oracle.md` | S17, `just g4` on the Zenbook; private, in the capture repository's `validation/reports/g4/` (O-170) | JSON gate report with its tool-written Markdown twin (the G4 section above) | R2.11: the engine's heads-up turn and river solves against the b-inary oracle through the private program (ADR 0002, O-31, O-81) on the eight gated spots of `g4-spots.json`. G4 passed on 2026-10-22 at 63bf014; report in the private repo. |
| `g4-oracle-raked.json`, `g4-oracle-raked.md` | S17, `just g4-raked` on the Zenbook; private, beside the G4 report in the capture repository's `validation/reports/g4/` (O-170) | JSON report with its tool-written Markdown twin, informational rows only (the G4 section above) | O-161: the two raked twins of `g4-spots-raked.json` against the oracle at the online rake; nothing is judged, S18 reads the rake gap here. |
| `g6a-pushfold.json`, `g6a-pushfold.md` | S19, `just g6a` on the Zenbook with the local chart; CI uploads its own chartless run as an artifact only (O-125, O-221) | JSON gate report with its tool-written Markdown twin (the G6a section above) | R2.19: the exact push/fold equilibrium at 1 to 15 bb (certificate at most 1e-9 bb, O-223), the committed G6a solutions equal to the recomputation (O-133), and agreement with the published chart except at near-indifferent hands (O-222). |
| `spike-preflop-zenbook.json`, `spike-preflop-zenbook.md` | S19, `just spike-preflop` in the 5 GB container (O-228) | JSON report with its tool-written Markdown twin (the spike section above) | The preflop spike on the Zenbook (R2.21): push/fold peak bytes and seconds against O-80, the heads-up 100bb figure measured against O-49 or labeled extrapolated; the O-4 answer is drawn from it. |
| `spike-preflop-mac.json`, `spike-preflop-mac.md` | S20, `just spike-preflop mac linux/arm64` on the Mac | JSON report with its tool-written Markdown twin | R2.21 rerun of the same image on the Mac against O-48, O-49 and O-80. |
| `bench-flop-line-zenbook.json`, `bench-flop-line-zenbook.md` | S18, `library-builder bench-report` on the Zenbook (the flop-line section above) | JSON gate report with its tool-written Markdown twin | R2.12 and R2.16 to R2.18: peak RSS, seconds per line, iterations and exploitability of `library-builder --once --job-spec` under the 5 GB Docker limit (O-48) against O-50, the 32-bit run judged and the 16-bit run informational (O-200). |
| `phase-2-gate.md` | S20 | Markdown | Phase 2 gate and Deploy 1 report, R2.1 to R2.22, with the O-50 memory and O-51 storage pass rules; G4 (R2.11) stays private and is noted. |
| `recompute.json` | S29, `tools/validate recompute` | JSON gate report | Criterion 3: 200 seeded attempts recomputed through `gto-library` on a path that never calls `solver-query`, the seed in the report (O-60). |
| `matrix-frame-zenbook.json` | S24, `just bench-web` on the Zenbook under the bench lock | JSON gate report (the matrix frame section above) | R3.12: the range matrix frame p95 under 16 ms per mode at device pixel ratio 2 in headless Chromium, with the renderer named (A7 section 4, O-260). |
| `perf-zenbook.json` | S23, `just perf` on the Zenbook under the bench lock (the trainer latency section above); S29 reruns it for the gate | JSON gate report | R3.3 and criterion 10 on the Zenbook: study node read, grade and decision to feedback p95 against the O-40 thresholds; hosted CI checks the committed file and times the `e2e` job as an advisory only. |
| `keying.json` | S29 | JSON gate report | Criterion 11: live rake keyed by the selected stake over 1/3 and 2/5 (O-18, O-57). |
| `phase-3-gate.md` | S29 | Markdown | Phase 3 gate, R3.1 to R3.22, with criteria 3, 4, 5, 9, 10 (Zenbook) and 11 by report path; the build-card run names drills only (O-64). |
| `phase-4-gate.md` | S33 | Markdown | Phase 4 gate, R4.1 to R4.15, criteria 6, 7 and 8; criterion 6 convergence within the O-65 tolerance (25 rating points after 300 items) and the ADR 0011 parameters as accepted per O-56. |
| `deploy-2.md` | S34 | Markdown | R4.16: the post-deploy report with the Mac p95 (O-21), peak RSS, the backup and the restore drill, the full-history guard scan. |
| `v1-gate.md` | S34, `just v1-gate` | Markdown with the command output | R4.17: all eleven criteria with their report paths, public here and private in the capture repo; the command asserts every linked report exists and passes. |

Pending tests are the other half of this evidence (R0.11): `just test-tags` (`scripts/check-test-tags.mjs`) lists every `it.todo`, skipped or `#[ignore]` test and fails when one carries no R ID, so a requirement's red tests can be found by its identifier before its report exists.
