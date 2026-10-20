---
id: 'g-tee-oh-phase-2-engine-and-pipeline'
title: 'Phase 2 Engine validation and solution pipeline'
collection: 'g-tee-oh'
type: phase
status: 'planned'
created: 2026-10-19
public: true
phase: 2
tags: [g-tee-oh, phase, sprint-1]
---
# Phase 2 Engine validation and solution pipeline

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/09-v1-sprint-roadmap|09 v1 sprint roadmap]]. The goal of Phase 2, from 09 section 2, is the engine trusted through gates G1 to G4 and G6a, the library format and read service, the planner and builder with runout extraction, the public fixture library, and Deploy 1 with the builder running on the Mac. Its earliest start is day 2 (2026-10-21); it takes 8 days by dependency with Deploy 1 on day 9 at the earliest; the paced calendar in 09 section 4 spreads its sessions over weeks 1 to 3 with Deploy 1 about day 21 (2026-11-09). It costs 22 usage units: four high sessions and five medium ones. Decisions are cited as architecture decision record (ADR) numbers from the [[projects/g-tee-oh/decisions/_README|ADR index]]. Answered questions are cited by their identifier (O-ID) from [[projects/g-tee-oh/planning/00-open-questions-and-risks|00 Open questions and risks]]. Requirement identifiers (R IDs) R2.1 to R2.22 come from 09 section 6. This file is public-safe (O-26): it names GTO Wizard only as the product being emulated and refers to capture detail by link and by O-19.

## MVP

What the next phases need from this one, and nothing more:

- Phase 3 starts against two Phase 2 outputs (09 section 3): the `solver-query` contract, committed as the first commit of S16 (O-38), and the fixture library, which is the G6a push/fold solution from the own engine plus the labeled synthetic sets from S19 (O-30, O-57), served by the real `solver-query` binary and never a mock (O-53).
- Phase 4 ends with Deploy 2, which builds on the Deploy 1 stack, so Deploy 1 (S20) must have happened first (O-20).
- The rest of the phase (G4, the planner, the builder loop, runout extraction, the preflop spike) is what makes Deploy 1 safe and makes the library-first promise (ADR 0018) real: a builder that publishes validated solutions in the background while no request path ever starts a solve.

Success criteria from [[projects/g-tee-oh/planning/01-product-spec|01 Product spec]] section 6:

- Closed in this phase: criterion 1, the toy-game gates G1 to G3 passing in continuous integration (CI), at S13.
- Partly closed: criterion 2 through the public pack round-trip invariants (R2.8); criteria 3, 4 and 5 through the canonical encodings, bucket mapping, format, read service and fixture sources (R2.1, R2.3, R2.7, R2.9, R2.13, R2.19, R2.20); criterion 9 through the insight computations (R2.14); criterion 10 through the no-solve rule enforced at compile time (R2.15), the read-path benchmarks (R2.7, R2.13) and the builder (R2.17, R2.22); criterion 11 through rake keying (R2.2) and the synthetic live sets (R2.20). Their closing tests run at the Phase 3 gate (S29) and the v1 gate (S34).
- Spec item 12 (the builder running on the Mac from the end of Phase 2) is not a numbered criterion; it closes through R2.17 and R2.22 at S20 (09 section 7).

## Scope

In scope:

- `gto-model` canonical encodings, rake models and bucket mapping (R2.1 to R2.3).
- `tools/validate` with G1, G2 and G3 in the CI `rust` job, and the 169 by 169 equity table (R2.4 to R2.6, R2.20 table part).
- Library format E1, its reader and `tools/library-pack` (R2.7, R2.8).
- `gto-tree` and the heads-up postflop solve adapter over the vendored engine (R2.9, R2.10).
- G4 against local oracles through a private program (R2.11).
- `solver-query` with insights, its committed OpenAPI contract and client, the no-solve dependency rule and the latency bench (R2.13 to R2.15).
- `gto-planner`, the builder loop, runout extraction E6b in v1 (O-17), builder settings, the storage ledger, health and metrics, `--once` (R2.12, R2.16 to R2.18).
- G6a heads-up push/fold, the synthetic fixture generator and the preflop spike (R2.19 to R2.21).
- The first real build on the Zenbook (O-41) and Deploy 1 on the Mac with the owner's explicit yes (R2.22, O-20, O-59).

