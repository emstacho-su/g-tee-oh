---
id: 'g-tee-oh-handoff-s33-phase-4-gate'
title: 'S33 Phase 4 gate'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 4
session: 'S33'
branch: 'p4/gate'
tags: [g-tee-oh, handoff, phase-4]
---
# S33 Phase 4 gate (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-4-rating-and-release|Phase 4 Rating, scheduling, progress, Deploy 2 and the v1 gate]]. This session is the Phase 4 gate: it runs and records the tests already written for success criteria 6, 7 and 8 and the anti-farming rules, confirms flows 1 and 6 in continuous integration (CI), performs the R4.15 tau and label-threshold revisit on local-port attempts, writes the `just perf` report (O-40) and the Phase 4 gate report, and confirms every p4 branch is merged. It closes R4.15 and the closing tests of criteria 6, 7 and 8. Branch `p4/gate` off `sprint/1-v1`; parallel group F, earliest day 8 (2026-10-27), paced for week 5 (09 sections 4 and 5); single session; public; medium usage (2 units). Decisions are cited as ADR nnnn (architecture decision record); answered questions by O-ID from [[projects/g-tee-oh/planning/00-open-questions-and-risks|00 Open questions and risks]].

## Before pasting

- [ ] S30, S31 and S32 merged into `sprint/1-v1` (09 section 3: S32 blocks S33), and `sprint/1-v1` green on all seven CI jobs at its head.
- [ ] S19 merged: the fixture library the flows run against in CI (O-30).
- [ ] Local-port attempts exist for R4.15: the owner has played trainer and automated sessions on local ports during S25 to S32, and the dev database on the Zenbook still holds those `attempt` rows. If fewer exist than the revisit needs, see problems list (open).
- [ ] S29's `just perf` report exists under `validation/reports/` as the baseline (O-40).
- [ ] Machine: the Zenbook, clone `C:\Users\stack\projects\g-tee-oh`, PowerShell; the compose dev stack up in Windows Subsystem for Linux 2 (WSL2) (O-23).

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull --ff-only
git switch -c p4/gate
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault, write the R4.15 decision note and any ADR amendment there, and append O-IDs to `planning/00-open-questions-and-risks.md`.
2. Stay in the default permission mode.
3. Paste the prompt below.

## The prompt

