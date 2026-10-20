---
id: 'g-tee-oh-handoff-s32-web-progress'
title: 'S32 Web progress'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 4
session: 'S32'
branch: 'p4/web-progress'
tags: [g-tee-oh, handoff, phase-4]
---
# S32 Web progress (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-4-rating-and-release|Phase 4 Rating, scheduling, progress, Deploy 2 and the v1 gate]]. This session produces the progress screen with the two v1 charts after a dataviz pass, the automated training start and recap screens, the home queue and streak, the cosmetics settings, and Playwright flows 1 and 6. It closes R4.12 and supplies the screens that let flow 1 close R4.10 at S33. Branch `p4/web-progress` off `sprint/1-v1`; parallel group E, earliest day 7 (2026-10-26), paced for week 4 (09 sections 4 and 5); runs as a dynamic workflow; public; high usage (3 units). Decisions are cited as ADR nnnn (architecture decision record); answered questions by O-ID from [[projects/g-tee-oh/planning/00-open-questions-and-risks|00 Open questions and risks]].

## Before pasting

- [ ] S31 merged into `sprint/1-v1`: the automated mode and progress endpoints with the regenerated client.
- [ ] S24 merged: the web foundation (Vite app, router, query, store, the component library or the A7 fallback per O-44, login, home shell, Vitest and Playwright).
- [ ] S25 merged: the trainer screen and feedback panel that automated mode reuses (09 section 3).
- [ ] The owner available during the verifier step to review screenshots from a local port and say what to fix.
- [ ] Machine: the Zenbook, clone `C:\Users\stack\projects\g-tee-oh`, PowerShell; the compose dev stack in Windows Subsystem for Linux 2 (WSL2) with the fixture library reachable on a local port (O-23, O-62).

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull --ff-only
git switch -c p4/web-progress
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault, write a chart-library ADR there if one is needed, and append O-IDs to `planning/00-open-questions-and-risks.md`.
2. Stay in the default permission mode, so you approve the workflow run when it launches.
3. Paste the prompt below.

## The prompt