Out of scope: serving scenarios or any postflop screen; G5 and G6b; the 100 big blind (bb) and multiway preflop solvers (E4 beyond push/fold, E5); the `api` service and every web screen (Phase 3); the learning engine (Phase 4); anything that touches capture, which lives in [[projects/g-tee-oh/planning/03-phase-1-data-acquisition|03 Phase 1 data acquisition]] and [[projects/g-tee-oh/planning/architecture/A8-capture-system|A8 capture system (private)]] (O-19).

Sessions (09 section 5; earliest days from 09 section 4, paced weeks from its calendar):

| Session | Handoff | Branch | Group and day | Workflow or single | Visibility | Usage |
|---|---|---|---|---|---|---|
| S12 | [[projects/g-tee-oh/handoffs/S12-gto-model|S12 gto-model]] | `p2/model` | B, day 2; paced week 1 | Workflow | public | high |
| S13 | [[projects/g-tee-oh/handoffs/S13-toy-gates|S13 Toy gates]] | `p2/toy-gates` | C, day 3; paced week 2 | Workflow | public | medium |
| S14 | [[projects/g-tee-oh/handoffs/S14-library-format|S14 Library format]] | `p2/library-format` | C, day 3; paced week 1 | Workflow | public | high |
| S15 | [[projects/g-tee-oh/handoffs/S15-tree-solve|S15 Tree and solve adapter]] | `p2/tree-solve` | C, day 3; paced week 2 | Single | public | medium |
| S16 | [[projects/g-tee-oh/handoffs/S16-solver-query|S16 solver-query]] | `p2/solver-query` | D, day 4; paced week 2 | Workflow | public | high |
| S17 | [[projects/g-tee-oh/handoffs/S17-g4-oracle|S17 G4 oracle]] | `p2/g4-oracle` (private repo) and `p2/validate-g4` (public) | D, day 4; paced week 3 | Single | runs in the private repo for the GNU Affero General Public License (AGPL) boundary only; handoff public-safe (O-43) | medium |
| S18 | [[projects/g-tee-oh/handoffs/S18-builder|S18 Builder]] | `p2/builder` | D, day 4; paced week 2 | Workflow | public | high |
| S19 | [[projects/g-tee-oh/handoffs/S19-g6a-fixtures|S19 G6a and fixtures]] | `p2/g6a-fixtures` | D, day 4; paced week 3 | Workflow | public | medium |
| S20 | [[projects/g-tee-oh/handoffs/S20-deploy-1|S20 Deploy 1]] | `p2/deploy-1` | F, day 9; paced week 3, about day 21 | Single, owner present at the Mac (O-59) | public | medium |

Deferred to v1.5 where it touches this phase (09 section 9):

| Item | Reason |
|---|---|
| Serving scenarios and the postflop trainer | The builder writes scenarios in v1 (O-17) so content exists at v1.5 launch, but every v1 criterion is preflop |
| G5 (heads-up flop fixtures from captured aggregated reports) and G6b | G5 needs later capture steps; G6b needs the multiway preflop solver. [[projects/g-tee-oh/planning/07-roadmap|07 Roadmap]]'s Phase 2 gate wording ("once G4 passes, start the builder") validates river and turn solves, not flop builds. Flop validation is G5 in v1.5, and this gap is deliberate (09 section 10) |
| Own preflop solver beyond push/fold, the P1 versus P2 treatment choice, the reference-to-own source switch | The reference bootstrap keeps v1 independent of R-5; the spike (O-49) sizes the work |
| Turn roots for every turn card (O-15) | A3 section 2 reserves the path; nothing is built in v1 |
| Serving ante variants (O-33) and 6 to 8 handed live configurations (O-10) | Stored, not served |
| `library-migrate` | v1 ships one `format_version` |
| The optional cloud accelerator (O-4) | Off unless the spike fails; S19 records the O-4 decision |

## Blockers/Constraints

