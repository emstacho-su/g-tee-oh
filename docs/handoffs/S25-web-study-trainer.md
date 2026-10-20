---
id: 'g-tee-oh-handoff-s25-web-study-trainer'
title: 'S25 web study and trainer'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 3
session: 'S25'
branch: 'p3/web-study-trainer'
tags: [g-tee-oh, handoff, phase-3]
---
# S25 web study and trainer (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-3-preflop-trainer|Phase 3 Preflop trainer]]. This session produces the study browser and the trainer in spot mode: the confidence tap, the feedback panel, the random number generator (RNG) roller with its explainer, grouping labels on the action buttons, hotkeys, and end-to-end flows 3 and 4, with a visual pass on a local port that hands the owner screenshots. Branch `p3/web-study-trainer`, parallel group E, earliest day 6, paced for week 4 (days 22 to 28, 2026-11-10 to 2026-11-16; 09 sections 4 and 5). It runs as a dynamic workflow. Public. Usage: high. R IDs are requirement identifiers; O-IDs are the answered questions in [[projects/g-tee-oh/planning/00-open-questions-and-risks|00 Open questions and risks]].

## Before pasting

- [ ] S23 merged into `sprint/1-v1`: study, coverage, session and decision endpoints against the fixture `solver-query`.
- [ ] S24 merged: the web foundation and the core components.
- [ ] S22 merged: the grading policy, whose labels and band mapping the screens display.
- [ ] The compose `dev` stack runs on the Zenbook with `FIXTURE_LIBRARY_PATH` set (O-62); Docker in Windows Subsystem for Linux 2 (WSL2) is up (O-23).
- [ ] You are available during the session to look at screenshots from a local port; the owner's review is a Phase 3 gate condition (09 section 2).

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull
git switch -c p3/web-study-trainer
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault and append O-IDs to planning/00.
2. Stay in the default permission mode, so you approve the workflow when it launches.
3. Paste the prompt below.

## The prompt

