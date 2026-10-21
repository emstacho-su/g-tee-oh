# Validation reports

This directory holds the reports that prove requirement identifiers (R IDs) for the public gates (A1 section 1 reserves `validation/reports/` for generated gate reports, public gates only). A report is evidence, so two rules apply:

1. A report is written by the tool that measured it, never by hand. `just bench` writes `bench-zenbook.json` through `scripts/bench-report.mjs`; `just library-size-estimate` writes `library-size-estimate.md` through `library-pack estimate` (S14); the Phase 2 validation gates G1 to G7 (04 section 6) will write theirs through `tools/validate` once S13 lands. To change a number, check out the commit you want on record, rerun the tool and commit what it wrote. The Markdown gate summaries (`phase-0-gate.md`, and `mac-bootstrap.md` once S04 lands) are the exception in form only: the session that closes a gate assembles them from tool output and run links, and they are not edited after the gate closes.
2. Every report names the R IDs it proves: the `r_ids` field in a JSON (JavaScript Object Notation) report, the R ID column in a Markdown gate report. A reviewer can then go from a requirement to its evidence without reading the tool.

S05 added the schema every JSON report follows and the table of report files (R0.11). Later sessions add their report kinds below as they write them: S13 the G1 to G3 gate reports, S29 the Phase 3 reports.

## Benchmark reports: `bench-<machine>.json` (R0.10)

Produced by `just bench`. `cargo bench -p gto-solve -p gto-library --features gto-library/synthetic` runs the three criterion targets A9 section 1 names (solve iteration, chunk decode, node read), five bench ids in all since S14, each writing `target/criterion/<group>/<function>/new/estimates.json`; `node scripts/bench-report.mjs` then reads every such file plus the `benchmark.json` beside it and writes the report. The script refuses to write when no estimate exists and when one of the five ids is missing, so the committed file is always one complete run. `BENCH_MACHINE=<name>` changes the machine name and the file name; the default is `zenbook`, the baseline the phase docs call the Zenbook baseline, which later becomes the 95th percentile latency (p95) guard baseline (O-40).

Top-level fields, in the order the file carries them:

| Field | Type | Meaning |
|---|---|---|
| `report` | string | Always `bench`. |
| `r_ids` | string array | The R IDs the file proves; `["R0.10"]`. |
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

The five ids in v1 (S14 replaced the `chunk_decode/stub` and `node_read/stub` placeholders with the library format, R2.7):

| id | Measures | Status |
|---|---|---|
| `solve_iteration/simple_tree_flop` | One discounted counterfactual regret minimization (DCFR) iteration of the vendored engine on a small simple-tree heads-up flop spot; the spot is described in `crates/gto-solve/benches/solve_iteration.rs`. | Real measurement. |
| `chunk_decode/preflop_169` | One data frame of a library file (about 64 KiB of dense 169-hand preflop records, seed 0 synthetic tree) decompressed with `decode_frame` and every record in it decoded; `crates/gto-library/benches/chunk_decode.rs`. | Real measurement, synthetic data. |
| `chunk_decode/postflop_1326_sparse` | The same for a frame of flop records that hold half of the live combos. | Real measurement, synthetic data. |
| `node_read/warm_cache` | One `Reader::node` read of a preflop node whose frame sits in the least recently used (LRU) cache: key hash, index lookup and record decode; `crates/gto-library/benches/node_read.rs`. | Real measurement, synthetic data. |
| `node_read/cold_cache` | The same read through a reader whose cache holds 0 bytes, so every read fetches the frame from the in-memory store and decompresses it: the cost of a cache miss. | Real measurement, synthetic data. |

Example, shortened:

