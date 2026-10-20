---
id: 'g-tee-oh-handoff-s28-coverage-admin'
title: 'S28 coverage and admin'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 3
session: 'S28'
branch: 'p3/coverage-admin'
tags: [g-tee-oh, handoff, phase-3]
---
# S28 coverage and admin (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-3-preflop-trainer|Phase 3 Preflop trainer]]. This session produces two screens over endpoints S23 already built: the coverage view with gap requests on `/library`, and the admin builder screen with queue, throughput, storage, settings, pause and resume, plus end-to-end flow 5. It makes library-first serving visible as a product feature (ADR 0018, O-36). Branch `p3/coverage-admin`, parallel group E, earliest day 6, paced for week 4 (days 22 to 28, 2026-11-10 to 2026-11-16; 09 sections 4 and 5). It runs as a single session. Public. Usage: medium. If usage runs short, 09 section 4 folds this session into S25. R IDs are requirement identifiers; O-IDs are the answered questions in [[projects/g-tee-oh/planning/00-open-questions-and-risks|00 Open questions and risks]].

## Before pasting

- [ ] S23 merged into `sprint/1-v1`: `/coverage`, `/coverage/requests`, the admin endpoints and the server-sent events (SSE) relay.
- [ ] S24 merged: the web foundation with `CoverageGrid` and `BuilderHealth` shells.
- [ ] The compose `dev` stack on the Zenbook with `FIXTURE_LIBRARY_PATH` set (O-62); Docker in Windows Subsystem for Linux 2 (WSL2) up (O-23). No builder container runs in this stack; the queue is data in Postgres.

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull
git switch -c p3/coverage-admin
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault and append O-IDs to planning/00.
2. Stay in the default permission mode.
3. Paste the prompt below.

## The prompt

