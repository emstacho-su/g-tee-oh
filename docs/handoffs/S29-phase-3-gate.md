---
id: 'g-tee-oh-handoff-s29-phase-3-gate'
title: 'S29 Phase 3 gate'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 3
session: 'S29'
branch: 'p3/gate'
tags: [g-tee-oh, handoff, phase-3]
---
# S29 Phase 3 gate (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-3-preflop-trainer|Phase 3 Preflop trainer]]. This session is the Phase 3 gate. It writes or runs the closing test for each of success criteria 3, 4, 5, 9, 10 (Zenbook part) and 11, wires end-to-end flows 2 to 5 into the continuous integration (CI) `e2e` job, runs the Zenbook 95th percentile latency (p95) guard, confirms every `p3` branch is merged, runs the visual pass with screenshots, and writes the gate report that the v1 gate (S34) consumes. Branch `p3/gate`, parallel group F, earliest day 8, paced for week 5 (days 29 to 31, 2026-11-17 to 2026-11-19; 09 sections 4 and 5). It runs as a dynamic workflow. Public. Usage: high. R IDs are requirement identifiers; O-IDs are the answered questions in [[projects/g-tee-oh/planning/00-open-questions-and-risks|00 Open questions and risks]].

## Before pasting

- [ ] S26, S27 and S28 merged into `sprint/1-v1`, and with them S21 to S25; `sprint/1-v1` green on all seven CI jobs.
- [ ] S16 and S19 merged (the real `solver-query` and the fixture library, O-30, O-53).
- [ ] The build card under `research/` in the vault (O-24); S29 blocks on it (O-67). If the owner has answered O-64 with a yes, the translated acceptance file may be committed; otherwise it runs locally only.
- [ ] S11, if it has happened: captured live data at 1/3 and 2/5 packed locally (R1.8), so the keying test can also run on it; otherwise the synthetic live sets stand in (O-57).
- [ ] The 2/5 cap verified or still flagged unverified (O-66); R3.21 passes either way.
- [ ] The compose `dev` stack on the Zenbook with `FIXTURE_LIBRARY_PATH` set (O-62); Docker in Windows Subsystem for Linux 2 (WSL2) up (O-23); the Zenbook otherwise idle while `just perf` runs.
- [ ] You are available for the visual pass; the screenshot review is a gate condition (09 section 2).

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull
git switch -c p3/gate
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault (the build card under `research/`) and append O-IDs to planning/00.
2. Stay in the default permission mode, so you approve the workflow when it launches.
3. Paste the prompt below.

## The prompt