```text
You are running session S33 of sprint 1 of g-tee-oh, Phase 4 (rating, scheduling, progress, Deploy 2 and the v1 gate), on branch p4/gate off the sprint branch sprint/1-v1. Goal: the Phase 4 gate, closing R4.15 and recording the closing tests of success criteria 6, 7 and 8. You run tests already written; you write reports, one decision note and at most one ADR amendment. You write no feature code.

Reading order (vault root C:\Users\stack\vault\projects\g-tee-oh, added with /add-dir; paths are relative to it):
1. planning/phases/phase-4-rating-and-release.md
2. planning/09-v1-sprint-roadmap.md sections 2, 5 (row S33), 6 (Phase 4), 7 and 9
3. planning/00-open-questions-and-risks.md, answered questions O-17 to O-67; O-22, O-26, O-40, O-56 and O-65 bind this session
4. planning/01-product-spec.md section 6 (criteria 6, 7, 8); planning/05-training-and-grading.md section 6; planning/06-rating-and-progress.md section 3
5. planning/architecture/A6-trainer-and-learning-engine.md section 6; A9-quality-security-ops.md sections 1, 2 and 6; A1-repo-and-conventions.md section 4
6. decisions/0011-one-overall-rank-with-per-track.md and decisions/_README.md (how an amendment is indexed; ADR 0008 amended by 0020 is the model)
7. The repo's CLAUDE.md, validation/reports/ (the phase-0 gate report as the format model, S29's gate and perf reports) and any docs/ mirrored files

Rules:
- Zenbook clone C:\Users\stack\projects\g-tee-oh, Claude Code in PowerShell; WSL2 only for the compose dev stack (O-23). The private capture repo is not touched.
- Branch p4/gate; merge by pull request into sprint/1-v1; sprint/1-v1 merges into main only in S35 (R4.18).
- Gates in order: plan first in plan mode and wait for the owner's approval; a task list; tests green, never advance on red; /code-review on what you commit; /security-review is not needed (reports only); conventional commits (docs:, test:, chore:), each ending with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- A gate records, it does not patch: if a test fails, stop, show the output, and report which R ID is red; the fix belongs to a follow-up on the owning session's branch pattern, not to this one.
- Accepted ADRs are fixed; ADR 0008 and ADR 0011 are never edited; if R4.15 changes tau, a label threshold (ADR 0008) or a rating parameter (ADR 0011), write a new ADR that amends the one concerned and mark 0011 "amended by" in _README (A1 section 4, O-56). Cite O-IDs; anything open becomes a proposed O-ID with a default appended to planning/00 under a new dated subsection.
- Privacy (O-26): the R4.15 note names the sample size, date range and machine; no attempt rows, hands or reference-derived numbers enter the public repo or the note.
- Writing style for the reports and the note: no em dashes, no bold, acronyms expanded on first use, mechanism before conclusion. Report honestly at every gate.

Inputs:
- Tests from S30 (R4.1 to R4.9), S31 (R4.10, R4.11, R4.13, R4.14, the R4.12 aggregation tests) and S32 (flows 1 and 6, R4.12).
- Current grading constants: tau 4 percent pot and the labels Best, Correct, Inaccuracy (above the floor and under 1 percent pot), Mistake (1 to 5 percent), Blunder (above 5 percent) (05 section 6, R3.8).
- The dev database attempt rows from local-port sessions; the S29 perf report; the fixture library (O-30).

Requirements this session closes (test or gate artifact in parentheses):
- R4.15 tau and the label thresholds revisited with attempts from local-port testing (O-22); the decision recorded in 00 and, if the parameters change, as an amendment to ADR 0008 (tau and labels) or ADR 0011 (rating parameters) (O-56); the Mac revisit is post-v1 (grading test suite green with the chosen values; the decision note present in 00 naming the local-port sample).
- Closing tests of criterion 6: the worked example, update symmetry, the simulation, the anti-farming matrix (R4.1 to R4.5, R4.9, R4.10, R4.11) and flow 1.
- Closing test of criterion 7: the ts-fsrs published vectors through the Free Spaced Repetition Scheduler (FSRS) adapter (R4.6, O-35).
- Closing tests of criterion 8: the Bayesian Knowledge Tracing (BKT) sequences, the leak-cost fixture, the aggregation tests and flow 6 (R4.7, R4.8, R4.11, R4.12).

Steps, every one single:
1. (single) Plan mode: read; list every test to run with its command and the artifacts to write; wait for approval; write the task list.
2. (single) Confirm p4/learning, p4/api-learning and p4/web-progress are merged into sprint/1-v1 and that the head is green on all seven jobs; record the commit.
3. (single) Run and record, with command, commit and result: R4.1 to R4.9 in packages/learning (worked example, symmetry, simulation, anti-farming, difficulty, rank, FSRS vectors, BKT, leak cost, interleave); R4.10 and R4.11 integration tests; R4.13 holdout property and retest tests; R4.14 streak tests; R4.12 aggregation tests.
4. (single) Flows 1 and 6: confirm the CI e2e job runs them on sprint/1-v1 (R3.22 left flow 1 to Phase 4); link the green run.
5. (single) R4.15: query the dev database for the local-port attempts (count, date range, loss distribution in percent pot, label counts, share inside the floor); evaluate tau 4 percent pot and the thresholds against it: whether scores spread across the sample instead of bunching at 1 or near 0, and whether the label counts match what the owner saw at the table; propose keep or change and ask the owner; apply the answer, keep the grading suite green, write the amendment ADR if a value changed; append the decision note to planning/00 under a new dated subsection with the sample size, date range, the values kept or changed and the reason; note that the Mac revisit is post-v1 (09 section 9).
6. (single) just perf on the Zenbook (O-40): write the JSON report under validation/reports/; the thresholds are 300 ms node read, 60 ms grade, 500 ms decision to feedback; a miss is a gate failure, so stop and report it.
7. (single) Write validation/reports/phase-4-gate.md (named by analogy with phase-0-gate.md; open, see problems list): criteria 6, 7 and 8 with test names, commands and results; the anti-farming matrix; the flow 1 and flow 6 run links; the R4.15 decision and note location; the perf report path; the merged branches and the head commit.
8. (single) /code-review on the committed files; commit; open the pull request into sprint/1-v1 listing R4.15 and the criteria closed.

Definition of done:
- [ ] Every test in step 3 green and recorded; flows 1 and 6 green in CI.
- [ ] R4.15 decision note in planning/00; grading suite green with the chosen values; amendment ADR written and indexed if a value changed.
- [ ] just perf report committed and inside the O-40 thresholds.
- [ ] validation/reports/phase-4-gate.md committed; every p4 branch confirmed merged.
- [ ] /code-review done; pull request opened into sprint/1-v1.

Report back, in the final message: each R ID (R4.1 to R4.15) with the test command and its result; the branch and pull request link; the files written; the gate artifacts under validation/reports/ (the phase-4 gate report and the perf report); the R4.15 decision in one line; usage in units against the planned medium (2); any new question as a proposed O-ID with a default, appended to planning/00 under a new dated subsection.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| Phase 4 gate report | `validation/reports/phase-4-gate.md` on `p4/gate` (name proposed, see problems list) |
| `just perf` JSON report for the gate session (O-40) | `validation/reports/` |
| R4.15 decision note | vault `planning/00-open-questions-and-risks.md`, new dated subsection |
| ADR amending ADR 0008 or ADR 0011, only if a parameter changed (O-56) | vault `decisions/` and `_README`; mirrored to `docs/decisions/` by S35 |
| Flows 1 and 6 confirmed in the CI `e2e` job | GitHub Actions run link in the report |
| Pull request into `sprint/1-v1` | GitHub |
