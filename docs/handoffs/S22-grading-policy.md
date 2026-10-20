---
id: 'g-tee-oh-handoff-s22-grading-policy'
title: 'S22 grading policy'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 3
session: 'S22'
branch: 'p3/grading-policy'
tags: [g-tee-oh, handoff, phase-3]
---
# S22 grading policy (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-3-preflop-trainer|Phase 3 Preflop trainer]]. This session produces the grading policy as a pure module in `packages/learning`: score, labels, the rated flag and weight, the three grouping modes, the random number generator (RNG) band mapping with its chi-square test, the calibration stat and the confident-miss queue rule. Branch `p3/grading-policy`, parallel group C, earliest day 3, paced for week 2 (days 8 to 14, 2026-10-27 to 2026-11-02; 09 sections 4 and 5). It runs as a single session: one pure module whose specification is [[projects/g-tee-oh/planning/05-training-and-grading|05 Training and grading]] section 6 and the R0.11 table, so one agent keeps the edge cases coherent. Public. Usage: medium. R IDs are requirement identifiers; O-IDs are the answered questions in [[projects/g-tee-oh/planning/00-open-questions-and-risks|00 Open questions and risks]].

## Before pasting

- [ ] S01 merged into `sprint/1-v1` (the pnpm workspace).
- [ ] S05 merged: the `packages/learning` skeleton with the A6 section 4 types and the pending R0.11 tests (the learning vectors and the report format).
- [ ] The Zenbook clone at `C:\Users\stack\projects\g-tee-oh` (O-23). No Docker, no owner input and no solver-query binary are needed; the module is pure TypeScript.

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull
git switch -c p3/grading-policy
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault and append O-IDs to planning/00.
2. Stay in the default permission mode.
3. Paste the prompt below.

## The prompt