```json
{
  "report": "bench",
  "r_ids": ["R0.10"],
  "machine": { "name": "zenbook", "os": "win32 10.0.26200", "cpu": "...", "cores": 20, "memory_gb": 32 },
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "date": "2026-10-20T18:00:00.000Z",
  "toolchain": "rustc 1.99.1 (58cf8f9c3 2026-10-13)",
  "measurements": [
    { "id": "chunk_decode/postflop_1326_sparse", "mean_ns": 9800.5, "median_ns": 9700.0, "unit": "ns", "stub": false },
    { "id": "chunk_decode/preflop_169", "mean_ns": 1500.2, "median_ns": 1480.0, "unit": "ns", "stub": false },
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

Every JSON report in this directory validates against `report.schema.json`, a JSON Schema (draft 2020-12). The schema fixes the envelope, so a reviewer or a tool (the `just v1-gate` check in S34, R4.17) reads every report the same way; the measurement ids and the thresholds inside the envelope are each report's own and are documented in that report's section of this file. Markdown gate summaries (`phase-0-gate.md` and the others in the table below) are assembled by hand from tool output and run links and do not use the schema; they carry the R ID column instead.

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

Validating a report: no validator is committed yet, because the tools that write the gate reports land in S13 (`tools/validate`) and S29 (`just perf`), and a `just report-check` recipe belongs with them. Until then, validate a report with ajv-cli fetched by npx, which is not a repository dependency:

```powershell
npx --yes ajv-cli@5 validate --spec=draft2020 -s validation/reports/report.schema.json -d validation/reports/bench-zenbook.json
```

A report that fails the schema is not evidence.

## Report files (O-87)

09 section 7 names where each gate report lands and O-87 fixes the file names 09 left open; `v1-gate.md` and the Phase 0 names come from 09 section 7 and the phase doc. The table lists every public report, who writes it and what it proves, so a session knows the name before it writes. Markdown files are gate summaries; JSON files follow `report.schema.json`. The two O-87 names that are fixtures rather than reports, `PROVENANCE-g6a.md` and `g4-spots.json`, live under `validation/fixtures/` and are described in that directory's README. Private reports (the Phase 1 exit, the G4 report, the coverage and quality assurance reports) stay in the capture repo and are only linked from here.

| File | Written by | Form | Proves |
|---|---|---|---|
| `phase-0-gate.md` | S06, started by S01 | Markdown | Phase 0 gate, repo part: R0.1 to R0.8 and R0.10 to R0.12, with the throwaway AGPL (GNU Affero General Public License) and guard runs linked and the private continuous integration (CI) result for R0.8 noted. |
| `mac-bootstrap.md` | S04 | Markdown | Phase 0 gate, Mac part: R0.9 against O-50 (peak resident set size (RSS) under 5 GB and under 30 minutes to 0.3 percent pot per preflop line), the Docker memory per O-20, nothing left running per O-47. |
| `bench-zenbook.json` | S02, `just bench` | JSON baseline | R0.10. The p95 guard baseline that O-40's thresholds are later measured against; the benchmark section above has the fields. |
| G1, G2 and G3 reports | S13, `tools/validate`, then every CI run | JSON gate reports, named by S13 | R2.4 (Kuhn), R2.5 (AKQ (ace, king, queen) and the toy river games) and R2.6 (Leduc against the committed OpenSpiel exploitability curve, O-30) with the 04 section 6 pass rules as thresholds. |
| `library-size-estimate.md` | S14, `just library-size-estimate` (`library-pack estimate`) | Markdown, tool-written | R2.7: bytes per runout and per flop tree on synthetic trees with the method and seed, set against 02 section 5.2 and O-51 (the section above); the chunk decode number lives in the bench JSON. |
| `bench-flop-line-zenbook.md` | S18 | Markdown | R2.12 and R2.16 to R2.18: peak RSS, seconds per line, iterations and exploitability of `library-builder --once` under the 5 GB Docker limit (O-48) against O-50. |
| `spike-preflop-zenbook.md` | S19 | Markdown | The push/fold spike on the Zenbook (R2.21, O-49): peak bytes and seconds, the 100 big blind figure measured or labeled extrapolated, and the O-4 answer. |
| `spike-preflop-mac.md` | S20 | Markdown | R2.21 rerun in the builder container on the Mac against O-48 and O-49. |
| `phase-2-gate.md` | S20 | Markdown | Phase 2 gate and Deploy 1 report, R2.1 to R2.22, with the O-50 memory and O-51 storage pass rules; G4 (R2.11) stays private and is noted. |
| `recompute.json` | S29, `tools/validate recompute` | JSON gate report | Criterion 3: 200 seeded attempts recomputed through `gto-library` on a path that never calls `solver-query`, the seed in the report (O-60). |
| `perf-zenbook.json` | S29, `just perf` | JSON gate report | Criterion 10 on the Zenbook: p95 against the O-40 thresholds; hosted CI checks the committed file and times the `e2e` job as an advisory only. |
| `keying.json` | S29 | JSON gate report | Criterion 11: live rake keyed by the selected stake over 1/3 and 2/5 (O-18, O-57). |
| `phase-3-gate.md` | S29 | Markdown | Phase 3 gate, R3.1 to R3.22, with criteria 3, 4, 5, 9, 10 (Zenbook) and 11 by report path; the build-card run names drills only (O-64). |
| `phase-4-gate.md` | S33 | Markdown | Phase 4 gate, R4.1 to R4.15, criteria 6, 7 and 8; criterion 6 convergence within the O-65 tolerance (25 rating points after 300 items) and the ADR 0011 parameters as accepted per O-56. |
| `deploy-2.md` | S34 | Markdown | R4.16: the post-deploy report with the Mac p95 (O-21), peak RSS, the backup and the restore drill, the full-history guard scan. |
| `v1-gate.md` | S34, `just v1-gate` | Markdown with the command output | R4.17: all eleven criteria with their report paths, public here and private in the capture repo; the command asserts every linked report exists and passes. |

Pending tests are the other half of this evidence (R0.11): `just test-tags` (`scripts/check-test-tags.mjs`) lists every `it.todo`, skipped or `#[ignore]` test and fails when one carries no R ID, so a requirement's red tests can be found by its identifier before its report exists.
