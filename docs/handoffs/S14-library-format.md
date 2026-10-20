---
id: 'g-tee-oh-handoff-s14-library-format'
title: 'S14 Library format'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 2
session: 'S14'
branch: 'p2/library-format'
tags: [g-tee-oh, handoff, phase-2]
---
# S14 Library format (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-2-engine-and-pipeline|Phase 2 Engine validation and solution pipeline]]. This session produces the library format E1 in the `gto-library` crate (node record, quantization, zstd chunks, manifest, checksums, a reader with lazy chunks and a bounded cache), the `tools/library-pack` command that turns a generic node dump into that format, the synthetic-record size estimate and the reader benchmarks (R2.7, R2.8). It runs on branch `p2/library-format` in parallel group C, earliest day 3 (2026-10-22), paced for week 1 ([[projects/g-tee-oh/planning/09-v1-sprint-roadmap|09 v1 sprint roadmap]] sections 4 and 5). It is a public session at high usage, and its build step runs as a dynamic workflow. It sits on the public critical chain (track A), so it goes first in its week's queue. Requirement identifiers (R IDs) follow 09 section 6 and open-question identifiers (O-IDs) follow 00.

## Before pasting

- [ ] S12 is merged into `sprint/1-v1`: `gto-model` provides the encodings the records key on (09 section 3).
- [ ] Practical input, not a 09 section 3 edge: the manifest and node-dump JSON schemas from S06 (R0.7) if S06 has landed. If not, this session writes their content and S06 reconciles (open, see problems list in the Phase 2 plan; the prompt says what to do).
- [ ] The clone at `C:\Users\stack\projects\g-tee-oh` is on `sprint/1-v1` and clean.
- [ ] Nothing else is needed from the owner.

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull --ff-only
git switch -c p2/library-format
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault and append any new O-ID to `planning/00-open-questions-and-risks.md`.
2. Stay in the default permission mode, so you approve the workflow when it launches.
3. Paste the prompt below.

## The prompt

