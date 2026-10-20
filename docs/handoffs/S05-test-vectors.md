---
id: 'g-tee-oh-handoff-s05-test-vectors'
title: 'S05 Test vectors'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 0
session: 'S05'
branch: 'p0/test-vectors'
tags: [g-tee-oh, handoff, phase-0]
---
# S05 Test vectors (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-0-foundations|Phase 0 Foundations and test scaffolding]]. This session writes the red tests and fixtures first (R0.11): the learning vectors as pending tests, the toy-game fixtures with the OpenSpiel Leduc curve and its provenance, the `validation/reports/` format and the `packages/learning` skeleton. The two `gto-model` vectors (the bucket-edge table and the node-key round trip) are not written here; S12 writes them red first inside its own session (R0.11, 09 section 3). Branch `p0/test-vectors` off `sprint/1-v1`. Parallel group B, earliest day 2 (2026-10-21), paced week 1 after S02 (09 sections 4 and 5). Its writing step runs as a dynamic workflow. Public. Usage medium (2 units).

## Before pasting

- [ ] S01 merged into `sprint/1-v1` (workspaces with the `packages/learning` and `tools/validate` stubs, continuous integration (CI); 09 section 3). S02 is not needed.
- [ ] uv is installed on the Zenbook; Windows Subsystem for Linux 2 (WSL2) is available in case the OpenSpiel wheel is not published for Windows (O-23).
- [ ] The vault is readable through `/add-dir`.

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull
git switch -c p0/test-vectors
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault and append open-question identifiers (O-IDs) to `planning/00-open-questions-and-risks.md`.
2. Stay in the default permission mode.
3. Paste the prompt.

## The prompt

