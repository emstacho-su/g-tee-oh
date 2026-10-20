---
id: 'g-tee-oh-phase-0-foundations'
title: 'Phase 0 Foundations and test scaffolding'
collection: 'g-tee-oh'
type: phase
status: 'planned'
created: 2026-10-19
public: true
phase: 0
tags: [g-tee-oh, phase, sprint-1]
---
# Phase 0 Foundations and test scaffolding

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/09-v1-sprint-roadmap|09 v1 sprint roadmap]]. The goal of this phase, from 09 section 2, is a public monorepo with seven continuous integration (CI) jobs and the private-data guard, the contracts pipeline and service skeletons, red tests for every later vector, a dev stack on the Zenbook, a private capture repo scaffold, and a bootstrapped Mac with a first memory reading. Earliest start is day 1, 2026-10-20 (O-37). Paced dates: the repo work takes three days of week 1 (2026-10-20 to 2026-10-26) in the order S01, S03, S04, S02, S05, S06, interleaved with S12, S07 and S14 from later phases; the Mac bootstrap (S04) happens on any evening through day 8 and may slip to any evening before S20 (O-67). Usage: 1 high, 3 medium and 2 low sessions, 11 units of the roughly 87 in the sprint (O-39). Every session runs in Claude Code in PowerShell at `C:\Users\stack\projects\g-tee-oh` except S03, which runs in the private clone, and S04, where the owner is at the Mac keyboard (O-23, O-28).

## MVP

The minimum viable product (MVP) of this phase is the smallest set of outcomes that lets each later phase start, because Phase 0 is the only phase that blocks all four others (09 section 3):

- Phase 1 can start when the private capture repo exists with its guardrail mirror and `capture` schema migrations (S03), the bucket credentials exist (S02), and the node-dump JSON (JavaScript Object Notation) schema the private exporter writes to exists (S06).
- Phase 2 can start when the Cargo workspace with the vendored engine and CI exist (S01), and the toy-game fixtures and the OpenSpiel curve are committed as pending tests (S05). S12 waits only for S01, since it writes its own two vectors (R0.11).
- Phase 3 can start when the migrations and catalog seed (S02), the contracts pipeline and the service skeletons (S06) exist.
- Phase 4 can start when the learning vectors and the `packages/learning` skeleton exist (S05).
- Deploy 1 (S20) can start when the Mac bootstrap report exists (S04).

Success criteria from [[projects/g-tee-oh/planning/01-product-spec|01 Product spec]] section 6: this phase closes none of the eleven. It partly closes criterion 1 (toy-game fixtures and the OpenSpiel curve as pending tests, R0.11), criterion 2 (the private repo scaffold, R0.8), criteria 4, 6 and 7 (the bucket-edge, Glicko-2 and scheduler vectors as pending tests, R0.11), criterion 10 (the Mac precondition in R0.9 and the latency baseline in R0.10) and criterion 11 (the keyed stake and configuration seed, R0.6). Criteria 3, 5, 8 and 9 have no Phase 0 requirement.

## Scope

In scope: the public monorepo per [[projects/g-tee-oh/planning/architecture/A1-repo-and-conventions|A1]] with both workspaces and the `justfile`; the engine vendored by git subtree; the seven CI jobs from [[projects/g-tee-oh/planning/architecture/A9-quality-security-ops|A9]] section 2; the private-data guard with a hashed identifier denylist (O-58); CLAUDE.md, `.claude` deny rules, hooks and the pull request template; the Compose `dev` profile with Postgres, SeaweedFS and Caddy and one multi-arch Dockerfile per service; dbmate migrations for the [[projects/g-tee-oh/planning/architecture/A4-data-model|A4]] schema with the four roles (O-28) and the catalog seed; the contracts pipeline and the three skeleton services with a Playwright smoke flow; the benchmark harness and the Zenbook baseline; red tests and fixtures for every later vector; the `docs/` mirror seed; the private capture repo scaffold; the Mac bootstrap with a throwaway benchmark.

Out of scope: any handler, screen or solver logic beyond hello endpoints; the two `gto-model` vectors, which S12 writes red first inside its own session (R0.11); the capture tooling itself (S08) and any capture data; any build running on the Mac (Deploy 1 is S20, O-20); the `tools/validate` gates themselves (S13); the real `library-pack` (S14).

