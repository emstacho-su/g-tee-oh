# Validation reports

This directory holds the reports that prove requirement identifiers (R IDs) for the public gates (A1 section 1 reserves `validation/reports/` for generated gate reports, public gates only). A report is evidence, so two rules apply:

1. A report is written by the tool that measured it, never by hand. `just bench` writes `bench-zenbook.json` through `scripts/bench-report.mjs`; the Phase 2 validation gates G1 to G7 (04 section 6) will write theirs through `tools/validate` once S13 lands. To change a number, check out the commit you want on record, rerun the tool and commit what it wrote. The Markdown gate summaries (`phase-0-gate.md`, and `mac-bootstrap.md` once S04 lands) are the exception in form only: the session that closes a gate assembles them from tool output and run links, and they are not edited after the gate closes.
2. Every report names the R IDs it proves: the `r_ids` field in a JSON (JavaScript Object Notation) report, the R ID column in a Markdown gate report. A reviewer can then go from a requirement to its evidence without reading the tool.

Later sessions add their report kinds below: S05 the fixture and test-vector reports (R0.11), S13 the gate reports.

## Benchmark reports: `bench-<machine>.json` (R0.10)

Produced by `just bench`. `cargo bench -p gto-solve -p gto-library` runs the three criterion targets A9 section 1 names (solve iteration, chunk decode, node read), each writing `target/criterion/<group>/<function>/new/estimates.json`; `node scripts/bench-report.mjs` then reads every such file plus the `benchmark.json` beside it and writes the report. The script refuses to write when no estimate exists and when one of the three ids is missing, so the committed file is always one complete run. `BENCH_MACHINE=<name>` changes the machine name and the file name; the default is `zenbook`, the baseline the phase docs call the Zenbook baseline, which later becomes the 95th percentile latency (p95) guard baseline (O-40).

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
| `stub` | boolean | True when the id ends in `/stub`: the routine is a placeholder and the number is not a product measurement. |

The three ids in v1:

| id | Measures | Status |
|---|---|---|
| `solve_iteration/simple_tree_flop` | One discounted counterfactual regret minimization (DCFR) iteration of the vendored engine on a small simple-tree heads-up flop spot; the spot is described in `crates/gto-solve/benches/solve_iteration.rs`. | Real measurement. |
| `chunk_decode/stub` | A `std::io::Read` copy of a 64 KiB buffer. | Stub until S14 lands the library format (R2.7), then a zstd chunk decode. |
| `node_read/stub` | One `HashMap` lookup. | Stub until S14 lands the library format (R2.7), then a node read through the manifest index. |

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
    { "id": "chunk_decode/stub", "mean_ns": 1500.2, "median_ns": 1480.0, "unit": "ns", "stub": true },
    { "id": "node_read/stub", "mean_ns": 12.5, "median_ns": 12.0, "unit": "ns", "stub": true },
    { "id": "solve_iteration/simple_tree_flop", "mean_ns": 21500000.5, "median_ns": 21000000.0, "unit": "ns", "stub": false }
  ]
}
```

Reading a baseline: compare `median_ns` of the same id across commits on the same machine; the mean is kept because criterion reports both and outliers move it first. Numbers from different machines are different baselines, never a regression.
