---
id: 'g-tee-oh-handoff-s19-g6a-fixtures'
title: 'S19 G6a and fixtures'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 2
session: 'S19'
branch: 'p2/g6a-fixtures'
tags: [g-tee-oh, handoff, phase-2]
---
# S19 G6a and fixtures (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-2-engine-and-pipeline|Phase 2 Engine validation and solution pipeline]]. This session produces gate G6a (heads-up push/fold solved exactly and compared with published charts, committed in library format as the public fixture seed and run in public continuous integration (CI) per O-63), the synthetic fixture generator with the labeled 6-max set and the labeled live 9-handed sets at 1/3 and 2/5 (O-30, O-57), and the Zenbook preflop spike inside a 5 GB Docker limit with the O-4 decision recorded (R2.19, R2.20, R2.21). It runs on branch `p2/g6a-fixtures` in parallel group D, earliest day 4 (2026-10-23), paced for week 3 ([[projects/g-tee-oh/planning/09-v1-sprint-roadmap|09 v1 sprint roadmap]] sections 4 and 5). It is a public session at medium usage, and its build step runs as a dynamic workflow. Its fixture library is what Phase 3's integration tests and end-to-end flows run against (S19 blocks S23, S29 and S33). Requirement identifiers (R IDs) follow 09 section 6 and open-question identifiers (O-IDs) follow 00.

## Before pasting

- [ ] S12 is merged into `sprint/1-v1`: canonical encodings (09 section 3).
- [ ] S13 is merged: `tools/validate` and the 169 by 169 equity table (09 section 3).
- [ ] S14 is merged: the library format writer and `tools/library-pack` (09 section 3).
- [ ] S15 is merged: push/fold trees come from `gto-tree` (09 section 3).
- [ ] Docker Desktop with the WSL2 (Windows Subsystem for Linux 2) backend can run a container under a 5 GB memory limit (O-48).
- [ ] The `e2e` skeleton from S06 reads `FIXTURE_LIBRARY_PATH` on the `dev` profile (O-62), so the fixture library has a place to land.
- [ ] The clone at `C:\Users\stack\projects\g-tee-oh` is on `sprint/1-v1` and clean.

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull --ff-only
git switch -c p2/g6a-fixtures
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault and append any new O-ID (and the O-4 decision) to `planning/00-open-questions-and-risks.md`.
2. Stay in the default permission mode, so you approve the workflow when it launches.
3. Paste the prompt below.

## The prompt