Sessions of this phase, from 09 section 5:

| Session | Handoff | Branch | Group and day | Workflow or single | Visibility | Usage |
|---|---|---|---|---|---|---|
| S01 | [[projects/g-tee-oh/handoffs/S01-foundations|S01 Foundations]] | `p0/foundations` | A, day 1 | workflow | public | high |
| S02 | [[projects/g-tee-oh/handoffs/S02-infra|S02 Infra]] | `p0/infra` | B, day 2 | workflow | public | medium |
| S03 | [[projects/g-tee-oh/handoffs/S03-capture-repo|S03 Capture repo]] | `p0/capture-repo` in the private repo | B, day 2 | single | private | low |
| S04 | [[projects/g-tee-oh/handoffs/S04-mac-bootstrap|S04 Mac bootstrap]] | `p0/mac-bootstrap` | A, any evening through day 8, may slip to before S20 (O-67) | single | public | low |
| S05 | [[projects/g-tee-oh/handoffs/S05-test-vectors|S05 Test vectors]] | `p0/test-vectors` | B, day 2 | workflow | public | medium |
| S06 | [[projects/g-tee-oh/handoffs/S06-contracts|S06 Contracts]] | `p0/contracts` | C, day 3 | single | public | medium |

Deferred to v1.5 from 09 section 9 where it touches this phase: the `library-migrate` tool, because v1 ships one `format_version`, so the schema work in S06 carries a version field and nothing else; serving ante variants, so R0.6 adds `game_config.ante_cbb` with default 0 and no session serves it (O-33); the optional cloud accelerator, so no tunnel configuration is written (O-4, [[projects/g-tee-oh/planning/02-architecture|02 Architecture]] section 6.3).

## Blockers/Constraints

Dependencies (09 section 3):

- Within the phase: S01 blocks S02, S03, S05 and S06 (and S12 in Phase 2), because the workspace, CI and guard must exist before anything lands and the private repo mirrors the guard patterns and commit conventions. S02 blocks S06 (codegen) and the credential wiring in S03. S04 has no in-phase dependency beyond the vendored engine from S01.
- Outward: S03 blocks S07 (risk R-15); S02 blocks S10, S16, S18 and S21 (the `query` role, the `build_job` tables and the Kysely types); S04 blocks S20 (O-20); S05 blocks S13, S22 and S30; S06 blocks S10, S16, S21 and S24.
- Nothing from a later phase blocks Phase 0.

Owner tasks: the owner sits at the Mac for S04 on any evening through day 8, or any evening before S20 (O-67); creates or authorizes the private GitHub repo for S03; provisions the guard salt as a CI secret for S01; merges each pull request after review (O-68, O-69, answered in 00); verifies the 2/5 live rake cap before S11, so R0.6 seeds it at the $5 default flagged unverified (O-2, O-66); exports the 15-drill build card before S26, which is a Phase 3 input and not a Phase 0 one (O-24).

Machine limits: the Zenbook runs Claude Code in PowerShell with the native Windows Rust toolchain, and Windows Subsystem for Linux 2 (WSL2) only for Linux container builds and benchmarks (O-23), with the `.wslconfig` template from R0.5 raising WSL2 memory per 02 section 6.1; the 5 GB builder cap is emulated as a Docker memory limit inside WSL2 (O-48). The Mac is bootstrapped at a 10 GB Docker virtual machine with all but 2 cores, sleep prevented on power and the external drive attached (O-20); the S04 benchmark container is throwaway and is not a deploy event (O-47); its pass rule is peak resident set size (RSS) under 5 GB and under 30 minutes to 0.3 percent pot per preflop line on the simple tree at 100 big blinds (bb) with 16-bit storage (O-50).

Privacy boundary (O-26, architecture decision record (ADR) 0017, ADR 0021): the public repo never receives anything GTO Wizard-specific (GTO stands for game theory optimal). The guard's plain identifier list and its salt live in the private repo and the public repo carries only salted sha256 hashes (O-58). S03 is private; its handoff and [[projects/g-tee-oh/planning/architecture/A8-capture-system|A8]] stay in the vault and the private repo. When a public file must refer to capture detail it links [[projects/g-tee-oh/planning/03-phase-1-data-acquisition|03 Phase 1 data acquisition]] and cites O-19.

