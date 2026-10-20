---
id: 'g-tee-oh-handoff-s18-builder'
title: 'S18 Builder'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 2
session: 'S18'
branch: 'p2/builder'
tags: [g-tee-oh, handoff, phase-2]
---
# S18 Builder (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-2-engine-and-pipeline|Phase 2 Engine validation and solution pipeline]]. This session produces the `gto-planner` crate, the `library-builder` service (claim loop, exploitability check, one-transaction publish, notify, parking), runout extraction E6b in v1 (O-17), live builder settings and the storage ledger, health and metrics, `--once` mode, and a Zenbook benchmark of one flop line against the O-50 rule (R2.12, R2.16 to R2.18). It runs on branch `p2/builder` in parallel group D, earliest day 4 (2026-10-23), paced for week 2 ([[projects/g-tee-oh/planning/09-v1-sprint-roadmap|09 v1 sprint roadmap]] sections 4 and 5). It is a public session at high usage, and its build step runs as a dynamic workflow. The builder image is what Deploy 1 ships (S18 blocks S20). Requirement identifiers (R IDs) follow 09 section 6 and open-question identifiers (O-IDs) follow 00.

## Before pasting

- [ ] S02 is merged into `sprint/1-v1`: `build_job`, `solution`, `scenario`, `builder_setting` and `storage_ledger` tables, the `builder` role and the compose `dev` profile with Postgres and SeaweedFS (09 section 3; O-17, O-28).
- [ ] S14 is merged: the `gto-library` writer and runout types (09 section 3).
- [ ] S15 is merged: the solve adapter and `gto-tree` (09 section 3).
- [ ] Docker Desktop with the WSL2 (Windows Subsystem for Linux 2) backend can run a container under a 5 GB memory limit (O-48), for the benchmark step.
- [ ] The clone at `C:\Users\stack\projects\g-tee-oh` is on `sprint/1-v1` and clean.

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull --ff-only
git switch -c p2/builder
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault and append any new O-ID to `planning/00-open-questions-and-risks.md`.
2. Stay in the default permission mode, so you approve the workflow when it launches.
3. Paste the prompt below.

## The prompt

