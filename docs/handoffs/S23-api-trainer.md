---
id: 'g-tee-oh-handoff-s23-api-trainer'
title: 'S23 api trainer'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 3
session: 'S23'
branch: 'p3/api-trainer'
tags: [g-tee-oh, handoff, phase-3]
---
# S23 api trainer (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-3-preflop-trainer|Phase 3 Preflop trainer]]. This session produces the trainer side of `api`: the study, coverage and admin endpoints, the persisted session state machine, the grading orchestration that joins `solver-query`, the learning policy and the attempt row in one transaction, server-sent events (SSE), and the `just perf` timing target. Every endpoint is tested against the fixture `solver-query`, which is the real binary over the fixture library (O-53). Branch `p3/api-trainer`, parallel group D, earliest day 5, paced for week 3 (days 15 to 21, 2026-11-03 to 2026-11-09; 09 sections 4 and 5). It runs as a dynamic workflow. Public. Usage: high. R IDs are requirement identifiers; O-IDs are the answered questions in [[projects/g-tee-oh/planning/00-open-questions-and-risks|00 Open questions and risks]].

## Before pasting

- [ ] S21 merged into `sprint/1-v1`: the Fastify foundation, auth and the committed `api` contract.
- [ ] S22 merged: the grading policy in `packages/learning`.
- [ ] S16 merged: the `solver-query` binary, its OpenAPI contract and TypeScript client (the committed contract alone lifts the block a day early, O-38, but the integration tests need the binary).
- [ ] S19 merged: the fixture library (the G6a push/fold solution and the synthetic sets, O-30, O-57).
- [ ] S02 and S06 merged (migrations, roles, contracts pipeline, the `FIXTURE_LIBRARY_PATH` variable on the `dev` profile, O-62).
- [ ] The Zenbook clone at `C:\Users\stack\projects\g-tee-oh`; Docker in Windows Subsystem for Linux 2 (WSL2) running for the compose `dev` stack (O-23).

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull
git switch -c p3/api-trainer
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault and append O-IDs to planning/00.
2. Stay in the default permission mode, so you approve the workflow when it launches.
3. Paste the prompt below.

## The prompt