```text
You are running session S32 of sprint 1 of g-tee-oh, Phase 4 (rating, scheduling, progress, Deploy 2 and the v1 gate), on branch p4/web-progress off the sprint branch sprint/1-v1. Goal: the progress screen, automated training start and recap, home queue and streak, cosmetics settings, and flows 1 and 6, closing R4.12.

Reading order (vault root C:\Users\stack\vault\projects\g-tee-oh, added with /add-dir; paths are relative to it):
1. planning/phases/phase-4-rating-and-release.md
2. planning/09-v1-sprint-roadmap.md sections 3, 5 (row S32), 6 (Phase 4) and 7
3. planning/00-open-questions-and-risks.md, answered questions O-17 to O-67; O-44, O-55 and O-62 bind this session
4. planning/06-rating-and-progress.md sections 7 and 8
5. planning/architecture/A7-web-app.md (whole); A5-services-and-interfaces.md section 3; A6-trainer-and-learning-engine.md section 3; A9-quality-security-ops.md sections 1 and 2
6. decisions/0006-frontend-is-react-typescript-vite-spa.md, 0012-fsrs-scheduling-and-bkt-mastery-no.md, 0011-one-overall-rank-with-per-track.md
7. The repo's CLAUDE.md and any docs/ mirrored files; web/ as S24 and S25 left it; the generated api client from S31

Rules:
- Zenbook clone C:\Users\stack\projects\g-tee-oh, Claude Code in PowerShell; WSL2 only for the compose dev stack (O-23). The private capture repo is not touched.
- Branch p4/web-progress; merge by pull request into sprint/1-v1; sprint/1-v1 merges into main only in S35 (R4.18).
- Gates in order: plan first in plan mode and wait for the owner's approval; a concrete task list; the smallest working increment; tests green before advancing, never on red; /code-review and fix CRITICAL and HIGH; /security-review only if you touch auth or add input handling beyond the generated client; conventional commits (feat:, fix:, chore:, refactor:, docs:, test:, perf:, ci:), each ending with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Test-driven: red component test tagged with its R ID, then green, then refactor; 80 percent coverage or better on new code; Vitest and Testing Library for components, Playwright for flows (A7 section 1).
- Visual testing on local ports with owner screenshots; nothing deploys to the Mac (O-20).
- Color is never the only signal: frequency and mastery cells carry patterns or labels (A7 section 4). Every screen uses the S24 foundation components; automated mode reuses the S25 trainer screen.
- Accepted ADRs are fixed (0006, 0011, 0012); the chart library is this session's decision (O-55): record it as an ADR in the vault decisions/ folder and the index only if it adds a dependency beyond the Vite stack; otherwise record the choice in the pull request. Cite O-IDs where an answer sets a value; anything else open becomes a proposed O-ID with a default appended to planning/00 under a new dated subsection.
- Privacy (O-26): screenshots and fixture data in the repo come from the public fixture library only.
- A step runs as a dynamic workflow only where this prompt says so, under 10 agents, with the verifier named. Report honestly at every gate.

Inputs:
- Endpoints and client (S31): /progress/rating, /progress/tracks, /progress/leaks?weeks, /progress/heatmap, /progress/holdout, /progress/streak; sessions in automated mode with recap.
- A7 section 3 components: RatingCard, TrackBreakdown, LeakTrendChart, MasteryHeatMap, HoldoutCard, StreakBadge; routes / (home), /train, /progress, /settings (A7 section 2).
- View rules from 06 section 7: leak-cost trend is the top 10 spot classes by leak cost, weekly, a click opens a drill for that class; the heat map has action family by position pair as rows, depth and format as columns, mastery p as the cell with retrievability as an overlay, a click opens a drill; the rating card shows rating plus or minus rating deviation (RD), tier and per-track breakdown; the holdout card shows the monthly result. Streak rules from 06 section 8; cosmetics are card backs, felts and badges.
- The fixture attempt set and the fixture library in the dev stack (O-30, O-62) for flow 6.

Requirements this session closes (test in parentheses):
- R4.12 progress endpoints and screen: rating card, track breakdown, leak-cost trend (top 10 weekly), mastery heat map, holdout card, streak; chart library from the dataviz pass (O-55) (aggregation unit tests from S31; end-to-end flow 6 renders the trend and heat map from fixture data).
- Flow 1 for R4.10 (owned by S31; runs in continuous integration (CI) at S33): sign in, start automated training, answer five decisions with confidence taps, end the session, see the rating card update (A7 section 5).

Steps:
1. (single) Plan mode: read; run the dataviz pass before any chart code (load the dataviz skill if the session lists one): choose the chart library for the trend and the heat map, preferring what the Vite stack already carries, with a light and dark theme and an accessible table fallback for each chart; write the plan with the component list, the route changes and the two flows; wait for approval; write the task list.
2. (dynamic workflow, under 5 agents: a charts agent for RatingCard, TrackBreakdown, LeakTrendChart, MasteryHeatMap, HoldoutCard and StreakBadge on /progress; an automated-mode agent for /train start, the session view over the S25 trainer screen with the confidence tap, and the recap; a home-and-settings agent for the / queue, streak and rating card and the cosmetics section of /settings; the verifier agent runs flows 1 and 6 on a local port against the dev stack and hands the owner screenshots of every new screen) Use a dynamic workflow for this step, under 5 agents.
3. (single) Owner review: show the screenshots, collect the owner's findings, fix them; add flows 1 and 6 to the Playwright suite so the CI e2e job runs them (they are confirmed green at S33); /code-review and fix CRITICAL and HIGH; commit; open the pull request into sprint/1-v1.

Definition of done:
- [ ] Component tests green and tagged R4.12 (and R4.10 for the automated screens); coverage 80 percent or better on new code.
- [ ] Flows 1 and 6 green on a local port and committed to the Playwright suite; the ts and e2e jobs green on the branch.
- [ ] The owner has reviewed screenshots of /progress, /train (start, session, recap), / and the cosmetics settings and the findings are fixed.
- [ ] The chart library decision recorded (ADR only if it adds a dependency, O-55).
- [ ] /code-review done with CRITICAL and HIGH fixed.
- [ ] Pull request opened into sprint/1-v1 with the R IDs and O-IDs; new questions appended to planning/00 as proposed O-IDs.

Report back, in the final message: each R ID with the test command and its result, flow 1 and flow 6 with their local-port results; the branch and pull request link; the files written and the chart library chosen with its reason; no gate artifact (S33 records the Phase 4 gate); usage in units against the planned high (3); any new question as a proposed O-ID with a default, appended to planning/00 under a new dated subsection.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| /progress screen and its six components; /train start, session and recap; home queue, streak and rating card; cosmetics settings | `web/` on `p4/web-progress` |
| Component tests; Playwright flows 1 and 6 | `web/` test folders |
| Chart library decision | the pull request, or a new ADR in vault `decisions/` plus `_README` if it adds a dependency (O-55) |
| Screenshots for the owner's review | handed in the session; not committed |
| Pull request into `sprint/1-v1` | GitHub |
| Proposed O-IDs, if any | vault `planning/00-open-questions-and-risks.md` |
