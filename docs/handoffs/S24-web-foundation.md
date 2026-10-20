---
id: 'g-tee-oh-handoff-s24-web-foundation'
title: 'S24 web foundation'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 3
session: 'S24'
branch: 'p3/web-foundation'
tags: [g-tee-oh, handoff, phase-3]
---
# S24 web foundation (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-3-preflop-trainer|Phase 3 Preflop trainer]]. This session produces the web foundation: the Vite application with its router, server state, store and component library, the login page and home shell, the core trainer and study components as tested shells, the canvas range matrix with its frame bench, and the Vitest and Playwright harness. It lays the foundations of R3.12 and R3.13; their closing flows land in S25 and S26. Branch `p3/web-foundation`, parallel group D, earliest day 5, paced for week 3 (days 15 to 21, 2026-11-03 to 2026-11-09; 09 sections 4 and 5). It runs as a dynamic workflow. Public. Usage: high. R IDs are requirement identifiers; O-IDs are the answered questions in [[projects/g-tee-oh/planning/00-open-questions-and-risks|00 Open questions and risks]].

## Before pasting

- [ ] S06 merged into `sprint/1-v1`: the Vite skeleton with a router and the Playwright smoke flow (R0.7).
- [ ] S21's first commit (the `api` OpenAPI contract, O-38) merged or at least on `sprint/1-v1`, so the web client can be generated; the full S21 merge is better but not required.
- [ ] S07's frontend stack note in the vault if the second sitting has happened (R1.1); if not, the A7 fallback, Tailwind with Radix primitives, is the component library (O-44).
- [ ] The Zenbook clone at `C:\Users\stack\projects\g-tee-oh`; Docker in Windows Subsystem for Linux 2 (WSL2) for the compose `dev` stack when the real `api` is available (O-23).

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull
git switch -c p3/web-foundation
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault and append O-IDs to planning/00.
2. Stay in the default permission mode, so you approve the workflow when it launches.
3. Paste the prompt below.

## The prompt

