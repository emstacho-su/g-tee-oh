---
id: 'g-tee-oh-handoff-s31-api-learning'
title: 'S31 api learning'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 4
session: 'S31'
branch: 'p4/api-learning'
tags: [g-tee-oh, handoff, phase-4]
---
# S31 api learning (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-4-rating-and-release|Phase 4 Rating, scheduling, progress, Deploy 2 and the v1 gate]]. This session produces the `api` learning integration: the seven v1 tracks seeded, automated training end to end, the learning state writes in one transaction each, the holdout set with its monthly retest job, streaks and cosmetic unlocks, and the six progress endpoints with their aggregation tests. It closes R4.10, R4.11, R4.13 and R4.14 and builds the endpoint half of R4.12 (the screen and flow 6 close it in S32). Branch `p4/api-learning` off `sprint/1-v1`; parallel group E, earliest day 6 (2026-10-25), paced for week 4 (09 sections 4 and 5); runs as a dynamic workflow; public; high usage (3 units). Decisions are cited as ADR nnnn (architecture decision record); answered questions by O-ID from [[projects/g-tee-oh/planning/00-open-questions-and-risks|00 Open questions and risks]].

## Before pasting

- [ ] S30 merged into `sprint/1-v1`: the learning core (R4.1 to R4.9).
- [ ] S23 merged: the session state machine, grading orchestration and server-sent events (SSE) (R3.3 to R3.7). Through it, S21 (Fastify skeleton, auth, catalog, drill endpoints), S22 (grading policy), S16 (the `solver-query` contract and client) and S19 (the fixture library, O-30) are already in (09 section 3).
- [ ] The continuous integration (CI) `e2e` job runs the real `solver-query` over `FIXTURE_LIBRARY_PATH` (O-53, O-62), and the Postgres test container runs locally in Windows Subsystem for Linux 2 (WSL2) (O-23).
- [ ] Machine: the Zenbook, clone `C:\Users\stack\projects\g-tee-oh`, PowerShell. No owner inputs, credentials or drives are needed.

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull --ff-only
git switch -c p4/api-learning
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault and append O-IDs to `planning/00-open-questions-and-risks.md`.
2. Stay in the default permission mode, so you approve the workflow run when it launches.
3. Paste the prompt below.

## The prompt