Dependencies (09 section 3):

- Phase 0 blocks this phase: the workspace, vendored engine, CI and guard (S01); the red tests and fixtures (S05); the migrations, roles and catalog seed (S02); the contracts pipeline and skeletons (S06). S12 waits only on S01 and writes its own two R0.11 vectors red first.
- Phase 1 blocks this phase at one point: the builder's first real build needs the first packed configuration with its sizing convention (S10, R1.7, O-37). If no pack exists when S20 runs, Deploy 1 proceeds with a smoke build on the synthetic 6-max ranges under a `smoke/` prefix, deleted after the report (O-61).
- Inside the phase: S12 before S13, S14, S15 and S19; S13 before S16, S17 and S19; S14 before S16, S18 and S19; S15 before S17, S18 and S19; S17 and S18 before S20; S04 before S20 (O-20); the S19 spike and fixtures before S20 (the Phase 2 services-and-gates group feeds Deploy 1 with "G4 passed, builder image, spike"). Each handoff's "Before pasting" list repeats its edges.
- This phase blocks Phase 3 (the contract and the fixture library) and Phase 4 (Deploy 1 before Deploy 2).

Owner tasks (O-67):

- S04, the Mac bootstrap, any evening before S20; its report at `validation/reports/mac-bootstrap.md` closes the Mac part of the Phase 0 gate and S20 checks it before Deploy 1 (R0.9, O-47, O-50).
- S20 itself: the owner is present at the Mac for Deploy 1 and gives the explicit yes at that moment (O-20, O-59). If the owner is unavailable, S20 slips inside week 3 and O-61 covers a missing pack.
- The 2/5 live rake cap verification before S11 (O-2, O-66). R2.2's test passes either way because the caps differ in bb at the two stakes; until verified the catalog row stays flagged.
- The build card export (O-24) is a Phase 3 input and does not block this phase.

Machine limits:

- The Mac has 16 GB of memory (R-9). The Docker virtual machine gets 10 GB and the builder a 5 GB cap, inside the [[projects/g-tee-oh/planning/02-architecture|02 Architecture]] section 6.2 budget (O-20).
- On the Zenbook, Rust builds with the native Windows toolchain and Windows Subsystem for Linux 2 (WSL2) is used only for Linux container builds and benchmarks (O-23). The 5 GB cap is emulated by a Docker memory limit of 5 GB in WSL2 for the spike and the builder tests (O-48).
- Library storage is budgeted at about 650 GB (ADR 0018, R-19); Deploy 1 checks the projection (O-51).

Privacy boundary (O-26, ADR 0017, ADR 0021): the public repo receives nothing GTO Wizard-specific. Reference solutions are read from the private bucket and never committed. S17 runs in the private capture repo only because of the AGPL boundary (ADR 0002, O-31) and carries no capture detail, so its handoff is public-safe (O-43). G4's report stays private; the public `tools/validate g4` step runs on a generic dump.

Binding ADRs: 0002 (engine base, no AGPL in the public repo), 0004 (poker math in Rust, accepted per O-25), 0005 (Postgres plus an S3-compatible store, where S3 is the Simple Storage Service interface; dbmate, Kysely and sqlx per O-56), 0013 (equilibrium reach as the frequency prior, accepted per O-25), 0014 (rake models), 0015 (the multiway cap, which keeps the v1 builder heads-up), 0018 (library-first), 0019 (SeaweedFS), 0020 (the tree decides the buttons), 0023 (scenarios).

Binding answers: O-4, O-13, O-14, O-17, O-20, O-22, O-23, O-27, O-28, O-29, O-30, O-31, O-32, O-37, O-38, O-41, O-43, O-46, O-47, O-48, O-49, O-50, O-51, O-52, O-53, O-57, O-59, O-61, O-62, O-63, O-66, O-67. Where an overview disagrees with the architecture set, the architecture set and the answered question win (O-27); the errata in 09 section 10 list the cases this phase meets: the oracle as a linked crate per O-31, the `query` role per O-28, the `scenario` table in v1 per O-17, G6a in public CI per O-63.

## Inputs

