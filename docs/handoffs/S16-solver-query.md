---
id: 'g-tee-oh-handoff-s16-solver-query'
title: 'S16 solver-query'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 2
session: 'S16'
branch: 'p2/solver-query'
tags: [g-tee-oh, handoff, phase-2]
---
# S16 solver-query (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-2-engine-and-pipeline|Phase 2 Engine validation and solution pipeline]]. This session produces the `solver-query` read service: nodes, grade with the preflop floor, insights E3, deal and reveal, sample-action, coverage, health and metrics; its OpenAPI contract committed as the first commit with its TypeScript client (O-38); the no-solve dependency test; and the grade latency bench (R2.13 to R2.15). It runs on branch `p2/solver-query` in parallel group D, earliest day 4 (2026-10-23), paced for week 2 ([[projects/g-tee-oh/planning/09-v1-sprint-roadmap|09 v1 sprint roadmap]] sections 4 and 5). It is a public session at high usage on the critical chain, and its endpoint step runs as a dynamic workflow. The committed contract is what lets S23 start a day early (09 section 3). Requirement identifiers (R IDs) follow 09 section 6 and open-question identifiers (O-IDs) follow 00.

## Before pasting

- [ ] S02 is merged into `sprint/1-v1`: the `query` role (O-28), the `build_job` and library tables and the Kysely types (09 section 3).
- [ ] S06 is merged: the contracts pipeline with utoipa to `solver-query.openapi.json`, openapi-typescript clients and the axum hello with `/healthz` (R0.7).
- [ ] S13 is merged: the 169 by 169 equity table (O-32) and the report format.
- [ ] S14 is merged: the `gto-library` reader and `tools/library-pack`.
- [ ] The compose `dev` profile comes up on the Zenbook (R0.5), for the Postgres connection test under the `query` role.
- [ ] The clone at `C:\Users\stack\projects\g-tee-oh` is on `sprint/1-v1` and clean.

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull --ff-only
git switch -c p2/solver-query
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault and append any new O-ID to `planning/00-open-questions-and-risks.md`.
2. Stay in the default permission mode, so you approve the workflow when it launches.
3. Paste the prompt below.

## The prompt