```text
You are running session S31 of sprint 1 of g-tee-oh, Phase 4 (rating, scheduling, progress, Deploy 2 and the v1 gate), on branch p4/api-learning off the sprint branch sprint/1-v1. Goal: the api learning integration, closing R4.10, R4.11, R4.13 and R4.14 and building the progress endpoints for R4.12.

Reading order (vault root C:\Users\stack\vault\projects\g-tee-oh, added with /add-dir; paths are relative to it):
1. planning/phases/phase-4-rating-and-release.md
2. planning/09-v1-sprint-roadmap.md sections 3, 5 (row S31), 6 (Phase 4) and 7
3. planning/00-open-questions-and-risks.md, answered questions O-17 to O-67; O-27, O-28, O-38, O-53, O-56 and O-62 bind this session
4. planning/06-rating-and-progress.md sections 2 to 9; planning/05-training-and-grading.md section 6
5. planning/architecture/A6-trainer-and-learning-engine.md sections 1 to 4; A4-data-model.md (learning state tables and roles); A5-services-and-interfaces.md section 3 (training and progress endpoints); A9-quality-security-ops.md sections 1 and 3; A1-repo-and-conventions.md sections 3 and 4
6. decisions/0011-one-overall-rank-with-per-track.md, 0012-fsrs-scheduling-and-bkt-mastery-no.md, 0013-spot-frequency-prior-is-equilibrium-reach.md, 0018-library-first-serving-the-user-never.md, 0005-postgres-plus-an-s3-compatible-object.md, 0001-personal-self-hosted-portfolio-grade-multi.md
7. The repo's CLAUDE.md and any docs/ mirrored files; services/api as S23 left it; packages/learning as S30 left it; packages/contracts/api.openapi.json

Rules:
- Zenbook clone C:\Users\stack\projects\g-tee-oh, Claude Code in PowerShell; WSL2 only for the Postgres test container and the compose dev stack (O-23). The private capture repo is not touched.
- Branch p4/api-learning; merge by pull request into sprint/1-v1; sprint/1-v1 merges into main only in S35 (R4.18).
- Gates in order: plan first in plan mode and wait for the owner's approval; a concrete task list; the smallest working increment; tests green before advancing, never on red; /code-review and fix CRITICAL and HIGH; /security-review, because this session adds endpoints that take user input; conventional commits (feat:, fix:, chore:, refactor:, docs:, test:, perf:, ci:), each ending with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Test-driven: red test tagged with its R ID, then green, then refactor; 80 percent coverage or better on new code. Integration tests run in the Postgres test container against the real solver-query over the fixture library (A9 section 1, O-53).
- Contract first: the new endpoints go into packages/contracts/api.openapi.json as the first commit and the client is regenerated, so S32 can start against it (A1 section 3, the O-38 pattern); the contracts job must show no diff.
- Learning math is called from packages/learning and never reimplemented in api (A6 section 1); poker numbers come from solver-query (ADR 0004). The api runs under the app role (A4 section 3); the query role is solver-query's (O-28).
- Accepted ADRs are fixed; cite O-IDs where an answer sets a value; anything open becomes a proposed O-ID with a default appended to planning/00 under a new dated subsection, never decided silently.
- Privacy (O-26): fixtures are synthetic or from the public fixture library; never copy numbers from the reference library into the repo.
- A step runs as a dynamic workflow only where this prompt says so, under 10 agents, with the verifier named. Report honestly at every gate.

Inputs:
- packages/learning (S30): rating, difficulty, rank, anti-farming, Free Spaced Repetition Scheduler (FSRS) adapter, Bayesian Knowledge Tracing (BKT), leak cost, queue selection.
- The session state machine, grading orchestration and POST /sessions, GET /sessions/{id}/next, POST /sessions/{id}/decisions, POST /sessions/{id}/end (S23, R3.6, R3.7); coverage requests (R3.4).
- The A4 tables track, rating, rating_history, schedule_card, mastery, leak_stat, leak_history, holdout_item, holdout_result, streak_day, cosmetic_unlock (migrated in S02).
- The seven v1 tracks from 06 section 2; the fixture attempt set from S22 (R3.11) to extend for the aggregation tests.

Requirements this session closes (test in parentheses):
- R4.10 automated training end to end in api: due cards, class pick, deal, grade, rating at session end, FSRS and BKT per review block, a coverage request for an uncovered class (integration test on the fixture library; end-to-end flow 1 lands with S32's screens and runs in CI at S33).
- R4.11 the seven v1 tracks seeded; rating and rating_history written at session end, schedule_card and mastery at the end of each review block, leak_stat per decision and leak_history weekly, each update in one transaction (O-27) (integration test in the Postgres container).
- R4.13 a holdout set of 30 items per track never served in training; a monthly unrated retest job; the Goodhart flag when the rating rises while holdout stays flat (property over 1,000 deals that no holdout item is served; retest attempts unrated; flag rule unit test).
- R4.14 streaks (five rated decisions per day, two freezes per week, 48-hour repair) and cosmetic unlocks (unit tests on day counting, freezes, the repair window and unlocks).
- R4.12, endpoint half: GET /progress/rating, /progress/tracks, /progress/leaks?weeks, /progress/heatmap, /progress/holdout, /progress/streak (A5 section 3) with aggregation unit tests on fixture attempts; the screen and flow 6 close R4.12 in S32.

Steps:
1. (single) Plan mode: read; confirm the S30 surface and the S23 session machine; write the OpenAPI additions (automated mode fields on sessions, the six progress endpoints) and commit them first with the regenerated client; wait for approval; write the task list.
2. (dynamic workflow, under 5 agents: an automated-loop agent for R4.10; a learning-state agent for R4.11; a holdout, streaks and progress agent for R4.13, R4.14 and the R4.12 endpoints; the verifier agent runs the R4.10 and R4.11 integration tests in the Postgres container against the fixture solver-query and the R4.13 holdout property over 1,000 deals) Use a dynamic workflow for this step, under 5 agents. The lanes:
   - Automated loop: POST /sessions in automated mode; GET /sessions/{id}/next picks the class through packages/learning queue selection over due schedule_card and leak_stat rows, deals through solver-query /v1/deal, skips an uncovered class and files a coverage request (ADR 0018), runs the first exposure of a class with panels visible and unrated; decisions pass through the S23 grading orchestration; POST /sessions/{id}/end closes the one Glicko-2 rating period and returns the recap.
   - Learning state: seed the seven tracks by migration or the seed mechanism S02 established; the writes named in R4.11, each in one transaction; the weekly leak_history job on the Postgres job queue (ADR 0005).
   - Holdout, streaks, progress: holdout_item rows, 30 per track, drawn once and never served (selection rule open, see problems list); the monthly unrated retest job; the Goodhart flag; streak_day counting, freezes, repair and cosmetic_unlock; the six progress endpoints with cursor pagination and Request for Comments (RFC) 9457 errors (A5 section 3).
3. (single) Integrate: contracts job green with no diff; full api suite green; /code-review and /security-review with CRITICAL and HIGH fixed; commit; open the pull request into sprint/1-v1 listing the R IDs.

Definition of done:
- [ ] R4.10, R4.11, R4.13 and R4.14 tests green and tagged; the R4.12 aggregation tests green; coverage 80 percent or better on new code.
- [ ] The contracts, ts and e2e jobs green on the branch; the committed OpenAPI file and client match the handlers.
- [ ] /code-review and /security-review done, CRITICAL and HIGH fixed.
- [ ] Pull request opened into sprint/1-v1 with the R IDs and O-IDs.
- [ ] New questions appended to planning/00 as proposed O-IDs with defaults.

Report back, in the final message: each R ID with the test command and its result; the branch and pull request link; the files written; no gate artifact (S33 records the Phase 4 gate); usage in units against the planned high (3); any new question as a proposed O-ID with a default, appended to planning/00 under a new dated subsection.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| OpenAPI additions and the regenerated client, committed first | `packages/contracts/api.openapi.json` and the generated client on `p4/api-learning` |
| Automated mode in the session endpoints; the six progress endpoints; the weekly and monthly jobs | `services/api` |
| Track seed and any migration the holdout set needs | `db/migrations/` |
| Integration tests (R4.10, R4.11), the holdout property (R4.13), streak and aggregation unit tests (R4.14, R4.12) | `services/api` tests |
| Pull request into `sprint/1-v1` | GitHub |
| Proposed O-IDs, if any | vault `planning/00-open-questions-and-risks.md` |
