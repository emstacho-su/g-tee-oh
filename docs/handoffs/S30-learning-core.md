---
id: 'g-tee-oh-handoff-s30-learning-core'
title: 'S30 Learning core'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 4
session: 'S30'
branch: 'p4/learning'
tags: [g-tee-oh, handoff, phase-4]
---
# S30 Learning core (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-4-rating-and-release|Phase 4 Rating, scheduling, progress, Deploy 2 and the v1 gate]]. This session produces the `packages/learning` core: Glicko-2 per track with fractional outcomes, feature-based item difficulty, the overall rank with tiers, the anti-farming predicates, the Free Spaced Repetition Scheduler (FSRS) adapter over ts-fsrs, Bayesian Knowledge Tracing (BKT) mastery, leak cost with the equilibrium reach prior, and queue selection. It closes R4.1 to R4.9. Branch `p4/learning` off `sprint/1-v1`; parallel group D, earliest day 4 (2026-10-23), paced for week 3 (09 sections 4 and 5); runs as a dynamic workflow; public; high usage (3 units). Decisions are cited as ADR nnnn (architecture decision record); answered questions by O-ID from [[projects/g-tee-oh/planning/00-open-questions-and-risks|00 Open questions and risks]].

## Before pasting

- [ ] S05 merged into `sprint/1-v1` (09 section 3): the pending tests tagged R4.1 and R4.6, the `packages/learning` skeleton with the A6 section 4 types, and the `validation/reports/` format (R0.11).
- [ ] S22 merged: the grading policy in `packages/learning` (R3.8), whose `GradeInput` and `GradeOutput` types the learning core builds on.
- [ ] `sprint/1-v1` green on the `ts` and `licenses` continuous integration (CI) jobs at its head.
- [ ] ADR 0011 parameters and ADR 0013 accepted (O-56, O-25); nothing for the owner to decide before start.
- [ ] Machine: the Zenbook, clone `C:\Users\stack\projects\g-tee-oh`, PowerShell. No credentials, drives or exports are needed; the session is pure TypeScript.

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull --ff-only
git switch -c p4/learning
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault and append O-IDs to `planning/00-open-questions-and-risks.md`.
2. Stay in the default permission mode, so you approve the workflow run when it launches.
3. Paste the prompt below.

## The prompt