```text
Role and context
You are running session S14 of sprint 1 of g-tee-oh, Phase 2 (engine validation and solution pipeline), on branch p2/library-format off the sprint branch sprint/1-v1. Goal: library format E1 with writer and reader in gto-library, tools/library-pack, the synthetic-record size estimate and the reader benchmarks (R2.7, R2.8).

Reading order (vault root V = C:\Users\stack\vault\projects\g-tee-oh)
1. V\planning\phases\phase-2-engine-and-pipeline.md
2. V\planning\09-v1-sprint-roadmap.md sections 3, 5 (row S14), 6 (R2.7, R2.8, R1.5) and 7
3. V\planning\00-open-questions-and-risks.md, the answered questions O-17 to O-67 (O-17, O-30, O-53 matter most)
4. V\planning\01-product-spec.md section 6 criterion 2; V\planning\02-architecture.md section 5; V\planning\04-solver-engine.md section 7
5. V\planning\architecture\A3-library-format.md (whole); A2-engine.md sections 1, 2 and 5; A1-repo-and-conventions.md sections 2, 3 and 5; A9-quality-security-ops.md section 1
6. V\decisions\ files 0018, 0019 and 0023
7. The repo's CLAUDE.md, packages/contracts/schemas/ if it exists, and any docs/ mirrored files that exist

Rules
- Clone C:\Users\stack\projects\g-tee-oh, Claude Code in PowerShell, native Windows Rust toolchain; WSL2 (Windows Subsystem for Linux 2) only for Linux container builds and benchmarks (O-23).
- Branch p2/library-format off sprint/1-v1; merge by pull request into sprint/1-v1; sprint/1-v1 reaches main only in S35 (R4.18).
- Development gates in order: plan first in plan mode and wait for my approval (trivial one-liners exempt); concrete task list; smallest working increment; tests green before advancing, never on red, and write the suite if none exists; /code-review and fix CRITICAL and HIGH findings; /security-review for anything touching user input (the pack tool parses external files, so run it); conventional commits (feat:, fix:, chore:, refactor:, docs:, test:, perf:, ci:) ending with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Test-driven: red test tagged with its R ID first, then green, then refactor; 80 percent coverage or better on new code.
- Accepted ADRs (architecture decision records) are fixed; if a step would contradict one, stop and raise it. Cite O-IDs and ADR numbers wherever you use an answer or a decision.
- Privacy: nothing GTO Wizard-specific enters this repo (O-26, ADR 0017, ADR 0021). The pack tool is generic: it reads the node-dump schema and knows nothing about where a dump came from (A2 section 6). Every dump in this repo is synthetic.
- A step runs as a dynamic workflow only where this prompt says so in my words. Keep every workflow under 10 agents and name what its verifier runs.
- Report honestly at every gate: show failing test output; name any skipped step.
- Any documentation you write: no em dashes or en dashes, no bold, acronyms expanded on first use, mechanism before conclusion.

Inputs
- A3 section 2 (bucket layout), section 3 (manifest with format_version 1), section 4 (binary node record: 8-bit frequencies, 16-bit loss in 0.01 percent of pot units, ev_best as f32, sparse hands), section 5 (read path: per-solution index, least recently used (LRU) cache bounded by QUERY_CACHE_BYTES, checksum on first open, unavailable on mismatch).
- A2 section 2 gto-library types; A2 section 5 determinism and numerics.
- The criterion 2 invariants: every hand's action frequencies sum to 1 within 0.001, an expected value (EV) per action, complete configuration metadata.
- Schemas: packages/contracts/schemas/manifest.json and node-dump.json carrying a schema version (R0.7). If they do not exist yet, write them here from A3 sections 3 and 4 with schema_version 1, record a proposed O-ID that S14 owns their content and S06 owns the pipeline, and tell me in the report.
- The R0.10 benchmark harness (criterion) and the Zenbook baseline in validation/reports/bench-zenbook.json.
- Storage context for the size estimate: 02 section 5.2, R-19, O-14 (K = 20 for frequent pairs).

Requirements this session closes (tests copied from the phase doc)
- R2.7 Library format E1: node record, 8-bit frequencies and 16-bit loss units, zstd chunks, manifest with JSON Schema, sha256 checksums, format_version, reader with lazy chunks and an LRU cache bounded by QUERY_CACHE_BYTES. Test: proptest quantize then dequantize within tolerance; insta snapshots of records and manifests; a corrupted checksum marks the build unavailable; chunk decode benchmark; synthetic-record size estimate recorded (R-19).
- R2.8 tools/library-pack converts the node-dump schema into library format. Test: a synthetic dump packs and reads back identically; a dump failing a criterion 2 invariant is rejected.

Steps
1. (single) Read everything above. Enter plan mode: crate layout (record, quantize, chunk, manifest, checksum, writer, reader, cache), the pack tool's command-line interface (CLI), the synthetic dump generator used by the tests, the benchmark set, and the size-estimate method (a simple tree of about 1,000 nodes along one runout, sparse hands, compressed; report bytes per runout and per flop tree). Wait for my approval.
2. (single) Write the red tests tagged R2.7 and R2.8: the proptest, the snapshot tests, the corrupted-checksum test, the round trip and the invariant rejection test. Commit red.
3. Use a dynamic workflow for this step, under 7 agents: writer (record layout, quantization, zstd chunks, sha256, manifest); reader (index per opened solution, lazy chunk loading, LRU cache bounded by QUERY_CACHE_BYTES, checksum check on first open, unavailable on mismatch, format_version N and N-1 where N-1 is a no-op in v1); pack tool (node dump to library format with the criterion 2 invariant checks); manifest and schema finalization plus benchmarks (chunk decode and node read with criterion, the size estimate written to validation/reports/library-size-estimate.md); one integrator for shared types; the verifier agent runs the full round trip, the invariant rejection test, the snapshot tests and the size estimate, and reports any red test verbatim.
4. (single) Integrate, run just bench and commit the JSON, run /code-review and /security-review (the pack tool parses files) and fix CRITICAL and HIGH, open the pull request into sprint/1-v1 with R2.7 and R2.8 in the template.

Definition of done
- [ ] R2.7 and R2.8 tests green, tagged; insta snapshots committed; the corrupted-checksum test marks the build unavailable.
- [ ] validation/reports/library-size-estimate.md records bytes per runout and per flop tree with the method, and the chunk decode benchmark is in the committed bench JSON.
- [ ] Continuous integration (CI) rust job green; coverage of gto-library and tools/library-pack at 80 percent or better.
- [ ] /code-review and /security-review done; CRITICAL and HIGH findings fixed.
- [ ] Pull request opened into sprint/1-v1 listing R2.7 and R2.8.

Report back
Your final message lists: each R ID with its test command and result; the branch and pull request link; the files written; the size estimate numbers and the bench numbers against the R0.10 baseline; usage notes (units used against the planned high level, about 3); any new question as a proposed O-ID with a default, appended to V\planning\00-open-questions-and-risks.md under a new dated subsection.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| `crates/gto-library/` writer, reader, quantization, chunks, manifest, checksums | public repo, branch `p2/library-format` |
| `tools/library-pack/` CLI | public repo |
| Manifest and node-dump JSON schemas (if not already present from S06) | `packages/contracts/schemas/` |
| insta snapshots, proptest and round-trip tests tagged R2.7, R2.8 | `crates/gto-library/tests/`, `tools/library-pack/tests/` |
| Size estimate and benchmark results | `validation/reports/library-size-estimate.md`, `validation/reports/bench-zenbook.json` |
| Pull request into `sprint/1-v1` | GitHub |