```text
Role and context
You are running session S23 of sprint 1 of g-tee-oh, Phase 3 (Preflop trainer), on branch p3/api-trainer off the sprint branch sprint/1-v1. Goal: the study, coverage and admin endpoints, the persisted session state machine, the grading orchestration and SSE (server-sent events) in api, each tested against the fixture solver-query (O-53), plus the just perf timing target. You close R3.3 (endpoints and just perf), R3.6 and R3.7 (orchestration), and the endpoint parts of R3.4 and R3.5.

Reading order (vault at C:\Users\stack\vault\projects\g-tee-oh, added with /add-dir)
1. planning/phases/phase-3-preflop-trainer.md
2. planning/09-v1-sprint-roadmap.md sections 3, 5 (the S23 row), 6 (Phase 3) and 7
3. planning/00-open-questions-and-risks.md, answered questions O-17 to O-67; this session leans on O-21, O-22, O-28, O-36, O-38, O-40, O-53, O-60 and O-62
4. planning/05-training-and-grading.md sections 1 to 3, 5 and 6; planning/01-product-spec.md section 4 item 11
5. planning/architecture/A4-data-model.md (practice_session, attempt, build_job, builder_setting, roles, events); A5-services-and-interfaces.md sections 2 to 4; A6-trainer-and-learning-engine.md sections 1 to 4; A9-quality-security-ops.md sections 1, 4 and 6
6. decisions/_README.md, then ADRs 0004, 0008, 0009, 0010, 0018 and 0020
7. In the repo: CLAUDE.md, docs/ (mirrored files), services/api/ (S21), packages/learning/ (S22), packages/contracts/solver-query.openapi.json and its client (S16), validation/fixtures/ (S19)

Rules
- Clone C:\Users\stack\projects\g-tee-oh, Claude Code in PowerShell, native Windows Rust toolchain; WSL2 (Windows Subsystem for Linux 2) only for Linux container builds and benchmarks (O-23). The private capture repo C:\Users\stack\projects\g-tee-oh-capture is not touched by this session (O-28).
- Branch p3/api-trainer off sprint/1-v1; merge by pull request into sprint/1-v1; sprint/1-v1 merges into main only in S35 (R4.18).
- Gates in order: plan first (enter plan mode, write the plan, wait for my approval; trivial one-liners exempt); break down into a concrete task list; implement the smallest working increment; tests pass (never advance on red; write the suite if none exists); run /code-review and fix CRITICAL and HIGH findings; run /security-review for anything touching auth, user input, secrets or endpoints; commit with conventional commits (feat:, fix:, chore:, refactor:, docs:, test:, perf:, ci:) and end every commit message with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Test-driven: red test first, tagged with its R ID, then green, then refactor; 80 percent coverage or better on new code.
- Nothing deploys to the Mac without my explicit yes at that moment (O-20). A step runs as a dynamic workflow only where this prompt says so in my words; keep every workflow under 10 agents and name what its verifier runs.
- Accepted ADRs are fixed (0004 and 0013 count as Accepted, O-25); if a step would contradict one, stop and raise it. Cite O-IDs and ADR numbers in code comments, commit bodies and docs wherever an answer is used. A new question goes to planning/00 as a proposed O-ID with a default under a new dated subsection.
- Privacy (O-26, ADR 0017): nothing GTO Wizard-specific enters the repo; the fixture library is the only data this session reads.
- Report honestly at every gate: if tests fail, say so and show the output; if a step was skipped, say which.
- Docs you write: no em dashes, no bold, acronyms expanded on first use, the mechanism before the conclusion.

Inputs
- services/api with auth, the catalog and the committed contract (S21); packages/learning grading policy (S22); the solver-query client and binary (S16); the fixture library reached through FIXTURE_LIBRARY_PATH on the dev profile (S19, O-62)
- A6 section 2 state machine (Dealing, OpponentActs, AwaitHero, Feedback, StreetEnd, Reveal, HandEnd) persisted in practice_session.state with state_version; opponent actions from POST /v1/sample-action with the seeded RNG (random number generator) state carried in the session
- A4 attempt row (ev_chosen_bb, ev_best_bb, ev_loss_bb, ev_loss_pct_pot, floor_pct_pot, score, label, reference_strategy = equilibrium, rng_roll, confidence, rated, weight, noise_flags) and the LISTEN/NOTIFY channels coverage_added, build_progress, builder_state
- The O-40 thresholds for the Zenbook guard: 300 ms study node read, 60 ms grade, 500 ms decision to feedback at p95 (95th percentile latency)

Requirements this session closes
- R3.3 study endpoints over solver-query: /study/node, /study/insights, the next likely node prefetched. Proof: integration test with the fixture solver-query; the just perf target (new in this session) times the three O-40 paths on the Zenbook and writes a JSON report under validation/reports/; S29 runs it as the gate.
- R3.4, endpoint part: /coverage, POST /coverage/requests raising a build_job priority, SSE coverage_added on GET /events. Proof: the request-path test, which shows a gap request raises priority, creates no solution row, and the builder process is never invoked; the /library screen and flow 5 land in S28.
- R3.5, endpoint part: GET /admin/builder (queue, throughput, storage, settings), PATCH /admin/builder/settings, pause and resume. Proof: integration tests, a settings PATCH round trip, pause then resume. A4 section 3 gives the app role no access to builder internals, so these writes need a grant (open, see problems list in the phase doc's R3.5 row): propose the narrowest grant as an O-ID with a default, apply it by migration, and stop if it would contradict an ADR.
- R3.6 session state machine persisted with state_version; spot, street and full hand ending at the flop in v1; identical replay from a seed. Proof: transition table test over every A6 section 2 edge; replay-from-seed golden.
- R3.7 grading orchestration: solver-query grade, the learning policy, the attempt row and the feedback payload in one transaction, the feedback rendered from the attempt row so S29's tools/validate recompute (O-60) can compare both. Proof here: the transaction test and the Idempotency-Key double-submit test on POST /sessions/{id}/decisions (graded once); the 200-attempt recomputation report is S29's.

Steps
1. (single) Plan: enter plan mode, read the files above, write the plan with its task list, wait for my approval.
2. (single) Bring up the compose dev stack with FIXTURE_LIBRARY_PATH set so solver-query serves the fixture library; confirm /healthz on api and solver-query; regenerate the solver-query client and confirm the contracts job is clean.
3. Use a dynamic workflow for this step, under 6 agents: one for study and coverage (study node and insights with prefetch, coverage, coverage requests, the priority bump); one for the session state machine and grading orchestration (sessions, next, decisions, end, the one-transaction grade, the seeded opponent RNG); one for admin and SSE (admin endpoints, the grant migration, GET /events relaying coverage_added and builder_state); one for the just perf target and the latency integration test against the fixture solver-query; every agent writes its red tests tagged with the R ID first. The verifier agent runs the replay-from-seed golden and the request-path test, and reports any red test verbatim.
4. (single) Run /code-review and fix CRITICAL and HIGH findings; run /security-review (session endpoints take user input; admin endpoints change builder state) and fix its findings; confirm coverage on services/api new code is 80 percent or better.
5. (single) Open the pull request into sprint/1-v1 listing R3.3, R3.4, R3.5, R3.6 and R3.7.

Definition of done
- [ ] Study, coverage, admin and session endpoints green against the fixture solver-query; the contracts job clean
- [ ] Transition table test and replay-from-seed golden green; request-path test green; double-submit graded once
- [ ] just perf runs on the Zenbook and writes its JSON report; the three numbers are in the report-back message
- [ ] Every test tagged with its R ID; coverage 80 percent or better; /code-review done; /security-review done
- [ ] Pull request opened into sprint/1-v1 with the R IDs listed; the private-data guard passes

Report back
Your final message lists: each R ID (R3.3, R3.4 endpoint part, R3.5 endpoint part, R3.6, R3.7) with its test command and result; the three just perf p95 numbers against the O-40 thresholds; the branch and the pull request link; the files written; usage notes (units used against the planned high level); any new question (the admin grant, the perf report file name) as a proposed O-ID with a default, appended to planning/00 under a new dated subsection.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| `services/api/` study, coverage, admin, sessions, decisions, SSE routes and the grading orchestration | Repo, branch `p3/api-trainer` |
| A migration granting the `app` role what the admin endpoints need (open, proposed as an O-ID) | Repo, `db/migrations/` |
| `just perf` target and its first JSON report | Repo, `justfile` and `validation/reports/` |
| Transition table test, replay-from-seed golden, request-path test, integration tests tagged R3.3 to R3.7 | Repo, `services/api/` tests |
| Pull request into `sprint/1-v1` | GitHub |
| New O-IDs (admin grant, perf report name, anything else) | `planning/00-open-questions-and-risks.md` in the vault |