```text
Role and context
You are running session S16 of sprint 1 of g-tee-oh, Phase 2 (engine validation and solution pipeline), on branch p2/solver-query off the sprint branch sprint/1-v1. Goal: the solver-query service with insights, its OpenAPI contract and client committed first, the no-solve dependency test and the grade latency bench (R2.13 to R2.15).

Reading order (vault root V = C:\Users\stack\vault\projects\g-tee-oh)
1. V\planning\phases\phase-2-engine-and-pipeline.md
2. V\planning\09-v1-sprint-roadmap.md sections 3, 5 (row S16), 6 (R2.13 to R2.15, R3.3, R3.7) and 7
3. V\planning\00-open-questions-and-risks.md, the answered questions O-17 to O-67 (O-22, O-28, O-32, O-38, O-53, O-62 matter most)
4. V\planning\04-solver-engine.md section 3 (E3); V\planning\05-training-and-grading.md section 6; V\planning\01-product-spec.md section 6 criteria 3, 9 and 10
5. V\planning\architecture\A5-services-and-interfaces.md sections 1 and 2; A3-library-format.md section 5; A1-repo-and-conventions.md sections 2, 3 and 6; A4-data-model.md section 3; A9-quality-security-ops.md sections 3, 4 and 6; A6-trainer-and-learning-engine.md section 4 (what api computes, so solver-query does not)
6. V\decisions\ files 0004, 0018, 0020 and 0023
7. The repo's CLAUDE.md, packages/contracts/, services/solver-query/ skeleton, and any docs/ mirrored files that exist

Rules
- Clone C:\Users\stack\projects\g-tee-oh, Claude Code in PowerShell, native Windows Rust toolchain; WSL2 (Windows Subsystem for Linux 2) only for Linux container builds and benchmarks (O-23).
- Branch p2/solver-query off sprint/1-v1; merge by pull request into sprint/1-v1; sprint/1-v1 reaches main only in S35 (R4.18).
- Development gates in order: plan first in plan mode and wait for my approval (trivial one-liners exempt); concrete task list; smallest working increment; tests green before advancing, never on red; /code-review and fix CRITICAL and HIGH findings; /security-review required (HTTP endpoints and user-supplied query input); conventional commits (feat:, fix:, chore:, refactor:, docs:, test:, perf:, ci:) ending with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Test-driven: red test tagged with its R ID first, then green, then refactor; 80 percent coverage or better on new code.
- Accepted ADRs (architecture decision records) are fixed; if a step would contradict one, stop and raise it. Cite O-IDs and ADR numbers wherever you use an answer or a decision. ADR 0004: expected value (EV) loss, the floor and bucket mapping are computed here and nowhere in TypeScript.
- Privacy: nothing GTO Wizard-specific enters this repo (O-26, ADR 0017, ADR 0021). solver-query reads the reference prefix through the same generic reader (A3 section 2); tests use synthetic packs only.
- A step runs as a dynamic workflow only where this prompt says so in my words. Keep every workflow under 10 agents and name what its verifier runs.
- Report honestly at every gate: show failing test output; name any skipped step.
- Any documentation you write: no em dashes or en dashes, no bold, acronyms expanded on first use, mechanism before conclusion.

Inputs
- A5 section 2: every endpoint, its request and response fields, and the two rules (never import gto-solve; deals stay server-side).
- The gto-library reader (S14) and a fixture solution: pack S14's synthetic dump with tools/library-pack and point the service at it through FIXTURE_LIBRARY_PATH on the dev profile (O-62). S19's G6a and synthetic sets replace it later (O-30, O-53).
- The preflop floor (O-22): max(0.2 percent pot, the accuracy the solution reports, else 0.02 big blinds (bb)), in percent of the pot at the node.
- The 169 by 169 equity table from S13 (O-32) for preflop equity distributions; solver-query may depend on the vendored evaluator crate directly, never on gto-solve.
- Postgres under the read-only query role (O-28) for coverage reads; QUERY_CACHE_BYTES for the cache (A3 section 5).
- Budgets (A9 section 6): grade 95th percentile (p95) under 30 ms with a warm cache; the R0.10 criterion harness and validation/reports/bench-zenbook.json.

Requirements this session closes (tests copied from the phase doc)
- R2.13 solver-query: /v1/nodes, /v1/grade with the O-22 floor, /v1/insights, /v1/sample-action, /v1/deal and reveal, /v1/coverage, /healthz, /metrics; utoipa OpenAPI committed first (O-38) with its TypeScript client; runs under the query role (O-28). Test: contract diff job; grade equals a direct reader recomputation on a fixture solution; criterion benchmark grade p95 under 30 ms with a warm cache.
- R2.14 Insights E3: threshold card, noise flags, equity distribution, range and nut advantage, blockers, hand role; preflop equities from the 169 by 169 table (O-32). Test: unit tests on hand-built nodes.
- R2.15 No request path starts a solve: solver-query has no dependency on gto-solve; api and solver-query never invoke the builder. Test: continuous integration (CI) step cargo tree -p solver-query must not contain gto-solve; pnpm why for api; the request-path integration test lands in R3.4 (Phase 3).

Steps
1. (single) Read everything above. Enter plan mode: handler types for every A5 section 2 endpoint, the grade math path (reader to loss to floor to noise flags), the insight computations, the seeded deal and sample-action design, the role and cache wiring, the bench. Wait for my approval.
2. (single) Contract first (O-38): write the utoipa-annotated request and response types for every endpoint with stub handlers, regenerate packages/contracts/solver-query.openapi.json and its TypeScript client, make the contracts job pass, and commit this as the first commit of the session. Then write the red tests tagged R2.13, R2.14 and R2.15 and commit red.
3. Use a dynamic workflow for this step, under 7 agents: nodes and grade (reader lookup, EV loss in bb and percent of pot, the O-22 floor, bucket from gto-model, the recomputation test); insights (R2.14 on hand-built nodes); deal, reveal and sample-action (server-side seeded deals, reveal one street at a time, rng_state carried); coverage, healthz, metrics and the query-role connection; contract diff, the cargo tree and pnpm why CI steps, and the criterion grade bench; one integrator for shared state and the FIXTURE_LIBRARY_PATH wiring; the verifier agent runs the grade recomputation check (every /v1/grade response equals a direct gto-library reader recomputation on the packed synthetic fixture, floor included), the dependency step, and the full test suite, and reports any red test verbatim.
4. (single) Run the bench on the Zenbook with a warm cache, commit the JSON under validation/reports/, run /code-review and /security-review and fix CRITICAL and HIGH, open the pull request into sprint/1-v1 with R2.13 to R2.15 in the template.

Definition of done
- [ ] The first commit on the branch is the OpenAPI contract and client, and the contracts job passes on it.
- [ ] R2.13, R2.14 and R2.15 tests green and tagged; the grade recomputation check passes; grade p95 under 30 ms warm in the committed bench JSON.
- [ ] cargo tree -p solver-query contains no gto-solve, and that step plus pnpm why for api are in CI and green.
- [ ] The service runs in the compose dev profile under the query role with FIXTURE_LIBRARY_PATH set, and /healthz and /metrics answer.
- [ ] /code-review and /security-review done; CRITICAL and HIGH findings fixed.
- [ ] Pull request opened into sprint/1-v1 listing R2.13 to R2.15.

Report back
Your final message lists: each R ID with its test command and result; the branch and pull request link; the files written; the bench numbers against the 30 ms budget; usage notes (units used against the planned high level, about 3); any new question as a proposed O-ID with a default, appended to V\planning\00-open-questions-and-risks.md under a new dated subsection.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| `packages/contracts/solver-query.openapi.json` and its TypeScript client (first commit) | public repo, branch `p2/solver-query` |
| `services/solver-query/` with every A5 section 2 endpoint, insights, seeded deals | public repo |
| Tests tagged R2.13 to R2.15, the grade recomputation check, insight unit tests | `services/solver-query/tests/` |
| `cargo tree` and `pnpm why` steps | `.github/workflows/` |
| Grade bench JSON | `validation/reports/bench-zenbook.json` |
| Pull request into `sprint/1-v1` | GitHub |