```text
Role and context
You are running session S28 of sprint 1 of g-tee-oh, Phase 3 (Preflop trainer), on branch p3/coverage-admin off the sprint branch sprint/1-v1. Goal: the coverage view with gap requests and the admin builder screen, over the endpoints S23 built, closed by end-to-end flow 5. You close the screen part of R3.4 and the screen part of R3.5.

Reading order (vault at C:\Users\stack\vault\projects\g-tee-oh, added with /add-dir)
1. planning/phases/phase-3-preflop-trainer.md
2. planning/09-v1-sprint-roadmap.md sections 3, 5 (the S28 row), 6 (Phase 3) and 7
3. planning/00-open-questions-and-risks.md, answered questions O-17 to O-67; this session leans on O-26, O-36, O-53 and O-62
4. planning/01-product-spec.md section 4 item 11; planning/05-training-and-grading.md section 1
5. planning/architecture/A7-web-app.md sections 2, 3 and 5 (flow 5); A5-services-and-interfaces.md sections 3 and 4; A4-data-model.md (build_job, builder_setting, storage_ledger, events); A9-quality-security-ops.md section 4 (the health page items)
6. decisions/_README.md, then ADRs 0017 and 0018
7. In the repo: CLAUDE.md, docs/ (mirrored files), web/ (S24), services/api/ coverage and admin routes (S23), packages/contracts/api.openapi.json

Rules
- Clone C:\Users\stack\projects\g-tee-oh, Claude Code in PowerShell; WSL2 (Windows Subsystem for Linux 2) only for Linux container builds and benchmarks (O-23). The private capture repo C:\Users\stack\projects\g-tee-oh-capture is not touched by this session (O-28).
- Branch p3/coverage-admin off sprint/1-v1; merge by pull request into sprint/1-v1; sprint/1-v1 merges into main only in S35 (R4.18).
- Gates in order: plan first (enter plan mode, write the plan, wait for my approval; trivial one-liners exempt); break down into a concrete task list; implement the smallest working increment; tests pass (never advance on red; write the suite if none exists); run /code-review and fix CRITICAL and HIGH findings; run /security-review for anything touching auth, user input, secrets or endpoints; commit with conventional commits (feat:, fix:, chore:, refactor:, docs:, test:, perf:, ci:) and end every commit message with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Test-driven: red test first, tagged with its R ID, then green, then refactor; 80 percent coverage or better on new code.
- Visual testing happens on local ports with my screenshots. Nothing deploys to the Mac without my explicit yes at that moment (O-20). This session runs no workflow: every step is single.
- Accepted ADRs are fixed; if a step would contradict one, stop and raise it. Cite O-IDs and ADR numbers in code comments, commit bodies and docs wherever an answer is used. A new question goes to planning/00 as a proposed O-ID with a default under a new dated subsection.
- Privacy (O-26, ADR 0017): nothing GTO Wizard-specific enters the repo; the coverage view shows the public catalog and the fixture library only in tests.
- Report honestly at every gate: if tests fail, say so and show the output; if a step was skipped, say which.
- Docs you write: no em dashes, no bold, acronyms expanded on first use, the mechanism before the conclusion.

Inputs
- GET /coverage (counts by flop and texture family, preflop availability, queue positions), POST /coverage/requests (raises a build_job priority), GET /events SSE (server-sent events) with coverage_added and builder_state; GET /admin/builder, PATCH /admin/builder/settings, pause and resume (S23)
- CoverageGrid and BuilderHealth shells (S24); A7 section 2 puts the coverage view and builder health on /library; A9 section 4 lists the health page items (builder state, flops per day, queue depth, storage against budget, last backup, LLM spend this month, where LLM is a large language model); show the items that exist in v1 data and leave the rest as labeled placeholders
- Flow 5 (A7 section 5): request coverage for an uncovered spot and see the queue position; nothing waits on a solve

Requirements this session closes
- R3.4, screen part: the /library screen with CoverageGrid, a gap request from an uncovered selection that shows the queue position, and live updates over SSE when coverage_added arrives. Proof: component tests; end-to-end flow 5 written here and wired into CI (continuous integration) by S29; the request-path test from S23 still green.
- R3.5, screen part: the admin builder screen with queue, throughput, storage against budget, settings editing (PATCH round trip), pause and resume. Proof: component test; a settings edit round trip through the screen; pause then resume reflected in builder_state. Place it on /library with BuilderHealth per A7 section 2; if you split it to its own route, say why in the pull request.

Steps
1. (single) Plan: enter plan mode, read the files above, write the plan with its task list, wait for my approval.
2. (single) Red: component tests for CoverageGrid with queue positions, the gap request interaction, the SSE update, the admin screen controls and the settings round trip, each tagged with its R ID; write flow 5 in Playwright.
3. (single) Green: build the coverage view and the admin screen over the generated client; run flow 5 against the compose dev stack.
4. (single) Run both screens on a local port, take screenshots of the coverage grid, a queued gap request with its position, and the admin screen in running and paused states, and hand them to me. Do not block on my comments; the S29 visual pass covers any screen I have not reviewed by then (O-67).
5. (single) Refactor; run /code-review and fix CRITICAL and HIGH findings; run /security-review (settings PATCH, pause and resume are mutating admin actions behind auth) and fix its findings; confirm coverage on new code is 80 percent or better; open the pull request into sprint/1-v1 listing R3.4 and R3.5.

Definition of done
- [ ] Coverage view, gap request with queue position and SSE update working against the dev stack; flow 5 green locally
- [ ] Admin screen with settings round trip, pause and resume; component tests green, each tagged with its R ID
- [ ] Screenshots saved and handed to me (my review may wait until S29); coverage 80 percent or better; /code-review done; /security-review done
- [ ] Pull request opened into sprint/1-v1 with the R IDs listed; the private-data guard passes

Report back
Your final message lists: R3.4 (screen part) and R3.5 (screen part) with their test commands and results; the branch and the pull request link; the files written and the screenshot paths; usage notes (units used against the planned medium level); any new question as a proposed O-ID with a default, appended to planning/00 under a new dated subsection.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| `/library` coverage view with `CoverageGrid`, gap requests and SSE updates; the admin builder screen with `BuilderHealth`, settings, pause and resume | Repo, branch `p3/coverage-admin`, under `web/` |
| Playwright flow 5; component tests tagged R3.4 and R3.5 | Repo, `web/` tests |
| Screenshots of both screens | Handed to the owner |
| Pull request into `sprint/1-v1` | GitHub |
| New O-IDs, if any | `planning/00-open-questions-and-risks.md` in the vault |