- Documents: [[projects/g-tee-oh/planning/04-solver-engine|04 Solver engine]] (whole), [[projects/g-tee-oh/planning/architecture/A1-repo-and-conventions|A1 repo and conventions]] sections 2 to 6, [[projects/g-tee-oh/planning/architecture/A2-engine|A2 engine]], [[projects/g-tee-oh/planning/architecture/A3-library-format|A3 library format]], [[projects/g-tee-oh/planning/architecture/A4-data-model|A4 data model]], [[projects/g-tee-oh/planning/architecture/A5-services-and-interfaces|A5 services and interfaces]], [[projects/g-tee-oh/planning/architecture/A9-quality-security-ops|A9 quality, security and operations]], 02 Architecture sections 3.2, 5.2 and 6.2, the 07 Roadmap Phase 2 checklist (indicative only), the [[projects/g-tee-oh/planning/08-glossary|08 Glossary]].
- From Phase 0: the vendored engine under `crates/vendor/postflop-engine` with `UPSTREAM.md` (R0.2); the Kuhn, AKQ (the ace, king, queen toy game) and Leduc fixtures and the OpenSpiel Leduc curve with `PROVENANCE.md` (R0.11, O-30); the `validation/reports/` format (R0.11); the migrations, roles and catalog seed with placeholder sizing conventions (R0.6); the contracts pipeline and the manifest and node-dump JSON schemas (R0.7); the compose `dev` profile (R0.5); the Zenbook benchmark baseline `validation/reports/bench-zenbook.json` (R0.10); the Mac bootstrap report (R0.9).
- From Phase 1: the first packed configuration and its sizing convention row (R1.7, O-37), read from the `reference-private` bucket; nothing else.
- Owner-provided: the Mac with Docker, the external drive and the clone at `~/projects/g-tee-oh` (O-59); the AGPL oracle crate fetched into the private repo for S17 (O-31); the explicit yes at Deploy 1 (O-20).
- Produced inside the phase and consumed later in it: `gto-model` (S12), `tools/validate` and the equity table (S13), the format and reader (S14), the trees and adapter (S15), the builder image (S18), the fixture library and spike report (S19).

## Instruments