```text
Role and context
You are running session S19 of sprint 1 of g-tee-oh, Phase 2 (engine validation and solution pipeline), on branch p2/g6a-fixtures off the sprint branch sprint/1-v1. Goal: G6a heads-up push/fold in public CI, the synthetic fixture library, and the Zenbook preflop spike inside 5 GB with O-4 recorded (R2.19, R2.20, R2.21).

Reading order (vault root V = C:\Users\stack\vault\projects\g-tee-oh)
1. V\planning\phases\phase-2-engine-and-pipeline.md
2. V\planning\09-v1-sprint-roadmap.md sections 3, 5 (row S19), 6 (R2.19 to R2.21), 7, 8 (the preflop spike row) and section 10's erratum on the chart source
3. V\planning\00-open-questions-and-risks.md, the answered questions O-17 to O-67 (O-4, O-30, O-32, O-48, O-49, O-57, O-62, O-63 matter most) and risk R-5
4. V\planning\04-solver-engine.md sections 1, 4 and 6; V\planning\01-product-spec.md section 3 (the v1 configurations the synthetic sets must cover) and section 6 criteria 5, 10 and 11
5. V\planning\architecture\A2-engine.md sections 4 and 5; A3-library-format.md sections 1 to 3; A1-repo-and-conventions.md section 6; A9-quality-security-ops.md section 2 (the e2e job)
6. V\decisions\ files 0002, 0014 and 0020
7. The repo's CLAUDE.md, validation/fixtures/, and any docs/ mirrored files that exist

Rules
- Clone C:\Users\stack\projects\g-tee-oh, Claude Code in PowerShell, native Windows Rust toolchain; WSL2 only for Linux container builds and benchmarks (O-23); the spike runs in a WSL2 container under a 5 GB limit (O-48).
- Branch p2/g6a-fixtures off sprint/1-v1; merge by pull request into sprint/1-v1; sprint/1-v1 reaches main only in S35 (R4.18).
- Development gates in order: plan first in plan mode and wait for my approval (trivial one-liners exempt); concrete task list; smallest working increment; tests green before advancing, never on red; /code-review and fix CRITICAL and HIGH findings; /security-review not expected here; conventional commits (feat:, fix:, chore:, refactor:, docs:, test:, perf:, ci:) ending with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Test-driven: red test tagged with its R ID first, then green, then refactor; 80 percent coverage or better on new code.
- Accepted ADRs (architecture decision records) are fixed; if a step would contradict one, stop and raise it. Cite O-IDs and ADR numbers wherever you use an answer or a decision.
- Privacy: nothing GTO Wizard-specific enters this repo (O-26, ADR 0017, ADR 0021). Every fixture here is synthetic or computed by the own engine; the synthetic sets are labeled so no one mistakes them for reference solutions (O-57). Naming GTO Wizard as the emulated product is fine.
- A step runs as a dynamic workflow only where this prompt says so in my words. Keep every workflow under 10 agents and name what its verifier runs.
- Report honestly at every gate: show failing test output; name any skipped step; label every extrapolated number as extrapolated.
- Any documentation you write: no em dashes or en dashes, no bold, acronyms expanded on first use, mechanism before conclusion.

Inputs
- Push/fold game: heads-up at 15 big blinds (bb) and below, all-in or fold, so every terminal has an exact all-in equity and the equilibrium can be computed exactly (04 section 4). Equities come from the 169 by 169 table (S13, O-32). Trees from gto-tree (S15). No rake in the chart comparison; rake models exist for the keyed sets only (ADR 0014).
- Published charts: no document names the source (09 section 10). Choose a published heads-up push/fold Nash chart whose parameters (stack depths, antes, no rake) you can reproduce exactly, and record the source and parameters in validation/fixtures/PROVENANCE-g6a.md; near-indifferent hands that disagree are listed, each with its expected value (EV) gap.
- Synthetic sets (O-30, O-57): a labeled synthetic 6-max preflop set, and labeled synthetic live 9-handed sets at 1/3 and 2/5, each with a synthetic: true manifest flag that the web banner will render; deterministic from a seed recorded in the manifest; packed with tools/library-pack so they satisfy the criterion 2 invariants; loadable by solver-query (S16) through FIXTURE_LIBRARY_PATH (O-62).
- Spike scope (O-49): push/fold is the only solved preflop game in v1. Heads-up 100bb is measured only if a minimal P2 run (preflop-only Monte Carlo counterfactual regret minimization, MCCFR, paying out at the flop from equity-realization tables, A2 section 4) fits this session; otherwise extrapolate from push/fold and label it. If measured, it fits the Mac when peak bytes stay under 4 GB and one configuration reaches its in-abstraction target in under 12 hours. Push/fold has no time bound in any document (open, see the Phase 2 plan's problems list); record the wall time and propose an O-ID. The P1 versus P2 decision is v1.5. Record the O-4 answer (accelerator off unless the spike shows preflop solves cannot fit the Mac) in V\planning\00 under a dated subsection.

Requirements this session closes (tests copied from the phase doc)
- R2.19 G6a heads-up push/fold: exact match to the computed equilibrium; agreement with published charts except at documented near-indifferent hands, with the chart source and parameters recorded; the solution committed in library format as the public fixture seed (O-30). Test: G6a report under validation/reports/ in public CI (O-63).
- R2.20 Synthetic fixture generator in validation/fixtures/: a labeled synthetic 6-max preflop set (O-30) plus labeled synthetic live 9-handed sets at 1/3 and 2/5 with a synthetic: true manifest flag rendered as a banner (O-57); the 169 by 169 equity table (O-32, already produced in S13). Test: deterministic from seed; the sets pass the library-pack invariants and load in solver-query.
- R2.21 Preflop spike per O-49: memory and time for heads-up push/fold on the Zenbook inside a 5 GB Docker memory limit (O-48), rerun on the Mac at Deploy 1 (S20); heads-up 100bb measured only if a minimal run fits, otherwise extrapolated and labeled; O-4 decided and recorded. Test: spike report per machine against the O-49 pass rule.

Steps
1. (single) Read everything above. Enter plan mode: the push/fold solver's method (exact equilibrium over 169 classes at each depth), the chart choice, the generator's design (seeded, labeled, every v1 configuration shape from 01 section 3 that the keying test in R3.21 needs at 1/3 and 2/5), the spike container and measurement, and the CI wiring for G6a and the e2e fixture path. Wait for my approval.
2. (single) Write the red tests tagged R2.19, R2.20 and R2.21 (G6a exact-match test, chart-agreement test, generator determinism and invariant tests, a spike-report schema test). Commit red.
3. Use a dynamic workflow for this step, under 7 agents: push/fold solver and G6a (gto-solve preflop module, exact equilibrium, chart comparison, provenance note, tools/validate g6a, the solution packed into library format under validation/fixtures/); fixture generator (the labeled 6-max set and the labeled live sets at 1/3 and 2/5 with synthetic: true, seeded, packed, loaded by solver-query in a test); spike measurement (push/fold in a WSL2 container under a 5 GB limit with peak bytes and seconds; the minimal 100bb P2 run only if it fits, else the labeled extrapolation; the report under validation/reports/spike-preflop-zenbook.md); one integrator for CI wiring (G6a in the rust job per O-63, FIXTURE_LIBRARY_PATH for the e2e job per O-62); the verifier agent checks the pack invariants on every set, seed determinism (two runs byte-identical), the G6a report against its pass rule, and reports any failure verbatim.
4. (single) Record the O-4 decision and the proposed O-ID for the push/fold time bound in V\planning\00 under a dated subsection; run the CI jobs locally; /code-review and fix CRITICAL and HIGH; open the pull request into sprint/1-v1 with R2.19 to R2.21 in the template.

Definition of done
- [ ] G6a report green in the CI rust job with PROVENANCE-g6a.md naming the chart source and parameters; near-indifferent disagreements documented with EV gaps.
- [ ] The G6a solution and the synthetic sets live under validation/fixtures/ in library format, pass the library-pack invariants, load in solver-query, and the e2e job's FIXTURE_LIBRARY_PATH points at them.
- [ ] validation/reports/spike-preflop-zenbook.md exists with peak bytes and seconds for push/fold and a measured or clearly labeled extrapolated 100bb figure; the O-4 answer is in V\planning\00.
- [ ] R2.19, R2.20 and R2.21 tests green and tagged; CI green.
- [ ] /code-review done; CRITICAL and HIGH findings fixed.
- [ ] Pull request opened into sprint/1-v1 listing R2.19 to R2.21.

Report back
Your final message lists: each R ID with its test command and result; the branch and pull request link; the files written; the spike numbers and whether 100bb was measured or extrapolated; the chart source chosen; usage notes (units used against the planned medium level, about 2); any new question as a proposed O-ID with a default, appended to V\planning\00-open-questions-and-risks.md under a new dated subsection.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| Push/fold solver module in `crates/gto-solve/` and `tools/validate g6a` | public repo, branch `p2/g6a-fixtures` |
| G6a solution in library format, the synthetic 6-max set, the synthetic live sets at 1/3 and 2/5, `PROVENANCE-g6a.md` | `validation/fixtures/` |
| G6a report (public CI, every run) | `validation/reports/` |
| Spike report | `validation/reports/spike-preflop-zenbook.md` |
| O-4 decision and the proposed O-ID on the push/fold time bound | `planning/00-open-questions-and-risks.md` in the vault |
| CI wiring: G6a in the `rust` job, `FIXTURE_LIBRARY_PATH` for `e2e` | `.github/workflows/`, `infra/compose/` |
| Pull request into `sprint/1-v1` | GitHub |