ADRs that bind this phase: 0001 (multi-user schema, `user_id` on every user-owned row), 0002 (engine vendored under the Massachusetts Institute of Technology (MIT) license, no GNU General Public License (GPL) or GNU Affero General Public License (AGPL) dependency), 0004 (poker math in Rust, product logic in TypeScript; accepted per O-25), 0005 (Postgres plus an S3 (Simple Storage Service) object store and a Postgres job queue; dbmate, Kysely and sqlx accepted per O-56), 0006 (React, TypeScript, Vite), 0017 (planning docs in the vault, a sanitized `docs/` mirror), 0018 (library-first, enforced from day 1 by the A1 dependency direction), 0019 (SeaweedFS), 0021 (capture through a Claude-driven session in the private repo).

Open-question identifiers (O-IDs) that bind this phase: O-2, O-17, O-19, O-20, O-23, O-24, O-25, O-26, O-28, O-29, O-30, O-33, O-35, O-37, O-38, O-45, O-47, O-48, O-50, O-56, O-58, O-62, O-66, O-67. Merging: each session opens its pull request into `sprint/1-v1`; the docs do not say who merges, so the conservative reading is that the owner merges after review (O-68, answered in 00).

## Inputs

- Planning: [[projects/g-tee-oh/planning/09-v1-sprint-roadmap|09 v1 sprint roadmap]] sections 2 to 7 and 10; [[projects/g-tee-oh/planning/01-product-spec|01 Product spec]] sections 3 and 6; [[projects/g-tee-oh/planning/00-open-questions-and-risks|00 Open questions and risks]] (O-17 to O-67 are binding); [[projects/g-tee-oh/planning/07-roadmap|07 Roadmap]] Phase 0 checklist (indicative; 09 wins where they differ, O-27); [[projects/g-tee-oh/planning/08-glossary|08 Glossary]].
- Architecture: [[projects/g-tee-oh/planning/02-architecture|02 Architecture]] sections 6 and 7; [[projects/g-tee-oh/planning/architecture/A1-repo-and-conventions|A1]] (layout, dependency direction, contracts, conventions, configuration); [[projects/g-tee-oh/planning/architecture/A9-quality-security-ops|A9]] (test strategy, CI jobs, security model, operations, budgets); [[projects/g-tee-oh/planning/architecture/A4-data-model|A4]] (schema and roles); [[projects/g-tee-oh/planning/architecture/A5-services-and-interfaces|A5]] (service map and endpoints for the skeletons); [[projects/g-tee-oh/planning/architecture/A3-library-format|A3]] (manifest and node record for the JSON schemas); [[projects/g-tee-oh/planning/architecture/A6-trainer-and-learning-engine|A6]] sections 4 and 6 (learning types and test vectors); [[projects/g-tee-oh/planning/architecture/A7-web-app|A7]] section 5 (the Playwright flows); [[projects/g-tee-oh/planning/04-solver-engine|04 Solver engine]] section 6 (gates G1 to G3 and their pass rules); [[projects/g-tee-oh/planning/architecture/A8-capture-system|A8]] for S03 only.
- Decisions: [[projects/g-tee-oh/decisions/_README|ADR index]] and the ADRs listed above.
- Handoff model: [[projects/g-tee-oh/handoffs/S00-plan-v1-sprint|S00 Plan the v1 sprint]].
- External inputs: the upstream engine repository named in ADR 0002 at a pinned commit; the ts-fsrs package, its license and its published test vectors (O-35); OpenSpiel installed through uv for the Leduc curve (O-30); the files flagged `public: true` in the vault at the time S01 runs (O-45).
- Owner-provided: GitHub access through `gh` for both repos; the guard salt as a CI secret; the identifiers for the plain denylist (planning/00 O-7 names one); Docker Desktop with the WSL2 backend on the Zenbook; the Mac, its power adapter and the external drive.
- Prior outputs: none. This is the first phase. Fixtures and data are produced here, not consumed.

## Instruments