```text
Role and context
You are running session S24 of sprint 1 of g-tee-oh, Phase 3 (Preflop trainer), on branch p3/web-foundation off the sprint branch sprint/1-v1. Goal: the web foundation (Vite app, router, query, store, component library, login, home shell, core components, the canvas matrix, Vitest and Playwright), which is the foundation of R3.12 and R3.13; S25 and S26 close those requirements with flows 3, 4 and 2.

Reading order (vault at C:\Users\stack\vault\projects\g-tee-oh, added with /add-dir)
1. planning/phases/phase-3-preflop-trainer.md
2. planning/09-v1-sprint-roadmap.md sections 3, 5 (the S24 row), 6 (Phase 3) and 7
3. planning/00-open-questions-and-risks.md, answered questions O-17 to O-67; this session leans on O-22, O-23, O-26, O-38 and O-44
4. planning/05-training-and-grading.md sections 5 to 7 and 11; planning/01-product-spec.md section 2 (desktop only)
5. planning/architecture/A7-web-app.md (whole); A5-services-and-interfaces.md section 3; A1-repo-and-conventions.md sections 2 and 3; A9-quality-security-ops.md sections 1 and 3
6. decisions/_README.md, then ADRs 0006, 0017 and 0020
7. In the vault, if present: the S07 frontend stack note and sanitized feature map (R1.1). In the repo: CLAUDE.md, docs/ (mirrored files), web/ (the S06 skeleton), packages/contracts/api.openapi.json and its client (S21)

Rules
- Clone C:\Users\stack\projects\g-tee-oh, Claude Code in PowerShell; WSL2 (Windows Subsystem for Linux 2) only for Linux container builds and benchmarks (O-23). The private capture repo C:\Users\stack\projects\g-tee-oh-capture is not touched by this session (O-28).
- Branch p3/web-foundation off sprint/1-v1; merge by pull request into sprint/1-v1; sprint/1-v1 merges into main only in S35 (R4.18).
- Gates in order: plan first (enter plan mode, write the plan, wait for my approval; trivial one-liners exempt); break down into a concrete task list; implement the smallest working increment; tests pass (never advance on red; write the suite if none exists); run /code-review and fix CRITICAL and HIGH findings; run /security-review for anything touching auth, user input, secrets or endpoints; commit with conventional commits (feat:, fix:, chore:, refactor:, docs:, test:, perf:, ci:) and end every commit message with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Test-driven: red test first, tagged with its R ID, then green, then refactor; 80 percent coverage or better on new code.
- Visual testing happens on local ports with my screenshots. Nothing deploys to the Mac without my explicit yes at that moment (O-20). A step runs as a dynamic workflow only where this prompt says so in my words; keep every workflow under 10 agents and name what its verifier runs.
- Accepted ADRs are fixed; if a step would contradict one, stop and raise it. Cite O-IDs and ADR numbers in code comments, commit bodies and docs wherever an answer is used. A new question goes to planning/00 as a proposed O-ID with a default under a new dated subsection.
- Privacy (O-26, ADR 0017): nothing GTO Wizard-specific enters the repo. The sanitized feature map may guide layout; no screenshot of the reference tool, no route or payload of it, is copied anywhere.
- Report honestly at every gate: if tests fail, say so and show the output; if a step was skipped, say which.
- Docs you write: no em dashes, no bold, acronyms expanded on first use, the mechanism before the conclusion.

Inputs
- web/ skeleton with a router and a Playwright smoke flow (S06, R0.7); the generated api client from packages/contracts (S21's first commit, O-38); a mocked api for any endpoint S21 has not merged yet (O-38)
- A7 section 1 stack: Vite, React, TypeScript strict (locked); TanStack Router, TanStack Query, Zustand (proposed, use them unless the stack note says otherwise); the component library from the S07 stack note, else Tailwind with Radix primitives (O-44); Vitest, Testing Library and Playwright (locked)
- A7 section 2 routes, section 3 components, section 4 budgets (matrix frame under 16 ms; keyboard-first with a shortcuts overlay on ?; color never the only signal)
- The grouping rule for ActionBar labels: Grouped shows the bucket label with the size underneath, except at preflop nodes where the exact size is shown (O-22); Standard shows the exact size; a bucket missing from the tree has no button (ADR 0020). The behavioral test for this is R3.9 in S25; here the component takes the node's actions as props and renders them

Requirements this session lays the foundation for
- R3.12 study browser: this session builds RangeMatrix (canvas with per-cell action frequency bars, frequency, EV (expected value) and range-weight modes, an accessible table fallback) and the component bench. Proof here: component tests and the matrix frame bench under 16 ms per frame. Flow 3 and the study screen are S25.
- R3.13 trainer screen: this session builds PokerTable (6 to 9 seats, stacks, pot, button, bets, straddle marker), CardView, BoardReveal, ActionBar, ConfidenceTap, RngRoller, FeedbackPanel, ActionFrequencyTable, ThresholdCard and the hotkey system with the ? overlay, as components with props and tests, not yet wired to sessions. Proof here: component tests; the Playwright smoke flow (sign in, land on the home shell) green against the real or mocked api. Flow 4 is S25; street and full hand are S26.

Steps
1. (single) Plan: enter plan mode, read the files above, decide the component library per the stack note or O-44, write the plan with its task list, wait for my approval.
2. Use a dynamic workflow for this step, under 6 agents: one for the shell and auth (the Vite app, the A7 routes as placeholders, TanStack Query over the generated client, the Zustand store for table state, panel toggles and hotkeys, the login page, the home shell); one for the table and cards (PokerTable, CardView, BoardReveal, ActionBar, ConfidenceTap, RngRoller, FeedbackPanel shells, ActionFrequencyTable, ThresholdCard, the hotkey system); one for the matrix canvas (RangeMatrix, its table fallback, the frame bench); one for the test harness (Vitest and Testing Library setup, Playwright configuration against the compose dev stack or the mocked api, the smoke flow). Every agent writes its red tests tagged with the R ID first. The verifier agent runs the smoke flow and the matrix frame bench, and reports any red test or a frame over 16 ms verbatim.
3. (single) Run the app on a local port, take screenshots of the login page, the home shell and each component in a storybook-style gallery page or test page, and hand them to me. Do not block on my comments; the S25 and S29 visual passes cover what I have not reviewed by then (O-67).
4. (single) Run /code-review and fix CRITICAL and HIGH findings; run /security-review (login form, token handling, the client never sees the model key) and fix its findings; confirm coverage on web/ new code is 80 percent or better.
5. (single) Open the pull request into sprint/1-v1 listing R3.12 and R3.13 (foundation) and naming the component library chosen and why (stack note or O-44).

Definition of done
- [ ] Login page, home shell and route placeholders render; the smoke flow is green in Playwright
- [ ] Every A7 section 3 component needed by S25 and S26 exists with a component test tagged R3.12 or R3.13
- [ ] Matrix frame bench under 16 ms per frame; the accessible table fallback renders the same data
- [ ] Screenshots from a local port saved and handed to me (my review may wait until S25)
- [ ] Coverage 80 percent or better; /code-review done; /security-review done
- [ ] Pull request opened into sprint/1-v1 with the R IDs listed; the private-data guard passes

Report back
Your final message lists: R3.12 and R3.13 (foundation parts) with their test commands and results; the matrix frame bench number; the component library chosen and its source (stack note or O-44); the branch and the pull request link; the files written; usage notes (units used against the planned high level); any new question as a proposed O-ID with a default, appended to planning/00 under a new dated subsection.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| `web/` application: routes, query, store, component library, login, home shell | Repo, branch `p3/web-foundation` |
| Core components from A7 section 3 with component tests tagged R3.12 and R3.13 | Repo, `web/src/components/` |
| `RangeMatrix` canvas, table fallback and frame bench | Repo, `web/` |
| Vitest and Playwright harness with the smoke flow | Repo, `web/` |
| Screenshots from a local port | Handed to the owner in the session |
| Pull request into `sprint/1-v1` | GitHub |
| New O-IDs, if any | `planning/00-open-questions-and-risks.md` in the vault |