```text
Role and context
You are running session S22 of sprint 1 of g-tee-oh, Phase 3 (Preflop trainer), on branch p3/grading-policy off the sprint branch sprint/1-v1. Goal: the grading policy, grouping modes, RNG (random number generator) band mapping with the chi-square test, the calibration stat and the confident-miss queue rule, all as pure functions in packages/learning. You close R3.8, the mapping part of R3.10 and the stat part of R3.11.

Reading order (vault at C:\Users\stack\vault\projects\g-tee-oh, added with /add-dir)
1. planning/phases/phase-3-preflop-trainer.md
2. planning/09-v1-sprint-roadmap.md sections 3, 5 (the S22 row), 6 (Phase 3) and 7
3. planning/00-open-questions-and-risks.md, answered questions O-17 to O-67; this session leans on O-22, O-23, O-25, O-29 and O-56
4. planning/05-training-and-grading.md (whole; sections 5 to 7 are the specification); planning/06-rating-and-progress.md only for the rated-flag context
5. planning/architecture/A6-trainer-and-learning-engine.md sections 1, 4 and 6; A1-repo-and-conventions.md section 2 (packages/learning is pure); A9-quality-security-ops.md section 1
6. decisions/_README.md, then ADRs 0004, 0008, 0009, 0010 and 0020
7. In the repo: CLAUDE.md, docs/ (mirrored files), packages/learning/ (the S05 skeleton and its pending tests)

Rules
- Clone C:\Users\stack\projects\g-tee-oh, Claude Code in PowerShell, native Windows Rust toolchain; WSL2 (Windows Subsystem for Linux 2) only for Linux container builds and benchmarks (O-23). The private capture repo C:\Users\stack\projects\g-tee-oh-capture is not touched by this session (O-28).
- Branch p3/grading-policy off sprint/1-v1; merge by pull request into sprint/1-v1; sprint/1-v1 merges into main only in S35 (R4.18).
- Gates in order: plan first (enter plan mode, write the plan, wait for my approval; trivial one-liners exempt); break down into a concrete task list; implement the smallest working increment; tests pass (never advance on red; write the suite if none exists); run /code-review and fix CRITICAL and HIGH findings; run /security-review for anything touching auth, user input, secrets or endpoints; commit with conventional commits (feat:, fix:, chore:, refactor:, docs:, test:, perf:, ci:) and end every commit message with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Test-driven: red test first, tagged with its R ID, then green, then refactor; 80 percent coverage or better on new code.
- Nothing deploys to the Mac without my explicit yes at that moment (O-20). This session runs no workflow: every step is single.
- Accepted ADRs are fixed (0004 and 0013 count as Accepted, O-25); if a step would contradict one, stop and raise it. Cite O-IDs and ADR numbers in code comments, commit bodies and docs wherever an answer is used. A new question goes to planning/00 as a proposed O-ID with a default under a new dated subsection.
- Privacy (O-26, ADR 0017): nothing GTO Wizard-specific enters the repo. The label names (Best, Correct, Inaccuracy, Mistake, Blunder) and the grouping mode names are allowed; they are the product being emulated, not a specific.
- Report honestly at every gate: if tests fail, say so and show the output; if a step was skipped, say which.
- Docs you write: no em dashes, no bold, acronyms expanded on first use, the mechanism before the conclusion.

Inputs
- packages/learning skeleton with the A6 section 4 types GradeInput and GradeOutput (S05, R0.11)
- The solver-query grade response shape from A5 section 2: ev_by_action, loss_pct_pot, freq_by_action, floor_pct_pot, noise_flags; and the node actions (token, size_cbb, bucket, label). Bucket mapping and the floor come from Rust (R2.3, R2.13) and are inputs here, never recomputed (ADR 0004)
- 05 section 6.3: score s = exp(-max(0, loss - floor) / tau) with tau = 4 percent pot as a named constant (tuned in Phase 4, R4.15, O-22); labels Best (at or below floor and the highest-frequency action or the roll-selected one), Correct (at or below floor, in the mix), Inaccuracy (above floor, under 1 percent pot), Mistake (1 to 5 percent), Blunder (above 5 percent)
- A6 section 4: rated only when mode is automated, first attempt, no revealing panels, no noise flags, under the daily cap; 05 section 7: bands ordered passive to aggressive (fold, check or call, bets small to large), the roll-selected action is Best

Requirements this session closes
- R3.8 grading policy as a pure function over solver-query output: score, labels per 05 section 6.3, rated flag and weight per A6 section 4, grouping modes Standard (exact size), Grouped (bucket) and Simple (the action type graded by its best size, using the best EV, expected value, among the tree's sizes of that type). Proof: unit tests at every label threshold (the floor, 1 percent, 5 percent, each edge and one tick above), the floor boundary, a mixed hand inside and outside the floor; fast-check property that score is monotone non-increasing in loss.
- R3.10, mapping part: cumulative bands from freq_by_action in passive-to-aggressive order, the roll-selected action labeled Best. Proof: over 10,000 seeded rolls per tested hand, selected-action counts match the frequencies by a chi-square test (the significance level is open; use the most conservative conventional level, name it as a constant, and propose it as an O-ID). The roller component and explainer land in S25.
- R3.11, stat part: calibration (accuracy when sure versus unsure) aggregated from fixture attempts, and the queue rule that a confident miss sorts to the front, written as pure functions S30's queue selection reuses (R4.9). Proof: calibration aggregation test on fixture attempts; a queue test that a confident miss is next. The tap itself lands in S25.

Steps
1. (single) Plan: enter plan mode, read the files above, write the plan with its task list, wait for my approval.
2. (single) Red: write the tests above, each tagged with its R ID, against the S05 types; extend the types only where A6 section 4 is silent (grouping mode, the actions list, the roll) and record each extension in the plan.
3. (single) Green: implement the policy, the grouping modes, the band mapping, the calibration aggregation and the queue rule as pure functions with an injected RNG for the chi-square test; no I/O, no clock.
4. (single) Refactor; confirm coverage on packages/learning is 80 percent or better; run /code-review and fix CRITICAL and HIGH findings; /security-review does not apply to a pure module with no input boundary, say so in the report.
5. (single) Open the pull request into sprint/1-v1 listing R3.8, R3.10 and R3.11.

Definition of done
- [ ] Every label threshold, the floor boundary and the mixed-hand cases green; the monotone property green
- [ ] Chi-square test over 10,000 seeded rolls green with its significance level named as a constant and proposed as an O-ID
- [ ] Calibration aggregation and confident-miss queue tests green; every test tagged with its R ID
- [ ] Coverage 80 percent or better; /code-review done; /security-review recorded as not applicable
- [ ] Pull request opened into sprint/1-v1 with the R IDs listed

Report back
Your final message lists: each R ID (R3.8, R3.10 mapping part, R3.11 stat part) with its test command and result; the branch and the pull request link; the files written; the constants chosen (tau, the significance level); usage notes (units used against the planned medium level); any new question as a proposed O-ID with a default, appended to planning/00 under a new dated subsection.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| `packages/learning/` grading policy, grouping modes, band mapping, calibration, queue rule | Repo, branch `p3/grading-policy` |
| Unit tests, the fast-check property and the chi-square test, tagged R3.8, R3.10, R3.11 | Repo, `packages/learning/` tests |
| Pull request into `sprint/1-v1` | GitHub |
| Proposed O-ID for the chi-square significance level, and any other new question | `planning/00-open-questions-and-risks.md` in the vault |
