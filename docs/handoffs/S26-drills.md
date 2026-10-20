---
id: 'g-tee-oh-handoff-s26-drills'
title: 'S26 drills'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 3
session: 'S26'
branch: 'p3/drills'
tags: [g-tee-oh, handoff, phase-3]
---
# S26 drills (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-3-preflop-trainer|Phase 3 Preflop trainer]]. This session produces the street and full-hand trainer modes (ending when the flop is dealt), the drill builder and library screens with import and export, and the build-card acceptance file that expresses every preflop drill on the owner's 15-drill card in the schema and runs it. Branch `p3/drills`, parallel group E, earliest day 7, paced for week 4 (days 22 to 28, 2026-11-10 to 2026-11-16; 09 sections 4 and 5). It runs as a dynamic workflow. Public. Usage: high. R IDs are requirement identifiers; O-IDs are the answered questions in [[projects/g-tee-oh/planning/00-open-questions-and-risks|00 Open questions and risks]].

## Before pasting

- [ ] S25 merged into `sprint/1-v1`: the trainer in spot mode, which street and full hand extend.
- [ ] S21 and S23 merged: drill CRUD (create, read, update, delete) and the session machine with its stop rules.
- [ ] The 15-drill build card exported from the Poker Studying/Practice project into `research/` in the vault as a private note (O-24). If it is not there, the session runs the drills named in [[projects/g-tee-oh/planning/05-training-and-grading|05 Training and grading]] section 4 instead and S29 blocks on the card (O-67).
- [ ] S07's drill schema confirmation in the vault if the second sitting has happened (R1.1); otherwise 05 section 4 as written is the schema.
- [ ] Optional: packed reference configurations present locally (S10, R1.7) so the acceptance file can also run against the reference library; without them it runs against the fixture library only.
- [ ] The compose `dev` stack on the Zenbook with `FIXTURE_LIBRARY_PATH` set (O-62); Docker in Windows Subsystem for Linux 2 (WSL2) up (O-23).

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull
git switch -c p3/drills
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault (including the build card under `research/`) and append O-IDs to planning/00.
2. Stay in the default permission mode, so you approve the workflow when it launches.
3. Paste the prompt below.

## The prompt