```text
Role and context
You are running session S18 of sprint 1 of g-tee-oh, Phase 2 (engine validation and solution pipeline), on branch p2/builder off the sprint branch sprint/1-v1. Goal: gto-planner, the library-builder loop with runout extraction, settings, ledger, health, metrics and --once, and a Zenbook benchmark of one flop line (R2.12, R2.16 to R2.18).

Reading order (vault root V = C:\Users\stack\vault\projects\g-tee-oh)
1. V\planning\phases\phase-2-engine-and-pipeline.md
2. V\planning\09-v1-sprint-roadmap.md sections 3, 5 (row S18), 6 (R2.12, R2.16 to R2.18, R2.22) and 7
3. V\planning\00-open-questions-and-risks.md, the answered questions O-17 to O-67 (O-13, O-14, O-17, O-48, O-50, O-52 matter most)
4. V\planning\02-architecture.md sections 3.2, 3.4, 5.2 and 6.2; V\planning\04-solver-engine.md sections 3 and 7
5. V\planning\architecture\A5-services-and-interfaces.md sections 1 and 4; A4-data-model.md sections 2 to 4; A2-engine.md sections 3, 5 and 6; A1-repo-and-conventions.md sections 2 and 6; A9-quality-security-ops.md sections 1 and 4
6. V\decisions\ files 0005, 0013, 0018, 0019 and 0023
7. The repo's CLAUDE.md, services/library-builder/ skeleton, db/migrations/, and any docs/ mirrored files that exist

Rules
- Clone C:\Users\stack\projects\g-tee-oh, Claude Code in PowerShell, native Windows Rust toolchain; WSL2 only for Linux container builds and benchmarks (O-23); the benchmark step runs in a WSL2 container under a 5 GB limit (O-48).
- Branch p2/builder off sprint/1-v1; merge by pull request into sprint/1-v1; sprint/1-v1 reaches main only in S35 (R4.18).
- Development gates in order: plan first in plan mode and wait for my approval (trivial one-liners exempt); concrete task list; smallest working increment; tests green before advancing, never on red; /code-review and fix CRITICAL and HIGH findings; /security-review required (the health and metrics endpoint and database writes); conventional commits (feat:, fix:, chore:, refactor:, docs:, test:, perf:, ci:) ending with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Test-driven: red test tagged with its R ID first, then green, then refactor; 80 percent coverage or better on new code.
- Accepted ADRs (architecture decision records) are fixed; if a step would contradict one, stop and raise it. Cite O-IDs and ADR numbers wherever you use an answer. ADR 0018: the builder is the only process that solves; ADR 0023: a flop is solved with the turn and river unknown, then K runouts are drawn and only their branches kept; ADR 0013: priority uses equilibrium reach.
- Privacy: nothing GTO Wizard-specific enters this repo (O-26, ADR 0017, ADR 0021). Ranges for tests and the benchmark are hand-made fixtures; the first real build on reference ranges happens in S20 (O-41).
- A step runs as a dynamic workflow only where this prompt says so in my words. Keep every workflow under 10 agents and name what its verifier runs.
- Report honestly at every gate: show failing test output; name any skipped step.
- Any documentation you write: no em dashes or en dashes, no bold, acronyms expanded on first use, mechanism before conclusion.

Inputs
- A5 section 4 builder contract: input one build_job row; output manifest and files in SeaweedFS, a solution row and scenario rows in one transaction after all files are checksummed, NOTIFY coverage_added; failure increments attempts and three failures park the job; budget check before claiming sets blocked_budget.
- A4 tables build_job, solution, scenario (v1 per O-17), builder_setting, storage_ledger; the builder role; the LISTEN/NOTIFY channels in A4 section 4.
- A2 section 2: draw_runouts(flop, k, seed) uniform without replacement, extract_build; A2 section 3 isomorphism: extraction applies the suit permutation from canonical to raw to the cards and every per-combo array.
- Planner inputs: seat rotation times equilibrium reach as priority (ADR 0013), the 650 GB budget (ADR 0018), K per position pair with 20 for frequent pairs (O-14), the S14 size estimate for bytes per runout, the storage ledger; scheduling stops at the budget and evicts nothing (02 section 5.2).
- Settings in builder_setting (schedule, central processing unit (CPU) share, budget, K) read on every claim so a change needs no redeploy (A1 section 6); 24/7 background priority with an overnight boost (O-13); BUILDER_THREADS (A2 section 5).
- Benchmark ranges: no packed configuration exists yet, so use hand-made fixture ranges for the O-52 line shape (online 6-max 100 big blinds (bb), button versus big blind single-raised pot) with the S02 placeholder sizing convention (open, see the Phase 2 plan's problems list; record it as a proposed O-ID). Pass rule O-50: peak resident set size (RSS) under 5 GB and under 30 minutes to 0.3 percent pot per preflop line on the simple tree with 16-bit storage.

Requirements this session closes (tests copied from the phase doc)
- R2.12 Runout extraction E6b in v1 (O-17): K runouts drawn uniformly by seed, every action branch kept, suit permutation applied from canonical to raw. Test: proptest permute then extract equals extract then permute.
- R2.16 gto-planner: build-job enumeration, priority from seat rotation times equilibrium reach (ADR 0013), storage budget, K per position pair (O-14), blocked_budget. Test: unit tests under a fixed budget; scheduling stops at the budget and evicts nothing.
- R2.17 Builder loop: SKIP LOCKED claim, exploitability check before publish, one-transaction publish of solution and scenario rows, NOTIFY coverage_added, three failures park the job. Test: integration test against Postgres and SeaweedFS with a tiny real solve; a parked job after three failures; the notify observed.
- R2.18 builder_setting and storage_ledger editable without redeploy; health and metrics endpoint; --once mode. Test: a setting change takes effect on the next claim; metrics scrape test.

Steps
1. (single) Read everything above. Enter plan mode: planner types and scoring, the claim loop and its transaction boundaries, the extraction pipeline from SolvedGame to BuildArtifacts, the operations surface on port 7071, the --once path, the integration test harness over the compose dev profile, and the benchmark method. Wait for my approval.
2. (single) Write the red tests tagged R2.12, R2.16, R2.17 and R2.18. Commit red.
3. Use a dynamic workflow for this step, under 8 agents: planner (gto-planner enumeration, priority, budget, K per pair, blocked_budget); build loop (claim with SKIP LOCKED, estimate_bytes refusal with a logged reason, solve per preflop line through the S15 adapter, exploitability check, write through gto-library, one-transaction publish, NOTIFY, failure and parking); runout extraction (draw_runouts, extract_build, the canonical-to-raw permutation, the proptest); operations (builder_setting and storage_ledger live reads, /healthz and /metrics, --once mode, the build_progress and builder_state notifies); one integrator for shared types and the service main; the verifier agent runs the tiny real solve integration test against Postgres and SeaweedFS in the compose dev profile (publish, scenario rows, notify observed, parking after three failures) plus the full test suite, and reports any red test verbatim.
4. (single) Build the builder container image for linux/amd64 in WSL2, run library-builder --once on the benchmark line under a 5 GB Docker memory limit (O-48), record peak RSS, seconds per line, iterations and exploitability against O-50 in validation/reports/bench-flop-line-zenbook.md. Then /code-review and /security-review, fix CRITICAL and HIGH, open the pull request into sprint/1-v1 with R2.12 and R2.16 to R2.18 in the template.

Definition of done
- [ ] R2.12, R2.16, R2.17 and R2.18 tests green and tagged; the integration test ran against real Postgres and SeaweedFS.
- [ ] validation/reports/bench-flop-line-zenbook.md records the O-50 numbers and says pass or fail honestly.
- [ ] The builder image builds for linux/amd64 and the images job builds arm64 for it (R0.3).
- [ ] Continuous integration (CI) green; coverage of gto-planner and library-builder at 80 percent or better.
- [ ] /code-review and /security-review done; CRITICAL and HIGH findings fixed.
- [ ] Pull request opened into sprint/1-v1 listing R2.12, R2.16, R2.17 and R2.18.

Report back
Your final message lists: each R ID with its test command and result; the branch and pull request link; the files written; the benchmark numbers against O-50; usage notes (units used against the planned high level, about 3); any new question as a proposed O-ID with a default, appended to V\planning\00-open-questions-and-risks.md under a new dated subsection.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| `crates/gto-planner/` | public repo, branch `p2/builder` |
| `services/library-builder/` with the loop, extraction, operations endpoints and `--once` | public repo |
| Extraction in `crates/gto-library/` (draw_runouts, extract_build, permutation) | public repo |
| Tests tagged R2.12, R2.16 to R2.18, including the compose integration test | `crates/gto-planner/tests/`, `services/library-builder/tests/` |
| Zenbook flop-line benchmark | `validation/reports/bench-flop-line-zenbook.md` |
| Proposed O-ID on benchmark ranges | `planning/00-open-questions-and-risks.md` in the vault |
| Pull request into `sprint/1-v1` | GitHub |