```text
Role and context
You are running session S25 of sprint 1 of g-tee-oh, Phase 3 (Preflop trainer), on branch p3/web-study-trainer off the sprint branch sprint/1-v1. Goal: the study browser and the trainer in spot mode with the confidence tap, the feedback panel, the RNG (random number generator) roller and explainer, grouping labels and hotkeys, closed by end-to-end flows 3 and 4 and a visual pass with my screenshots. You close R3.9, the roller and explainer part of R3.10, the tap part of R3.11, the screen part of R3.12 and the spot part of R3.13.

Reading order (vault at C:\Users\stack\vault\projects\g-tee-oh, added with /add-dir)
1. planning/phases/phase-3-preflop-trainer.md
2. planning/09-v1-sprint-roadmap.md sections 3, 5 (the S25 row), 6 (Phase 3) and 7
3. planning/00-open-questions-and-risks.md, answered questions O-17 to O-67; this session leans on O-22, O-23, O-26, O-53 and O-62
4. planning/05-training-and-grading.md sections 2, 5, 6, 7, 9 and 11
5. planning/architecture/A7-web-app.md (whole; flows 3 and 4 in section 5); A5-services-and-interfaces.md sections 2 and 3; A6-trainer-and-learning-engine.md section 2
6. decisions/_README.md, then ADRs 0008, 0009, 0016, 0018 and 0020
7. In the repo: CLAUDE.md, docs/ (mirrored files), web/ (S24), services/api/ routes (S23), packages/learning/ (S22), packages/contracts/

Rules
- Clone C:\Users\stack\projects\g-tee-oh, Claude Code in PowerShell; WSL2 (Windows Subsystem for Linux 2) only for Linux container builds and benchmarks (O-23). The private capture repo C:\Users\stack\projects\g-tee-oh-capture is not touched by this session (O-28).
- Branch p3/web-study-trainer off sprint/1-v1; merge by pull request into sprint/1-v1; sprint/1-v1 merges into main only in S35 (R4.18).
- Gates in order: plan first (enter plan mode, write the plan, wait for my approval; trivial one-liners exempt); break down into a concrete task list; implement the smallest working increment; tests pass (never advance on red; write the suite if none exists); run /code-review and fix CRITICAL and HIGH findings; run /security-review for anything touching auth, user input, secrets or endpoints; commit with conventional commits (feat:, fix:, chore:, refactor:, docs:, test:, perf:, ci:) and end every commit message with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Test-driven: red test first, tagged with its R ID, then green, then refactor; 80 percent coverage or better on new code.
- Visual testing happens on local ports with my screenshots. Nothing deploys to the Mac without my explicit yes at that moment (O-20). A step runs as a dynamic workflow only where this prompt says so in my words; keep every workflow under 10 agents and name what its verifier runs.
- Accepted ADRs are fixed; if a step would contradict one, stop and raise it. Cite O-IDs and ADR numbers in code comments, commit bodies and docs wherever an answer is used. A new question goes to planning/00 as a proposed O-ID with a default under a new dated subsection.
- Privacy (O-26, ADR 0017): nothing GTO Wizard-specific enters the repo; the fixture library is the only data on screen in tests, and the synthetic sets show their synthetic banner (O-57).
- Report honestly at every gate: if tests fail, say so and show the output; if a step was skipped, say which.
- Docs you write: no em dashes, no bold, acronyms expanded on first use, the mechanism before the conclusion.

Inputs
- web/ foundation and components (S24); api study, session, decision and insights routes (S23); the grading policy labels and band mapping (S22); the fixture library through the compose dev stack (S19, O-62)
- The trainer in spot mode runs on the /drills/:id/run route from a drill row created through the S21 CRUD endpoints (create, read, update, delete) as a fixture, because the drill builder screen lands in S26 and automated training (/train) is Phase 4
- 05 section 5 decision flow: panels, commit an action and size, confidence tap before any reveal, reveal (label, EV loss, where EV is expected value, in big blinds (bb) and percent pot, the hand's frequencies, the range view, the threshold card), then More info and Ask as buttons that S27 wires
- 05 section 7 and ADR 0009: the roller shows the roll and the cumulative bands; the explainer appears on first use and from the icon and covers why randomize, how the roll works with the band example, and why it is optional

Requirements this session closes
- R3.9 buttons from the node's tree actions (ADR 0020): Grouped shows the bucket label with the size underneath, except at preflop nodes where the exact size is shown (O-22); Standard shows the exact size; a bucket missing from the tree has no button. Proof: ActionBar component test, with a preflop node in Grouped mode showing the exact size.
- R3.10, roller and explainer part: RngRoller with bands, the roll-selected action labeled Best, the explainer on first use and from the icon. Proof: explainer snapshot; flow 4.
- R3.11, tap part: ConfidenceTap before any reveal, with sure or unsure stored on the decision. Proof: a test that no reveal happens before the tap; the stat and queue rule are S22's.
- R3.12, screen part: /study with the 13 by 13 matrix in frequency, EV and range-weight modes, the actions table, the threshold card, filters (config, stake, depth, pair, line) and prefetch of the next likely node. Proof: component tests; flow 3; node switch time logged to the console or a metrics hook for the latency report.
- R3.13, spot part: the trainer screen wired to sessions, next, decisions and end, with hotkeys. Proof: flow 4; client state tests for the spot-mode transitions.

Steps
1. (single) Plan: enter plan mode, read the files above, write the plan with its task list, wait for my approval.
2. Use a dynamic workflow for this step, under 5 agents: one for the study screen (route, filters, matrix modes, actions table, threshold card, prefetch, node switch timing); one for the trainer screen (session start from a fixture drill, next, decision submit with size and confidence, end, hotkeys, the client state for spot mode); one for the RNG and feedback components (RngRoller, the explainer, FeedbackPanel wired to the feedback payload, ActionBar labels per grouping mode with the preflop rule); the flows 3 and 4 join them. Every agent writes its red tests tagged with the R ID first. The verifier agent runs flows 3 and 4 against the compose dev stack on a local port, saves screenshots of the study browser in each matrix mode, the trainer before and after a decision, the roller and the explainer, and hands them to me.
3. (single) Wait for my comments on the screenshots; fix what I flag; rerun flows 3 and 4.
4. (single) Run /code-review and fix CRITICAL and HIGH findings; run /security-review (decision submissions are user input) and fix its findings; confirm coverage on web/ new code is 80 percent or better.
5. (single) Open the pull request into sprint/1-v1 listing R3.9, R3.10, R3.11, R3.12 and R3.13.

Definition of done
- [ ] Flows 3 and 4 green locally against the fixture library
- [ ] ActionBar test, explainer snapshot, tap-before-reveal test and the study component tests green, each tagged with its R ID
- [ ] Node switch time logged; the matrix still under 16 ms per frame
- [ ] Screenshots from a local port reviewed by me and my comments addressed
- [ ] Coverage 80 percent or better; /code-review done; /security-review done
- [ ] Pull request opened into sprint/1-v1 with the R IDs listed; the private-data guard passes

Report back
Your final message lists: each R ID (R3.9, R3.10 roller part, R3.11 tap part, R3.12 screen part, R3.13 spot part) with its test command and result; the node switch times observed; the branch and the pull request link; the files written and the screenshot paths; usage notes (units used against the planned high level); any new question as a proposed O-ID with a default, appended to planning/00 under a new dated subsection.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| `/study` screen, the trainer screen in spot mode, `RngRoller`, explainer, `FeedbackPanel`, `ActionBar` labels, hotkeys | Repo, branch `p3/web-study-trainer`, under `web/` |
| Playwright flows 3 and 4; component and client state tests tagged R3.9 to R3.13 | Repo, `web/` tests |
| Screenshots of the study browser and trainer from a local port | Handed to the owner; paths listed in the report |
| Pull request into `sprint/1-v1` | GitHub |
| New O-IDs, if any | `planning/00-open-questions-and-risks.md` in the vault |