| Instrument | What it measures | Pass rule | Set by |
|---|---|---|---|
| CI `rust` job (fmt, clippy with warnings as errors, tests) | Rust workspace health | green on every pull request and on `sprint/1-v1` | A9 section 2, R0.1 |
| CI `ts` job (eslint, typecheck, Vitest) | TypeScript workspace health | green on every pull request and on `sprint/1-v1` | A9 section 2, R0.1 |
| CI `contracts` job | regenerated OpenAPI files, JSON schemas, clients and Kysely types against the committed ones | fails on any diff; proven once by a throwaway uncommitted diff | A1 section 3, R0.7, O-38 |
| CI `e2e` (end-to-end) job (Compose `dev` with `FIXTURE_LIBRARY_PATH`, Playwright) | the stack comes up and the smoke flow passes | smoke flow green; every health check healthy | R0.3, R0.5, O-62 |
| CI `licenses` job (cargo-deny, pnpm license check) | no GPL or AGPL dependency | passes; a throwaway AGPL crate fails it | R0.2, ADR 0002 |
| CI `security` job (cargo audit, pnpm audit, secret scanning, the guard) | audits and the private-data guard | passes; a throwaway planted pattern file and a planted hashed identifier fail it | R0.4, A9 section 2 |
| CI `images` job (multi-arch buildx) | the images build for amd64 and arm64 | builds one service for both; pushes on tags only | R0.3 |
| Pre-commit guard and `just guard-history` | diff file patterns and salted sha256 identifier hashes; the full history | rejects the planted inputs locally; the history scan is clean | R0.4, O-58, risk R-11 |
| commit-msg hook | the co-author trailer on Claude commits | a Claude commit without the trailer is rejected | R0.1, O-29 |
| `just --list` and the pull request template test | the task surface; the requirement identifier (R ID) field | every documented target listed; the test passes | R0.1, A9 section 1 |
| `docker compose --profile dev up` | stack health on the Zenbook | all services reach healthy | R0.5 |
| Migration, role and seed tests | the A4 schema, the four roles, the catalog seed | applies to an empty database; `query` cannot write, `app` cannot see `capture`, `capture` inserts only its allowed rows; one `game_config` per v1 configuration | R0.6, O-28, O-33 |
| Kysely codegen and sqlx checks | generated types match the schema | pass | R0.6, ADR 0005 |
| Private repo CI and the credential test | private migrations apply; bucket isolation | `capture` writes `reference-private`, `app` cannot read it | R0.8 |
| `validation/reports/mac-bootstrap.md` | Docker memory, the power setting, peak RSS, seconds per iteration on the Mac | O-50: peak RSS under 5 GB and under 30 minutes to 0.3 percent pot per preflop line | R0.9, O-20, O-47 |
| `just bench` writing `validation/reports/bench-zenbook.json` | solve iteration, chunk decode and node read on the Zenbook | the file exists with the baseline; it becomes the 95th percentile latency (p95) guard baseline later (O-40) | R0.10 |
| Pending-test tag check | every pending test carries an R ID | zero untagged pending tests; CI green with pending tests | R0.11 |
| `PROVENANCE.md` beside the OpenSpiel curve | version, command and seed of the fixture run | present and complete | R0.11, O-30 |
| `docs/` provenance test and the guard on `docs/` | every mirrored file carries `public: true`; no specific in the mirror | both pass | R0.12, O-26, O-45 |
| `validation/reports/phase-0-gate.md` | the repo part of the Phase 0 gate | every gate condition with evidence links, R0.8's private CI result noted, the Mac part status | 09 section 7, S06 |

## Requirements

Every R ID below is taken from 09 section 6 with its test, and each test is tagged with the R ID in code (A1 section 4).