```text
Role and context
You are running session S26 of sprint 1 of g-tee-oh, Phase 3 (Preflop trainer), on branch p3/drills off the sprint branch sprint/1-v1. Goal: street and full-hand trainer modes to the flop, the drill builder and library screens with import and export, and the build-card acceptance file. You close the street and full-hand part of R3.13, R3.14 (all but the CRUD endpoints, create, read, update, delete, which S21 built) and R3.15.

Reading order (vault at C:\Users\stack\vault\projects\g-tee-oh, added with /add-dir)
1. planning/phases/phase-3-preflop-trainer.md
2. planning/09-v1-sprint-roadmap.md sections 3, 5 (the S26 row), 6 (Phase 3) and 7
3. planning/00-open-questions-and-risks.md, answered questions O-17 to O-67; this session leans on O-24, O-26, O-53, O-62, O-64 and O-67
4. planning/05-training-and-grading.md sections 1, 2, 4 and 11; planning/01-product-spec.md section 4 item 4, section 5 (import from the reference tool's exports is a v1 non-goal) and section 6 criterion 5
5. planning/architecture/A7-web-app.md sections 2, 3 and 5 (flow 2); A5-services-and-interfaces.md section 3 (Drills, Training); A6-trainer-and-learning-engine.md section 2 (stop rules)
6. decisions/_README.md, then ADRs 0017, 0018 and 0020
7. In the vault: the build card export under research/ (private, O-24) and, if present, the S07 drill schema confirmation (R1.1). In the repo: CLAUDE.md, docs/ (mirrored files), web/ (S24, S25), services/api/ (S21, S23), validation/fixtures/ (S19)

Rules
- Clone C:\Users\stack\projects\g-tee-oh, Claude Code in PowerShell; WSL2 (Windows Subsystem for Linux 2) only for Linux container builds and benchmarks (O-23). The private capture repo C:\Users\stack\projects\g-tee-oh-capture is not touched by this session (O-28).
- Branch p3/drills off sprint/1-v1; merge by pull request into sprint/1-v1; sprint/1-v1 merges into main only in S35 (R4.18).
- Gates in order: plan first (enter plan mode, write the plan, wait for my approval; trivial one-liners exempt); break down into a concrete task list; implement the smallest working increment; tests pass (never advance on red; write the suite if none exists); run /code-review and fix CRITICAL and HIGH findings; run /security-review for anything touching auth, user input, secrets or endpoints; commit with conventional commits (feat:, fix:, chore:, refactor:, docs:, test:, perf:, ci:) and end every commit message with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Test-driven: red test first, tagged with its R ID, then green, then refactor; 80 percent coverage or better on new code.
- Visual testing happens on local ports with my screenshots. Nothing deploys to the Mac without my explicit yes at that moment (O-20). A step runs as a dynamic workflow only where this prompt says so in my words; keep every workflow under 10 agents and name what its verifier runs.
- Accepted ADRs are fixed; if a step would contradict one, stop and raise it. Cite O-IDs and ADR numbers in code comments, commit bodies and docs wherever an answer is used. A new question goes to planning/00 as a proposed O-ID with a default under a new dated subsection.
- Privacy (O-26, O-64, ADR 0017): the drill schema uses the g-tee-oh field names from 05 section 4 only; the reference tool's parameter names and export format never enter the repo. The translated build card stays under research/ in the vault until I read it and answer O-64; the repo carries only a synthetic drill set for CI (continuous integration). Nothing from the reference library (counts, names of captured configurations beyond the public catalog) goes into the repo or the report.
- Report honestly at every gate: if tests fail, say so and show the output; if a step was skipped, say which.
- Docs you write: no em dashes, no bold, acronyms expanded on first use, the mechanism before the conclusion.

Inputs
- The trainer in spot mode (S25); the session machine with stop rules after action, end of street, end of hand, and pause rules after mistake, every action, never (S23, A6 section 2); drill CRUD over the Zod schema (S21)
- 05 section 4 schema: spot_filter (game_config, stake, sizing, start_street, hero_positions, villain_positions, preflop_action, line, board, hands, alternate_seats), trainer (stop_rule, input, grouping, rng, pause, speed, quick_result, tables, timebank_s, panels), drill tags and export_code; the export code is g-tee-oh's own encoding of a drill row
- The build card under research/ (O-24), or the fallback list in 05 section 4 (RFI boundary hands, BB versus BTN mixed region, BB versus CO mixed region, live-depth opens; RFI is raise first in, BB big blind, BTN button, CO cutoff) when the card is missing (O-67)
- The fixture library (S19) and, when present locally, the packed reference configurations (S10)

Requirements this session closes
- R3.13, street and full-hand part: every decision on one street, and the full hand, both ending when the flop is dealt in v1 (05 section 2), driven by the session stop rule. Proof: client state tests for street and full hand; flow 4 still green.
- R3.14 drill schema from 05 section 4 as Zod; drill library (tags, duplicate), builder, import and export code; a drill whose filter reaches uncovered spots runs on the covered part, shows how much is missing and files a gap request, never waiting for a solve (ADR 0018). Proof: schema tests; export then import round trip equal to the original; end-to-end flow 2 (build a drill from scratch for RFI boundary hands, save, export, import the export, run it).
- R3.15 every preflop drill on the build card expressed in the schema and run. Proof: an acceptance file with one case per drill, each case parsing (expressed) and producing at least one prompt (run), run by a repo acceptance runner that takes a file path; against the fixture library in the session and, locally, against the reference library when it is present; CI runs the synthetic drill set under validation/fixtures/ until O-64 is answered. The acceptance file itself lives under research/ in the vault.

Steps
1. (single) Plan: enter plan mode, read the files above and the build card (or note it is missing and use the fallback), write the plan with its task list, wait for my approval.
2. Use a dynamic workflow for this step, under 5 agents: one for street and full-hand modes on the trainer screen; one for the drill screens (/drills library with tags, duplicate, import and export; /drills/new and /drills/:id builder mirroring the schema; the covered-part run with the missing share and the gap request); one for the acceptance work (the repo runner, the synthetic drill set, and the translated acceptance file written under research/ in the vault, never in the repo); flow 2 joins them. Every agent writes its red tests tagged with the R ID first. The verifier agent runs the acceptance runner against the fixture library and, if packed reference configurations are present locally, against the reference library, then runs flow 2, and reports any red case verbatim with the drill name only.
3. (single) Run the drill screens on a local port, take screenshots of the library, the builder and a street-mode hand, and hand them to me. Do not block on my comments; the S29 visual pass covers any screen I have not reviewed by then (O-67).
4. (single) Run /code-review and fix CRITICAL and HIGH findings; run /security-review (import code is user input) and fix its findings; confirm coverage on new code is 80 percent or better.
5. (single) Open the pull request into sprint/1-v1 listing R3.13, R3.14 and R3.15.

Definition of done
- [ ] Street and full-hand modes end at the flop; their client state tests green; flow 4 still green
- [ ] Schema tests and the export then import round trip green; flow 2 green locally
- [ ] Acceptance file written under research/ with one case per build-card drill (or the fallback list, stated as such); every case passes against the fixture library; the reference-library result recorded if run
- [ ] Synthetic drill set committed under validation/fixtures/ and green in the acceptance runner
- [ ] Screenshots saved and handed to me (my review may wait until S29); coverage 80 percent or better; /code-review done; /security-review done
- [ ] Pull request opened into sprint/1-v1 with the R IDs listed; the private-data guard passes

Report back
Your final message lists: each R ID (R3.13 street and full-hand part, R3.14, R3.15) with its test command and result; whether the build card or the fallback list was used and how many cases passed, by drill name only; the branch and the pull request link; the files written in the repo and in the vault; usage notes (units used against the planned high level); any new question as a proposed O-ID with a default, appended to planning/00 under a new dated subsection.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| Street and full-hand modes on the trainer screen; `/drills`, `/drills/new`, `/drills/:id` screens | Repo, branch `p3/drills`, under `web/` |
| Zod drill schema, import and export code, the covered-part run with gap request | Repo, `services/api/` and `packages/contracts/` |
| Acceptance runner and the synthetic drill set | Repo, `validation/fixtures/` and the runner under `tools/` or `services/api/` tests |
| Translated build-card acceptance file (private until O-64) | Vault, `research/` |
| Playwright flow 2; tests tagged R3.13, R3.14, R3.15 | Repo |
| Screenshots of the drill screens | Handed to the owner |
| Pull request into `sprint/1-v1` | GitHub |
| New O-IDs, if any | `planning/00-open-questions-and-risks.md` in the vault |