```text
You are running session S30 of sprint 1 of g-tee-oh, Phase 4 (rating, scheduling, progress, Deploy 2 and the v1 gate), on branch p4/learning off the sprint branch sprint/1-v1. Goal: the packages/learning core as pure TypeScript, closing R4.1 to R4.9.

Reading order (vault root C:\Users\stack\vault\projects\g-tee-oh, added with /add-dir; paths are relative to it):
1. planning/phases/phase-4-rating-and-release.md
2. planning/09-v1-sprint-roadmap.md sections 3, 5 (row S30), 6 (Phase 4) and 7
3. planning/00-open-questions-and-risks.md, answered questions O-17 to O-67; O-8, O-22, O-25, O-27, O-35, O-56 and O-65 bind this session
4. planning/06-rating-and-progress.md (whole); planning/05-training-and-grading.md section 6
5. planning/architecture/A6-trainer-and-learning-engine.md; A4-data-model.md (learning state tables); A1-repo-and-conventions.md sections 2 and 4; A9-quality-security-ops.md section 1
6. decisions/0011-one-overall-rank-with-per-track.md, 0012-fsrs-scheduling-and-bkt-mastery-no.md, 0013-spot-frequency-prior-is-equilibrium-reach.md, 0004-poker-math-in-rust-product-logic.md, 0001-personal-self-hosted-portfolio-grade-multi.md
7. The repo's CLAUDE.md and any docs/ mirrored files; packages/learning as S05 and S22 left it

Rules:
- Zenbook clone C:\Users\stack\projects\g-tee-oh, Claude Code in PowerShell; this session is TypeScript only (O-23). The private capture repo is not touched.
- Branch p4/learning; merge by pull request into sprint/1-v1; sprint/1-v1 merges into main only in S35 (R4.18).
- Gates in order: plan first in plan mode and wait for the owner's approval (trivial one-liners exempt); a concrete task list; the smallest working increment; tests green before advancing, never on red; /code-review and fix CRITICAL and HIGH; /security-review is not needed unless you add auth, input handling, secrets or endpoints; conventional commits (feat:, fix:, chore:, refactor:, docs:, test:, perf:, ci:), each ending with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Test-driven: the R0.11 pending tests turn green first; every new test is tagged with its R ID; 80 percent coverage or better on new code.
- packages/learning stays pure: no I/O, no clock, no randomness except an injected random number generator (RNG) (A1 section 2). Poker numbers, meaning expected value (EV) loss, the floor, buckets and difficulty features, arrive from solver-query and are never recomputed here (ADR 0004).
- Accepted ADRs are fixed: 0011 with its parameters (O-56), 0012, 0013 (O-25), 0004, 0001. Cite the O-ID in a code comment and in the pull request wherever an answer sets a value. Anything open becomes a proposed O-ID with a default, appended to planning/00 under a new dated subsection; never decide it silently.
- Privacy (O-26): fixtures are synthetic; never copy numbers from the reference library into the repo.
- A step runs as a dynamic workflow only where this prompt says so, under 10 agents, with the verifier named. Report honestly at every gate: show failing output, name skipped steps.

Inputs:
- packages/learning skeleton and pending tests (S05, R0.11); GradeInput and GradeOutput from the grading policy (S22, R3.8; A6 section 4).
- Parameters: rating 1500, rating deviation (RD) 350, volatility 0.06, daily cap 150 rated updates per track, RD cap 120 for promotion, tier bands from 06 section 3.5 (ADR 0011, O-56, O-8); BKT prior 0.2, learn 0.15, guess 0.2, slip 0.1, mastered at 0.95 (06 section 5); FSRS grades Again under 0.4, Hard 0.4 to 0.7, Good 0.7 to 0.95, Easy at 0.95 or more with median response time under the class's typical time, desired retention 0.9 (06 section 4); convergence within 25 rating points after 300 items (O-65).
- Glicko-2 worked example: player 1500, RD 200, volatility 0.06, tau 0.5, against (1400, 30) win, (1550, 100) loss, (1700, 300) loss, ending about 1464.06, RD about 151.52, volatility about 0.05999 (A6 section 6).
- The ts-fsrs published test vectors as S05 wired them (O-35); the ts-fsrs license already verified (R0.11).

Requirements this session closes (test in parentheses):
- R4.1 Glicko-2 per track with fractional outcomes, one rating period per session (O-27), inactivity raises RD only and never subtracts points (worked example; fast-check update symmetry).
- R4.2 a simulated learner of known skill converges within 25 points after 300 items (O-65); repeat attempts and drill attempts leave the rating unchanged (simulation with an injected RNG; anti-farming tests).
- R4.3 anti-farming: rated only when automated, first attempt, unrevealed panels, no noise flags and under the daily cap of 150 per track; drills never rated; no points for participation, time or streaks (each rule alone flips rated to false; streak days change no rating).
- R4.4 feature-based item difficulty; items with every action inside the floor excluded from rated play (difficulty monotone in EV gap and purity; excluded items carry rated = false).
- R4.5 overall rank as the frequency-weighted average of conservative track ratings (rating minus 2 RD); promotion needs every track's RD under 120 and rating above the tier floor; eight placeholder tiers (weighted-average fixture; farming one track cannot promote).
- R4.6 FSRS adapter over ts-fsrs with the grade mapping from mean score and response time, retention 0.9 (the published vectors pass through the adapter, O-35; grade mapping table test).
- R4.7 BKT mastery with the 06 section 5 parameters, mastered at 0.95, gates nothing (hand-computed update sequences; no-gating test).
- R4.8 leak cost from the equilibrium reach prior (ADR 0013), shrinkage toward the track average under 30 decisions, weekly leak_history series (fixture with known frequencies and misses; the prior computed from fixture reach weights).
- R4.9 queue selection: leak cost times overdue factor, interleave rule, worked example on first exposure, hypercorrection front-loading (1,000 simulated picks with no two consecutive from one action family; first exposure unrated with panels visible).

Steps:
1. (single) Plan mode: read the files above, list the pending R0.11 tests and the S22 types, write the plan as one module per lane below with the public function signatures and the fixture shapes, wait for approval, then write the task list.
2. (dynamic workflow, under 5 agents: a rating agent for R4.1, R4.3, R4.4 and R4.5; a scheduling agent for R4.6, R4.7 and R4.9; a leak-cost agent for R4.8; the verifier agent runs the R4.2 simulation against the rating module, the whole packages/learning suite with coverage, and the licenses check locally) Use a dynamic workflow for this step, under 5 agents. Each agent works red first on its own files, turns its vectors green, and leaves the shared index file to the integration step.
3. (single) Integrate: export the public surface, run the full suite with coverage, add a lint rule or test that packages/learning imports no I/O, clock or Math.random, run /code-review and fix CRITICAL and HIGH, commit, open the pull request into sprint/1-v1 listing R4.1 to R4.9.

Definition of done:
- [ ] The R0.11 pending tests for R4.1 and R4.6 are green; every R4.1 to R4.9 test is green and tagged; coverage 80 percent or better on packages/learning.
- [ ] The ts and licenses jobs are green on the branch.
- [ ] /code-review done with CRITICAL and HIGH fixed; no /security-review needed unless the scope grew.
- [ ] Pull request opened into sprint/1-v1 with the R IDs and the O-IDs it relied on.
- [ ] New questions appended to planning/00 as proposed O-IDs with defaults.

Report back, in the final message: each R ID with the test command and its result; the branch and pull request link; the files written; no gate artifact (S33 records the Phase 4 gate); usage in units against the planned high (3); any new question as a proposed O-ID with a default, appended to planning/00 under a new dated subsection.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| Learning modules: rating (Glicko-2, difficulty, rank and tiers, anti-farming), scheduling (FSRS adapter, BKT, queue), leak cost; layout is the session's choice within A1 | `packages/learning` on `p4/learning` |
| Tests tagged R4.1 to R4.9, including the simulation and the purity check | `packages/learning` |
| Pull request into `sprint/1-v1` | GitHub |
| Proposed O-IDs, if any | vault `planning/00-open-questions-and-risks.md` |