| Instrument | Pass rule | Set by |
|---|---|---|
| G1 report from `tools/validate` in the CI `rust` job | Kuhn game value within 0.001 of minus 1/18; exploitability below 0.001 | 04 section 6; R2.4 |
| G2 report in CI | AKQ and toy river bluff and defense frequencies within 0.5 points of closed form | 04 section 6; R2.5 |
| G3 report in CI | Leduc exploitability curve within tolerance of the committed OpenSpiel fixture; no document sets the number (O-79, answered in 00) | 04 section 6; O-30; R2.6 |
| G4 report, private | Both sides at 0.3 percent pot or better; mean absolute frequency difference under 2 points; root expected value (EV) within 0.3 percent pot | 04 section 6; O-31; R2.11 |
| G6a report in public CI | Exact match to the computed equilibrium; agreement with published charts except at documented near-indifferent hands; chart source and parameters in a provenance note | 04 section 6; O-63; R2.19 |
| `gto-model` tests | Unit vectors pass; proptest node-key round trip, suit-permutation invariance, flop weights summing to 22,100; the R0.11 bucket-edge table (25, 50, 75, 110, 150 percent of pot, upper edge inclusive, all-in separate); rake: 1/3 at a $5 cap gives 167 centi-big-blinds (cbb), 2/5 at the $5 default gives 100 cbb, no rake at a preflop terminal, a different `config_id` per stake | A3 section 1; ADR 0008, 0014, 0020; R2.1 to R2.3 |
| `gto-library` tests and benchmarks | proptest quantize then dequantize within tolerance; insta snapshots of records and manifests; a corrupted checksum marks the build unavailable; chunk decode benchmark recorded; synthetic-record size estimate recorded | A3 sections 3 to 5; R2.7 |
| `tools/library-pack` round trip | A synthetic dump packs and reads back identically; a dump failing a criterion 2 invariant (sums within 0.001, an EV per action, complete metadata) is rejected | R1.5, R2.8 |
| `gto-tree` tests | proptest: never two sizes in one bucket at a node; insta golden tree hash stable across machines | ADR 0020; R2.9 |
| Solve adapter integration test | A small flop solve reaches its target; a problem above the memory cap is refused before allocation | A2 section 3; R2.10 |
| Extraction proptest | Permute then extract equals extract then permute | A2 section 3; R2.12 |
| `contracts` CI job | Regenerated `solver-query.openapi.json` and its client match the committed files | A1 section 3; O-38; R2.13 |
| Grade recomputation check | `/v1/grade` equals a direct reader recomputation on a fixture solution, with the preflop floor max(0.2 percent pot, the reported accuracy, else 0.02bb) | O-22; R2.13 |
| Grade latency bench | 95th percentile (p95) under 30 ms with a warm cache, measured on the Zenbook with the R0.10 harness and committed as JSON; hosted CI checks the committed file (O-86, answered in 00) | A9 section 6; O-40 pattern; R2.13 |
| No-solve dependency steps in CI | `cargo tree -p solver-query` contains no `gto-solve`; `pnpm why` shows `api` without the builder | A1 section 2; R2.15 |
| `gto-planner` unit tests | Under a fixed budget, scheduling stops at the budget and evicts nothing; priority equals seat rotation times equilibrium reach | ADR 0013, 0018; O-14; R2.16 |
| Builder integration test | Against Postgres and SeaweedFS in the compose `dev` profile with a tiny real solve: one-transaction publish of `solution` and `scenario` rows, `NOTIFY coverage_added` observed, a job parked after three failures | A5 section 4; R2.17 |
| Builder operations tests | A `builder_setting` change takes effect on the next claim; `/metrics` scrape test; `--once` runs one job in the foreground | A1 section 6; A2 section 6; R2.18 |
| Fixture generator tests | Deterministic from seed; every set passes the library-pack invariants and loads in `solver-query`; the live sets carry `synthetic: true` | O-30, O-57; R2.20 |
| Spike report per machine | Push/fold runs inside the 5 GB Docker limit on the Zenbook (O-48) and again on the Mac; heads-up 100bb only if a minimal run fits, else extrapolated and labeled; if measured, peak bytes under 4 GB and one configuration to its in-abstraction target in under 12 hours; O-4 recorded; push/fold has no time bound in any document (O-80, answered in 00) | O-48, O-49; R2.21 |
| Zenbook flop-line benchmark (S18) and the Mac flop solve (S20) | Peak resident set size (RSS) under 5 GB and under 30 minutes to 0.3 percent pot per preflop line on the simple tree at 100bb with 16-bit storage | O-50; R2.18, R2.22 |
| Deploy 1 report, `validation/reports/phase-2-gate.md` | One published build at target exploitability; per-container peak RSS against the 02 section 6.2 budget; bytes per runout and the projection at K = 20 for the top pair over all 1,755 flops plus 184-flop subsets at K = 10 for the next pairs inside 650 GB, lowering K before narrowing flops; K written to `builder_setting`; a coverage row and a notify observed; the first backup present with one solution restored from it | O-20, O-51, O-52; R2.22 |
| `just` targets | `just bench` (R0.10); `just guard-history` before any merge that touched fixtures; `just mac-up` at Deploy 1 (A9 section 5) | A1, A9 |

## Requirements

