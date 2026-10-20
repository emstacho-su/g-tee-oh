---
id: 'g-tee-oh-handoff-s27-insights-explanations'
title: 'S27 insights and explanations'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 3
session: 'S27'
branch: 'p3/insights-explanations'
tags: [g-tee-oh, handoff, phase-3]
---
# S27 insights and explanations (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-3-preflop-trainer|Phase 3 Preflop trainer]]. This session produces four features over one insights contract: prediction drills, range painting, the insight cards (threshold, noise flags, range drift), and the two explanation paths, More info templates and the Ask path with its validator, cache and monthly cap, tested with a mocked model (O-54). Branch `p3/insights-explanations`, parallel group E, earliest day 7, paced for week 4 (days 22 to 28, 2026-11-10 to 2026-11-16; 09 sections 4 and 5). It runs as a dynamic workflow. Public. Usage: high. R IDs are requirement identifiers; O-IDs are the answered questions in [[projects/g-tee-oh/planning/00-open-questions-and-risks|00 Open questions and risks]].

## Before pasting

- [ ] S23 merged into `sprint/1-v1`: sessions, attempts and the insights proxy endpoints.
- [ ] S25 merged: the `FeedbackPanel` with its More info and Ask buttons as shells.
- [ ] S16 merged: `solver-query` `/v1/insights` (R2.14) with the 169 by 169 equity table (O-32).
- [ ] No model key is needed; CI (continuous integration) and the session run the Ask path against a mocked model (O-54). If you want a live check at the end, have a key ready, but it is optional for the v1 gate.
- [ ] The compose `dev` stack on the Zenbook with `FIXTURE_LIBRARY_PATH` set (O-62); Docker in Windows Subsystem for Linux 2 (WSL2) up (O-23).

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull
git switch -c p3/insights-explanations
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault and append O-IDs to planning/00.
2. Stay in the default permission mode, so you approve the workflow when it launches.
3. Paste the prompt below.

## The prompt