```text
Role and context
You are running session S29 of sprint 1 of g-tee-oh, Phase 3 (Preflop trainer), on branch p3/gate off the sprint branch sprint/1-v1. Goal: the Phase 3 gate. You close R3.21 and R3.22 and run the closing tests of success criteria 3, 4, 5, 9, 10 (Zenbook part) and 11, which close R3.3 (the p95 guard), R3.7 (the recompute report), R3.10 (chi-square), R3.15 (the build-card run), R3.19 and R3.20 (template and validator), and R3.4 with R2.15 (dependency and request-path tests). You write the gate report. Where p95 is the 95th percentile latency.

Reading order (vault at C:\Users\stack\vault\projects\g-tee-oh, added with /add-dir)
1. planning/phases/phase-3-preflop-trainer.md (Instruments and Definition of Done)
2. planning/09-v1-sprint-roadmap.md sections 2 (the Phase 3 row), 3, 5 (the S29 row), 6 (Phase 3) and 7 (traceability and the gate table)
3. planning/00-open-questions-and-risks.md, answered questions O-17 to O-67; this session leans on O-18, O-21, O-22, O-24, O-30, O-40, O-53, O-54, O-57, O-60, O-62, O-64, O-66 and O-67
4. planning/01-product-spec.md section 6; planning/05-training-and-grading.md sections 4, 6, 7 and 10
5. planning/architecture/A9-quality-security-ops.md sections 1, 2 and 6; A7-web-app.md section 5; A1-repo-and-conventions.md section 2; A3-library-format.md section 1 (the node record the recompute reads)
6. decisions/_README.md, then ADRs 0004, 0008, 0014, 0016, 0018 and 0020
7. In the repo: CLAUDE.md, docs/ (mirrored files), validation/reports/ (the report format from R0.11 and the Phase 0 and Phase 2 gate reports), tools/validate/ (S13), crates/gto-library/ (S14), services/api/, web/, packages/learning/, .github/workflows/

Rules
- Clone C:\Users\stack\projects\g-tee-oh, Claude Code in PowerShell, native Windows Rust toolchain; WSL2 (Windows Subsystem for Linux 2) only for Linux container builds and benchmarks (O-23). The private capture repo C:\Users\stack\projects\g-tee-oh-capture is not touched by this session (O-28).
- Branch p3/gate off sprint/1-v1; merge by pull request into sprint/1-v1; sprint/1-v1 merges into main only in S35 (R4.18).
- Gates in order: plan first (enter plan mode, write the plan, wait for my approval; trivial one-liners exempt); break down into a concrete task list; implement the smallest working increment; tests pass (never advance on red; write the suite if none exists); run /code-review and fix CRITICAL and HIGH findings; run /security-review for anything touching auth, user input, secrets or endpoints; commit with conventional commits (feat:, fix:, chore:, refactor:, docs:, test:, perf:, ci:) and end every commit message with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Test-driven: red test first, tagged with its R ID, then green, then refactor; 80 percent coverage or better on new code.
- Visual testing happens on local ports with my screenshots. Nothing deploys to the Mac without my explicit yes at that moment (O-20); this session deploys nothing. A step runs as a dynamic workflow only where this prompt says so in my words; keep every workflow under 10 agents and name what its verifier runs.
- Accepted ADRs are fixed (0004 and 0013 count as Accepted, O-25); if a step would contradict one, stop and raise it. Cite O-IDs and ADR numbers wherever an answer is used. A new question goes to planning/00 as a proposed O-ID with a default under a new dated subsection.
- Privacy (O-26, O-64, ADR 0017): the build-card run against the reference library stays private; the gate report names drills by name only and records pass counts, never captured data, counts of captured nodes or configuration names beyond the public catalog. The report file names under validation/reports/ are not fixed by 09 (O-87, answered in 00); use phase-3-gate.md, recompute.json, perf-zenbook.json and keying.json unless an O-ID has set them.
- Report honestly at every gate: if a criterion fails, the gate fails; say so, show the output, and stop before the report claims a pass. Never defer a gate (O-39).
- Docs you write: no em dashes, no bold, acronyms expanded on first use, the mechanism before the conclusion.

Inputs
- The fixture library (G6a push/fold and the synthetic 6-max and live sets, R2.19, R2.20) through FIXTURE_LIBRARY_PATH (O-62); the real solver-query (S16); attempts produced by running seeded sessions through api against the fixture library on the dev stack, at least 200 of them, for the recompute sample
- just perf (S23) and the O-40 thresholds: 300 ms study node read, 60 ms grade, 500 ms decision to feedback at p95; the A9 section 6 Mac budgets they double
- The acceptance runner and synthetic drill set (S26); the translated build card under research/ in the vault (O-24, O-64); the captured live sets locally if R1.8 says they exist (O-57)
- The O-60 definition: tools/validate recompute is a Rust path through gto-library that never calls solver-query, over a seeded random sample of 200 attempts, with the seed in the report

Requirements this session closes
- R3.21 live rake keying (criterion 11): a 1/3 spot and a 2/5 spot with the same action resolve to different solutions with different bb caps (1.67 versus 1.0 big blinds), over the labeled synthetic live sets in CI (O-57) and locally on captured data when R1.8 says it exists (O-18). Proof: the keying test in CI; the local result in the gate report.
- R3.22 end-to-end flows 2 to 5 run in CI against the fixture library (O-30, O-62). Proof: the CI e2e job green on this branch.
- Closing runs recorded in the gate report: R3.7 (tools/validate recompute, 200 seeded attempts equal to attempt.ev_loss_bb and the feedback payload, O-60); R3.3 (just perf report committed, hosted CI checking it against the O-40 thresholds, the e2e job repeating the timing as an advisory check that never fails the build); R3.10 (chi-square over 10,000 seeded rolls); R2.3 (the bucket-edge table rerun); R3.9 and flow 4; R3.15 (every build-card drill parses and produces a prompt, against the fixture library and, locally, the reference library); R3.19 and R3.20 (number-membership and planted-number tests with the mocked model, O-54); R2.15 and R3.4 (cargo tree -p solver-query without gto-solve, pnpm why for api, the request-path test).

Steps
1. (single) Plan: enter plan mode, read the files above, confirm the Before-pasting preconditions (every p3 branch merged, the card present, which live data exists), write the plan with its task list, wait for my approval.
2. Use a dynamic workflow for this step, under 9 agents: one agent per success criterion, each writing or running its closing test and saving its report: criterion 3 (write tools/validate recompute per O-60, generate the 200 seeded attempts, write recompute.json with the seed); criterion 4 (rerun the bucket-edge table, the chi-square test, the ActionBar test and flow 4); criterion 5 (run the acceptance runner on the build card locally and on the synthetic set, flow 2); criterion 9 (template and validator tests); criterion 10 (dependency rules, request-path test, just perf on the idle Zenbook, commit perf-zenbook.json, add the hosted CI check and the advisory e2e timing); criterion 11 (the keying test on the synthetic sets in CI and on captured data locally if present, keying.json); one agent on the CI e2e job wiring flows 2 to 5 with FIXTURE_LIBRARY_PATH. The verifier agent confirms every p3 branch is merged into sprint/1-v1 and the seven jobs are green, then runs the visual pass on a local port through flows 2 to 5 and hands me the screenshots.
3. (single) Wait for my comments on the screenshots; fix what I flag; rerun the affected flow.
4. (single) Write validation/reports/phase-3-gate.md: every R3.1 to R3.22 requirement with its test command and result, each of criteria 3, 4, 5, 9, 10 (Zenbook) and 11 with its report path, the build-card result by drill name only, which live data the keying test used, and the Zenbook p95 numbers against O-40. If anything is red, the report says the gate failed and what is missing.
5. (single) Run /code-review and fix CRITICAL and HIGH findings; run /security-review on the new CI steps and the recompute tool's database access; open the pull request into sprint/1-v1 listing R3.21, R3.22 and the closing R IDs.

Definition of done
- [ ] Criteria 3, 4, 5, 9, 10 (Zenbook part) and 11 pass with their reports under validation/reports/
- [ ] The CI e2e job green with flows 2 to 5; hosted CI checks the committed perf report; the advisory timing runs without failing the build
- [ ] Every p3 branch merged into sprint/1-v1; all seven jobs green; the private-data guard passes
- [ ] Screenshots from the visual pass reviewed by me
- [ ] validation/reports/phase-3-gate.md written with every R3 requirement and every criterion's report path
- [ ] /code-review done; /security-review done; pull request opened into sprint/1-v1

Report back
Your final message lists: each R ID closed or recorded here (R3.21, R3.22, R3.3, R3.7, R3.10, R3.15, R3.19, R3.20, R3.4 with R2.15, R2.3, R3.9) with its test command and result; the branch and the pull request link; the files written; the gate artifacts under validation/reports/ with their paths; the three p95 numbers; usage notes (units used against the planned high level); any new question (the report file names, anything the gate exposed) as a proposed O-ID with a default, appended to planning/00 under a new dated subsection; and whether S33 and S34 may proceed.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| `tools/validate recompute` (Rust, through `gto-library`, never `solver-query`) | Repo, branch `p3/gate`, `tools/validate/` |
| `validation/reports/phase-3-gate.md`, `recompute.json`, `perf-zenbook.json`, `keying.json` (names proposed, open) | Repo, `validation/reports/` |
| CI `e2e` job wiring for flows 2 to 5; the hosted check of the perf report; the advisory timing step | Repo, `.github/workflows/` |
| Keying test (R3.21) and the closing test runs recorded in the report | Repo |
| Screenshots from the visual pass | Handed to the owner |
| Pull request into `sprint/1-v1` | GitHub |
| New O-IDs | `planning/00-open-questions-and-risks.md` in the vault |