| ID | Requirement | Test or gate artifact | Success criterion | Session |
|---|---|---|---|---|
| R2.1 | `gto-model` canonical encodings with test vectors: cards, 169-class and 1,326-combo indexes, canonical flop with multiplicity weights summing to 22,100, node key round trip, action tokens, spot-class key (A3 section 1) | Unit tests on the vectors; proptest node-key round trip, suit-permutation invariance, weight sum | 3 | S12 |
| R2.2 | Rake models (E2): one online profile; live 10 percent to the stake's cap converted to cbb, no flop no drop (ADR 0014); configurations keyed by stake | Unit tests: 1/3 with a $5 cap gives 167 cbb; 2/5 with the $5 default gives 100 cbb; no rake at a preflop terminal; the same action at 1/3 and 2/5 yields a different `config_id` | 11 | S12 |
| R2.3 | Bucket mapping in `gto-model` with contiguous edges, upper edge inclusive, all-in separate (ADR 0008); the only implementation of this poker number (ADR 0004) | The R0.11 bucket-edge table passes: every edge, one tick above, all-in | 4 | S12 |
| R2.4 | G1 Kuhn poker: game value within 0.001 of minus 1/18, exploitability below 0.001 | `tools/validate` G1 report in the CI `rust` job | 1 | S13 |
| R2.5 | G2 AKQ and toy river games match closed-form bluff and defense frequencies within 0.5 points | G2 report in CI | 1 | S13 |
| R2.6 | G3 Leduc exploitability curve within tolerance of the committed OpenSpiel fixture (O-30) | G3 report in CI | 1 | S13 |
| R2.7 | Library format E1: node record, 8-bit frequencies and 16-bit loss units, zstd chunks, manifest with JSON Schema, sha256 checksums, `format_version`, reader with lazy chunks and a least recently used (LRU) cache bounded by `QUERY_CACHE_BYTES` | proptest quantize then dequantize within tolerance; insta snapshots of records and manifests; a corrupted checksum marks the build unavailable; chunk decode benchmark; synthetic-record size estimate recorded (R-19) | 3, 10 | S14 |
| R2.8 | `tools/library-pack` converts the node-dump schema into library format | A synthetic dump packs and reads back identically; a dump failing a criterion 2 invariant is rejected | 2 | S14 |
| R2.9 | `gto-tree`: preflop tree from a sizing convention spec, postflop tree config with at most one size per bucket per node, canonical tree hash | proptest: never two sizes in one bucket at a node (ADR 0020); insta golden for the hash, stable across machines | 4, 5 | S15 |
| R2.10 | Heads-up postflop solve adapter over the vendored engine: `estimate_bytes`, stop rule, progress sink, 16-bit default, exact best response | Integration test: a small flop solve reaches target; a problem above the cap is refused before allocation | none (supports the builder) | S15 |
| R2.11 | G4: heads-up river and turn spots versus the local oracles through a private Rust program linking the AGPL crates (O-31), which emits a generic oracle dump; a public `tools/validate g4` step compares | G4 report (both sides at 0.3 percent pot or better, mean absolute frequency difference under 2 points, root EV within 0.3 percent pot), stored privately | none (Phase 2 gate) | S17 |
| R2.12 | Runout extraction E6b in v1 (O-17): K runouts drawn uniformly by seed, every action branch kept, suit permutation applied from canonical to raw | proptest: permute then extract equals extract then permute | none (served in v1.5) | S18 |
| R2.13 | `solver-query`: `/v1/nodes`, `/v1/grade` with the preflop floor from O-22 (max of 0.2 percent pot, the reported accuracy, else 0.02bb), `/v1/insights`, `/v1/sample-action`, `/v1/deal` and reveal, `/v1/coverage`, `/healthz`, `/metrics`; utoipa OpenAPI committed first (O-38) with its TypeScript client; runs under the `query` role (O-28) | Contract diff job; grade equals a direct reader recomputation on a fixture solution; criterion benchmark: grade p95 under 30 ms with a warm cache | 3, 10 | S16 |
| R2.14 | Insights E3: threshold card, noise flags, equity distribution, range and nut advantage, blockers, hand role; preflop equities from the 169 by 169 table shipped with the fixtures (O-32) | Unit tests on hand-built nodes | 9 | S16 |
| R2.15 | No request path starts a solve: `solver-query` has no dependency on `gto-solve`; `api` and `solver-query` never invoke the builder | CI step: `cargo tree -p solver-query` must not contain `gto-solve`; `pnpm why` for `api`; the request-path integration test in R3.4 | 10 | S16 |
| R2.16 | `gto-planner`: build-job enumeration, priority from seat rotation times equilibrium reach (ADR 0013), storage budget, K per position pair (O-14), `blocked_budget` | Unit tests under a fixed budget; scheduling stops at the budget and evicts nothing | none (R-19) | S18 |
| R2.17 | Builder loop: `SKIP LOCKED` claim, exploitability check before publish, one-transaction publish of `solution` and `scenario` rows, `NOTIFY coverage_added`, three failures park the job | Integration test against Postgres and SeaweedFS with a tiny real solve; a parked job after three failures; the notify observed | 10, spec item 12 | S18 |
| R2.18 | `builder_setting` and `storage_ledger` editable without redeploy; health and metrics endpoint; `--once` mode | A setting change takes effect on the next claim; metrics scrape test | none | S18 |
| R2.19 | G6a heads-up push/fold: exact match to the computed equilibrium; agreement with published charts except at documented near-indifferent hands, with the chart source and parameters recorded; the solution committed in library format as the public fixture seed (O-30) | G6a report under `validation/reports/` in public CI (O-63) | fixture for 3, 4, 5, 9, 10 | S19 |
| R2.20 | Synthetic fixture generator in `validation/fixtures/`: a labeled synthetic 6-max preflop set (O-30) plus labeled synthetic live 9-handed sets at 1/3 and 2/5 with a `synthetic: true` manifest flag rendered as a banner (O-57); the 169 by 169 equity table (O-32) | Deterministic from seed; the sets pass the library-pack invariants and load in `solver-query` | 3, 4, 5, 10, 11 | S19 (equity table in S13) |
| R2.21 | Preflop spike per O-49: memory and time for heads-up push/fold on the Zenbook inside a 5 GB Docker memory limit (O-48), rerun on the Mac at Deploy 1; heads-up 100bb measured only if a minimal run fits, otherwise extrapolated and labeled; O-4 decided and recorded | Spike report per machine against the O-49 pass rule | none (R-5) | S19 (Mac rerun in S20) |
| R2.22 | First real build on the Zenbook with `--once` from the packed first configuration (O-41), then Deploy 1 with the owner's explicit yes: images built on the Mac, Postgres, SeaweedFS and the builder up, reference library imported, nightly backup job, builder started on the first line (O-52) inside the 5 GB cap (O-20) | Deploy 1 report: one published build at target exploitability, per-container peak RSS against the 02 section 6.2 budget, bytes per runout and the projection against 650 GB (O-51), K written to `builder_setting`, a coverage row and a notify observed, the first backup present with one solution restored from it | 10 (Mac part begins), spec item 12 | S20 |