```text
You are running session S05 of sprint 1 of g-tee-oh, Phase 0 (Foundations and test scaffolding), on branch p0/test-vectors off the sprint branch sprint/1-v1. Goal: red tests and fixtures first (R0.11), every one pending and tagged with the requirement identifier (R ID) it will later close, except the two gto-model vectors that S12 writes.

## Reading order
The vault is C:\Users\stack\vault\projects\g-tee-oh (added with /add-dir). Read in order:
1. planning/phases/phase-0-foundations.md
2. planning/09-v1-sprint-roadmap.md: sections 3 (S05 edges), 5 (row S05), 6 (R0.11, then R2.4 to R2.6, R3.8, R3.10, R3.20, R4.1, R4.6 to R4.9 for the vectors' later owners), 7 (traceability rows 1, 4, 6, 7)
3. planning/00-open-questions-and-risks.md: O-30, O-35, O-40, O-60, O-65
4. planning/architecture/A6-trainer-and-learning-engine.md sections 1, 4 and 6; A9-quality-security-ops.md section 1; planning/04-solver-engine.md section 6 (G1 to G3 pass rules)
5. planning/06-rating-and-progress.md (Glicko-2, Free Spaced Repetition Scheduler (FSRS) and Bayesian Knowledge Tracing (BKT) parameters; section 5 for BKT per R4.7); planning/05-training-and-grading.md section 6 (grading thresholds)
6. decisions/_README.md, then architecture decision records (ADRs) 0008, 0011, 0012
7. The repo: CLAUDE.md, packages/learning/, tools/validate/, validation/, docs/

## Rules
- Clone C:\Users\stack\projects\g-tee-oh, Claude Code in PowerShell, native Windows Rust toolchain; WSL2 only for Linux container builds and benchmarks, which includes the OpenSpiel run if its wheel is Linux-only (O-23).
- Branch p0/test-vectors; merge by pull request into sprint/1-v1; sprint/1-v1 merges into main only in S35 (R4.18).
- Gates in order: plan first (plan mode, wait for approval), concrete task list, smallest working increment, tests green (pending tests count as green; nothing here turns green yet), /code-review with CRITICAL and HIGH fixed, /security-review only if a script touches secrets or endpoints (none expected), conventional commits ending with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Test-driven by design: this session is the red half. Every test is pending (it.todo in Vitest, #[ignore = "R<id> pending S<nn>"] in Rust) and its name starts with its R ID.
- Accepted ADRs are fixed; ADR 0011's parameters are accepted at sprint start (O-56). Cite O-IDs and ADR numbers in test names or comments and in the report.
- Privacy boundary (O-26, ADR 0017): fixtures here are toy games and published vectors; nothing derived from any reference tool enters this repo.
- Documentation you write: no em dashes or en dashes, no bold, acronyms expanded on first use, mechanism before conclusion.
- A step runs as a dynamic workflow only where this prompt says so, under 10 agents, with the verifier's checks named.
- Report honestly at every gate: show failing output, name any skipped step.

## Inputs
- S01's packages/learning and tools/validate stubs and the validation/ folders.
- The ts-fsrs package, its license file and its published test vectors (O-35).
- OpenSpiel through uv for the Leduc exploitability curve (O-30).
- The A6 section 6 vector table and the 04 section 6 pass rules.

## Requirement this session closes
- R0.11 Red tests first, each tagged with its R ID and pending: the Glicko-2 worked example (A6 section 6; later R4.1), the ts-fsrs license verified and its published vectors wired to an empty adapter (O-35; later R4.6), Kuhn, AKQ (ace, king, queen) and Leduc fixtures (later R2.4 to R2.6), the OpenSpiel Leduc exploitability curve generated once with uv and committed with PROVENANCE.md (version, command, seed; O-30), the validation/reports/ format, and the packages/learning skeleton with the A6 section 4 types. The bucket-edge table and the node-key round trip belong to S12. Proof: tests exist and are pending with R IDs; CI green with pending tests; PROVENANCE.md present; licenses job passes.

## Steps
1. (single) Read, then plan in plan mode and wait for approval. The plan lists every pending test with its R ID and owner session, every fixture file, the report format fields and the skeleton modules.
2. (dynamic workflow, under 5 agents: a learning-vectors agent writing pending Vitest tests in packages/learning named by R ID: R4.1 Glicko-2 worked example with the A6 section 6 numbers, R4.6 ts-fsrs published vectors through an empty adapter after verifying and recording the ts-fsrs license, R4.7 BKT hand-computed sequences, R4.8 leak cost fixture, R4.9 interleave rule over 1,000 picks, R3.8 grading floor boundary and mixed hand, R3.10 chi-square over 10,000 seeded rolls, R3.20 validator planted number; an engine-fixtures agent writing validation/fixtures/ for Kuhn, AKQ and Leduc as data files with a README, pending Rust tests in tools/validate tagged R2.4, R2.5, R2.6 carrying the 04 section 6 pass rules, and the OpenSpiel Leduc curve generated once with uv (in WSL2 if needed) and committed with PROVENANCE.md naming the OpenSpiel version, the exact command, the seed and the machine; a reports-and-skeleton agent defining the validation/reports/ format (a README and a JSON (JavaScript Object Notation) schema with report id, R IDs, commit, machine, date, pass flag, thresholds and measurements, which S02's just bench and every later gate report follow) and the packages/learning skeleton with the A6 section 4 GradeInput and GradeOutput types and one empty module per A6 section 1 row; the verifier agent runs a just test-tags target that fails on any pending test without an R ID, confirms CI is green with the pending tests, and confirms the licenses job passes with ts-fsrs added). Use a dynamic workflow for this step, under 5 agents.
3. (single) Write validation/fixtures/README.md naming the two vectors S12 owns (bucket-edge table, node-key round trip), so nobody adds them here.
4. (single) /code-review, then open the pull request into sprint/1-v1 with R0.11 in the template.

## Definition of done
- [ ] Every pending test carries an R ID; just test-tags passes; CI green on the pull request with the pending tests
- [ ] validation/fixtures/ holds Kuhn, AKQ and Leduc, the OpenSpiel curve and PROVENANCE.md
- [ ] validation/reports/README.md and the report JSON schema exist
- [ ] packages/learning has the A6 section 4 types and its module skeleton; ts-fsrs added with its license recorded; licenses job green
- [ ] /code-review done; pull request opened into sprint/1-v1

## Report back
The final message lists R0.11 with the test commands (pnpm test, cargo test, just test-tags) and their results, plus the count of pending tests per later R ID; the branch and pull request link; the files written; the PROVENANCE.md path; usage notes (units used against the planned medium level); and any new question as a proposed O-ID with a default, appended to planning/00-open-questions-and-risks.md under a new dated subsection.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| Pending Vitest tests named by R ID (R3.8, R3.10, R3.20, R4.1, R4.6 to R4.9) | repo `packages/learning/` |
| `packages/learning` skeleton with the A6 section 4 types | repo |
| `validation/fixtures/` Kuhn, AKQ, Leduc, the OpenSpiel Leduc curve, `PROVENANCE.md`, README | repo |
| Pending Rust gate tests tagged R2.4 to R2.6 | repo `tools/validate/` |
| `validation/reports/README.md` and the report JSON schema | repo |
| `just test-tags` | repo `justfile` |
| Pull request `p0/test-vectors` into `sprint/1-v1` | GitHub |
| New O-IDs, if any | vault `planning/00-open-questions-and-risks.md` |