| ID | Requirement | Test or gate artifact | Success criterion | Session |
|---|---|---|---|---|
| R0.1 | Monorepo per A1: Cargo and pnpm workspaces, `justfile`, CLAUDE.md with the branch rules (`sprint/1-v1`, `p<phase>/<slug>`, O-28), the co-author trailer rule (O-29), the clone path `C:\Users\stack\projects\g-tee-oh`, the PowerShell shell and the toolchain split (O-23), `.claude` deny rules, pull request template listing R IDs (A9 section 1) | CI `rust` and `ts` jobs green on the empty workspaces; `just --list` shows the task surface; a commit-msg hook rejects a Claude commit without the trailer; a test asserts the template carries the R ID field | none | S01 |
| R0.2 | Engine vendored by git subtree into `crates/vendor/postflop-engine`, MIT notice kept, `UPSTREAM.md` records the commit; cargo-deny and the pnpm license check block GPL and AGPL (ADR 0002) | Vendored crate builds in CI; `licenses` job passes; a throwaway branch adding an AGPL crate fails the `licenses` job, recorded in `validation/reports/phase-0-gate.md` | none (supports 1) | S01 |
| R0.3 | The seven CI jobs from A9 section 2: `rust`, `ts`, `contracts`, `e2e` (Compose with the fixture library path, O-62), `licenses`, `security`, `images` (multi-arch buildx, push on tags only) | Every job runs on a pull request; the `e2e` skeleton passes the Playwright smoke flow; the `images` job builds amd64 and arm64 for one service | none | S01 (job definitions), S02 (Dockerfiles), S06 (`e2e` smoke and the one-service build) |
| R0.4 | Private-data guard as a pre-commit hook and a CI check: file patterns plus an identifier denylist stored as salted sha256 hashes (O-58); `just guard-history` scans the full history (risk R-11) | Guard unit tests with synthetic planted strings; a throwaway branch with a planted private-pattern file and a planted hashed identifier is rejected locally and in CI | none | S01 |
| R0.5 | Compose `dev` profile with Postgres, SeaweedFS single-server mode and Caddy; one multi-arch Dockerfile per service; `.wslconfig` template for the WSL2 container builds and benchmarks (O-23); `.env.example` | `docker compose --profile dev up` reaches healthy on the Zenbook; health-check smoke in the `e2e` skeleton | none | S02 |
| R0.6 | dbmate migrations for the A4 schema with `scenario` in v1 (O-17), `game_config.ante_cbb` default 0 (O-33), roles `app`, `builder`, `capture` and the read-only `query` role (O-28); catalog seed: stakes (live 1/3 cap $5, live 2/5 cap $5 flagged unverified per O-2 and O-66, one online profile) and every v1 configuration from 01 section 3 with a placeholder sizing convention (source `manual`), so the not-null constraint holds before Phase 1 data lands | Migration test applies to an empty database; role tests: `query` cannot write, `app` cannot see the `capture` schema, `capture` can insert only `solution` rows with source `reference`, `stake`, `sizing_convention` and `game_config` rows; Kysely codegen and sqlx checks pass; a seed test counts one `game_config` per v1 configuration | 11 (keying data), supports 10 | S02 |
| R0.7 | Contracts pipeline and skeletons (A1 section 3): utoipa to `solver-query.openapi.json`, Fastify Zod to `api.openapi.json`, openapi-typescript clients, manifest and node-dump JSON schemas carrying a schema version, kysely-codegen; axum hello with `/healthz`, Fastify hello serving `/api/v1/openapi.json`, Vite skeleton with router and a Playwright smoke flow | `contracts` job regenerates and fails on diff; the smoke flow passes in the `e2e` skeleton | none (blocks every handler and screen) | S06 |
| R0.8 | Private `g-tee-oh-capture` repo scaffold: its own `capture` schema migrations, gitignored data directory, run-log table, separate `reference-private` bucket credentials; components per A8 | Private repo CI applies its migrations; credential test: the `capture` role writes the bucket and the `app` role cannot read it | 2 (supports; risks R-11, R-15) | S03 |
| R0.9 | Mac bootstrapped per O-20: Docker virtual machine at 10 GB and all but 2 cores, sleep prevented on power, external drive mounted, repo cloned, release build cache warmed; a throwaway arm64 flop-solve benchmark of the vendored engine inside a 5 GB memory limit (O-47) | Bootstrap report at `validation/reports/mac-bootstrap.md` on branch `p0/mac-bootstrap`, carrying only `docker info` memory, the power setting, peak RSS and seconds per iteration against the flop-solve pass rule (O-50); it closes the Mac part of the Phase 0 gate whenever S04 lands, no later than S20, which checks it before Deploy 1 (O-67) | 10 (precondition; first reading for risk R-9) | S04 |
| R0.10 | Benchmark harness (the criterion crate): solve iteration, chunk decode, node read; Zenbook baseline recorded | `just bench` writes `validation/reports/bench-zenbook.json` | 10 (guard baseline) | S02 |
| R0.11 | Red tests first, each tagged with its R ID and pending: the Glicko-2 worked example (A6 section 6), the ts-fsrs license verified and its published vectors wired to an empty adapter (O-35), the bucket-edge table (25, 50, 75, 110 and 150 percent of pot, upper edge inclusive, all-in separate) and a node-key round-trip skeleton (these two `gto-model` vectors land in S12, still red first inside that session, so S12 does not wait for S05), Kuhn, AKQ (ace, king, queen) and Leduc fixtures, the OpenSpiel Leduc exploitability curve generated once with uv and committed with `PROVENANCE.md` (version, command, seed; O-30), the `validation/reports/` format; `packages/learning` skeleton with the A6 section 4 types | Tests exist and are pending with R IDs; CI green with pending tests; `PROVENANCE.md` present; `licenses` job passes | 1, 4, 6, 7 (scaffolds) | S05 (the two `gto-model` vectors in S12) |
| R0.12 | `docs/` mirror of the files Step 3 flags `public: true` (O-26, O-45) with a `docs/security.md` threat-model stub (A9 section 3) | Guard passes on `docs/`; a test that every file under `docs/` carries `public: true` provenance | none | S01 |