```text
Role and context
You are running session S27 of sprint 1 of g-tee-oh, Phase 3 (Preflop trainer), on branch p3/insights-explanations off the sprint branch sprint/1-v1. Goal: prediction drills, range painting, insight cards, More info templates, and the Ask path with its validator, cache, monthly cap and a mocked model. You close R3.16, R3.17, R3.18, R3.19 and R3.20.

Reading order (vault at C:\Users\stack\vault\projects\g-tee-oh, added with /add-dir)
1. planning/phases/phase-3-preflop-trainer.md
2. planning/09-v1-sprint-roadmap.md sections 3, 5 (the S27 row), 6 (Phase 3) and 7
3. planning/00-open-questions-and-risks.md, answered questions O-17 to O-67; this session leans on O-5, O-26, O-32, O-53, O-54 and O-62
4. planning/05-training-and-grading.md sections 8, 9 and 10; planning/01-product-spec.md section 4 items 6, 7 and 8, and section 6 criterion 9
5. planning/architecture/A6-trainer-and-learning-engine.md sections 1, 5 and 6; A5-services-and-interfaces.md sections 2, 3 and 5; A4-data-model.md (explanation, llm_spend, attempt.rated, practice_mode); A7-web-app.md sections 2 and 3; A9-quality-security-ops.md section 3
6. decisions/_README.md, then ADRs 0004, 0008, 0016 and 0018
7. In the repo: CLAUDE.md, docs/ (mirrored files), services/api/ (S21, S23), web/ (S24, S25), packages/contracts/solver-query.openapi.json (S16)

Rules
- Clone C:\Users\stack\projects\g-tee-oh, Claude Code in PowerShell; WSL2 (Windows Subsystem for Linux 2) only for Linux container builds and benchmarks (O-23). The private capture repo C:\Users\stack\projects\g-tee-oh-capture is not touched by this session (O-28).
- Branch p3/insights-explanations off sprint/1-v1; merge by pull request into sprint/1-v1; sprint/1-v1 merges into main only in S35 (R4.18).
- Gates in order: plan first (enter plan mode, write the plan, wait for my approval; trivial one-liners exempt); break down into a concrete task list; implement the smallest working increment; tests pass (never advance on red; write the suite if none exists); run /code-review and fix CRITICAL and HIGH findings; run /security-review for anything touching auth, user input, secrets or endpoints; commit with conventional commits (feat:, fix:, chore:, refactor:, docs:, test:, perf:, ci:) and end every commit message with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Test-driven: red test first, tagged with its R ID, then green, then refactor; 80 percent coverage or better on new code.
- Visual testing happens on local ports with my screenshots. Nothing deploys to the Mac without my explicit yes at that moment (O-20). A step runs as a dynamic workflow only where this prompt says so in my words; keep every workflow under 10 agents and name what its verifier runs.
- Accepted ADRs are fixed; if a step would contradict one, stop and raise it. Cite O-IDs and ADR numbers in code comments, commit bodies and docs wherever an answer is used. A new question goes to planning/00 as a proposed O-ID with a default under a new dated subsection.
- Privacy (O-26, ADR 0017): nothing GTO Wizard-specific enters the repo. The model key lives in .env only and never reaches the browser (A9 section 3); no key is committed.
- Report honestly at every gate: if tests fail, say so and show the output; if a step was skipped, say which.
- Docs you write: no em dashes, no bold, acronyms expanded on first use, the mechanism before the conclusion.

Inputs
- solver-query /v1/insights fields (threshold_card, equity_distribution, range_advantage, nut_advantage, blockers, hand_role) and /v1/grade fields (ev_by_action, freq_by_action, noise_flags); attempts and sessions from S23; FeedbackPanel shells from S25
- 05 section 8: prediction levels (range-level, nearest 5 percent, which regions mix; hand-level action, frequency band, size bucket), the next level after 90 percent accuracy per spot class, unrated; range painting graded by reach-weighted EV (expected value) loss summed over hands, unrated
- 05 section 9: threshold card, noise flags (close mixes under the floor, suit-level mixing, lines with reach under 0.5 percent), range drift per node family shown only after 30 decisions, never graded
- 05 section 10 and A6 section 5: More info templates (facts, range and nut advantage, hand role, position and equity realization preflop, blockers); the Ask path with grounding JSON, a validator that checks every number and card name against the grounding within rounding, one regeneration then a warning, cache by solution, node, hand and question hash in the explanation table, llm_spend charged, the button disabled above the $15 monthly cap (O-5); a feature flag that is off until a key is configured; the model mocked in CI (O-54). For the real client call, use the claude-api skill when the session lists it rather than writing the software development kit (SDK) usage from memory

Requirements this session closes
- R3.16 prediction drills at increasing precision, next level after 90 percent, unrated. Proof: unit tests on the level unlock; a test that no rating or attempt.rated side effect occurs (practice_mode prediction).
- R3.17 range painting graded by reach-weighted EV loss summed over hands, unrated. Proof: on a fixture node, a near-indifferent hand painted wrong costs little and a clear fold painted as a raise costs a lot; the total equals the solver-query sum.
- R3.18 insight cards. Proof: a noise-flagged attempt is rated = false; drift is hidden below 30 decisions per node family; drift changes no score.
- R3.19 More info templates render only numbers present in the node data. Proof: a template test that extracts every number from the output and finds it in the node or insights JSON; a snapshot per template.
- R3.20 Ask path. Proof: the validator rejects a planted unsupported number and passes supported ones; above the cap the button is disabled; a cache hit spends nothing; with the flag off the endpoint returns a problem response; all with the mocked model.

Steps
1. (single) Plan: enter plan mode, read the files above, write the plan with its task list, wait for my approval.
2. Use a dynamic workflow for this step, under 6 agents, all over the one insights contract: one for prediction drills (endpoints, PredictionPrompt on /predict, levels and unlock); one for range painting (RangePainter on /paint, submit endpoint, the reach-weighted grade from solver-query numbers); one for insight cards (ThresholdCard and noise flags in the feedback panel, the drift aggregation in api over attempts against solver frequencies, hidden below 30); one for explanations (the template renderer, the Ask endpoint with flag, grounding, validator, regeneration, cache, cap, and the mocked model in tests). Every agent writes its red tests tagged with the R ID first. The verifier agent runs the template number-membership test and the planted-number validator test, and reports any red test verbatim.
3. (single) Run the four screens on a local port, take screenshots of a prediction prompt, a painted range with its grade, a feedback panel with cards and More info open, and the Ask button in its disabled and flag-off states, and hand them to me. Do not block on my comments; the S29 visual pass covers any screen I have not reviewed by then (O-67).
4. (single) Run /code-review and fix CRITICAL and HIGH findings; run /security-review (the external model call, the key, prompt content built from user data, the cap) and fix its findings; confirm coverage on new code is 80 percent or better.
5. (single) Open the pull request into sprint/1-v1 listing R3.16 to R3.20.

Definition of done
- [ ] Level unlock, painting, noise flag, drift and side-effect tests green, each tagged with its R ID
- [ ] Template number-membership test and snapshots green; validator planted-number test green; cap, cache and flag-off tests green with the mocked model
- [ ] No key in the repo; the flag defaults to off; the browser never receives the key
- [ ] Screenshots saved and handed to me (my review may wait until S29); coverage 80 percent or better; /code-review done; /security-review done
- [ ] Pull request opened into sprint/1-v1 with the R IDs listed; the private-data guard passes

Report back
Your final message lists: each R ID (R3.16 to R3.20) with its test command and result; the branch and the pull request link; the files written and the screenshot paths; whether a live model call was tried and its validator outcome, if a key was available; usage notes (units used against the planned high level); any new question as a proposed O-ID with a default, appended to planning/00 under a new dated subsection.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| `/predict` and `/paint` screens, `PredictionPrompt`, `RangePainter`, cards in `FeedbackPanel`, More info view, Ask button states | Repo, branch `p3/insights-explanations`, under `web/` |
| Prediction, range painting, drift, explanation and Ask endpoints with the feature flag, validator, cache and cap | Repo, `services/api/` |
| Mocked model client for tests | Repo, `services/api/` tests |
| Tests tagged R3.16 to R3.20, including the number-membership and planted-number tests | Repo |
| Screenshots of the four screens | Handed to the owner |
| Pull request into `sprint/1-v1` | GitHub |
| New O-IDs, if any | `planning/00-open-questions-and-risks.md` in the vault |