## Definition of Done

- [ ] G1, G2 and G3 reports pass in the CI `rust` job on `sprint/1-v1` (R2.4 to R2.6; criterion 1 closed with those reports).
- [ ] The G4 report passes and is stored privately; the public `tools/validate g4` step runs on a generic dump (R2.11).
- [ ] The G6a report passes in public CI with its provenance note, and then in every CI run (R2.19, O-63).
- [ ] A simple-tree flop solve runs on the Mac builder inside 5 GB within the O-50 time rule (R2.22).
- [ ] The no-solve tests pass: the `cargo tree` and `pnpm why` steps are in CI and green (R2.15).
- [ ] The Deploy 1 report at `validation/reports/phase-2-gate.md` meets the memory (O-50) and storage (O-51) pass rules, and the builder is running on the O-52 line (R2.22).
- [ ] Every requirement R2.1 to R2.22 has its test green or its gate artifact present, exactly as the Requirements table names it.
- [ ] S12 to S19 are merged into `sprint/1-v1` by pull request; S20's branch carries the report and is merged after Deploy 1.
- [ ] The partial criteria carry their named tests: the pack round trip (2), the encodings and grade recomputation (3), the bucket-edge table (4), the fixture invariants (5), the insight unit tests (9), the dependency steps and benchmarks (10), the rake conversion and synthetic live sets (11).
- [ ] Deploy 1 happened with the owner's explicit yes at that moment (O-20), on the Mac (O-59), after the S04 report was checked (R0.9, O-67).
- [ ] The spike report exists for both machines and the O-4 decision is recorded in 00 (R2.21).
- [ ] The first real build consumed the packed first configuration on the Zenbook (O-41), or the O-61 smoke build ran and its `smoke/` prefix was deleted after the report.