## Definition of Done

Repo part of the gate (09 sections 2 and 7), closed by S06 after the `p0` merges:

- [ ] CI green on `sprint/1-v1` on all seven jobs (`rust`, `ts`, `contracts`, `e2e`, `licenses`, `security`, `images`).
- [ ] `docker compose --profile dev up` reaches healthy on the Zenbook.
- [ ] The guard rejects a planted private-pattern file and a planted hashed identifier, locally and in CI, with the throwaway run linked.
- [ ] Every vector is a pending test tagged with its R ID, and the tag check reports zero untagged pending tests.
- [ ] The `contracts` job fails on an uncommitted diff, with the throwaway run linked.
- [ ] `validation/reports/phase-0-gate.md` exists with evidence for each condition, the throwaway AGPL run (R0.2), the private repo CI result for R0.8 noted, and the Mac part status.

Mac part of the gate, closed when S04 lands and no later than S20 (O-67):

- [ ] `validation/reports/mac-bootstrap.md` exists on `p0/mac-bootstrap` and is merged, with `docker info` memory, the power setting, peak RSS and seconds per iteration judged against O-50, and nothing left running on the Mac (O-47).

Requirement artifacts green or present:

- [ ] R0.1: `rust` and `ts` green on the empty workspaces, `just --list`, the commit-msg hook test, the template test.
- [ ] R0.2: vendored crate builds in CI, `licenses` green, the throwaway AGPL failure recorded.
- [ ] R0.3: every job runs on a pull request, the smoke flow passes in `e2e`, `images` builds amd64 and arm64 for one service.
- [ ] R0.4: guard unit tests green, the throwaway planted branch rejected locally and in CI.
- [ ] R0.5: Compose `dev` healthy, health-check smoke in `e2e`.
- [ ] R0.6: migration, role and seed tests green, Kysely codegen and sqlx checks pass.
- [ ] R0.7: `contracts` regenerates with no diff on the branch and fails on the throwaway diff, the smoke flow passes.
- [ ] R0.8: private repo CI applies its migrations, the credential test passes.
- [ ] R0.9: the bootstrap report present (Mac part above).
- [ ] R0.10: `validation/reports/bench-zenbook.json` written by `just bench`.
- [ ] R0.11: pending tests with R IDs, CI green, `PROVENANCE.md` present, `licenses` green.
- [ ] R0.12: guard passes on `docs/`, the provenance test passes.

Merges and criteria:

- [ ] S01, S02, S05 and S06 merged into `sprint/1-v1` by pull request; S04 merged when it lands; S03 merged into the private repo's sprint branch.
- [ ] Partial success criteria recorded in the gate report: criterion 11 keying data seeded (R0.6 seed test), criterion 10 baseline and precondition (R0.10 JSON, R0.9 report), criteria 1, 4, 6 and 7 scaffolded as pending tests (R0.11). No criterion closes in this phase, and no deploy happens (O-20).
