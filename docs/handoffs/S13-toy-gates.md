---
id: 'g-tee-oh-handoff-s13-toy-gates'
title: 'S13 Toy gates'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 2
session: 'S13'
branch: 'p2/toy-gates'
tags: [g-tee-oh, handoff, phase-2]
---
# S13 Toy gates (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-2-engine-and-pipeline|Phase 2 Engine validation and solution pipeline]]. This session produces the `tools/validate` command-line interface (CLI) with gates G1 (Kuhn), G2 (AKQ (the ace, king, queen toy game) and toy river games) and G3 (Leduc against the committed OpenSpiel curve), their reports in the continuous integration (CI) `rust` job, and the 169 by 169 preflop equity table fixture (R2.4 to R2.6 and the table part of R2.20). It closes success criterion 1, and gates G1 to G3 then run on every CI run (O-63 pattern, 09 section 7). It runs on branch `p2/toy-gates` in parallel group C, earliest day 3 (2026-10-22), paced for week 2 ([[projects/g-tee-oh/planning/09-v1-sprint-roadmap|09 v1 sprint roadmap]] sections 4 and 5). It is a public session at medium usage, and its gate-building step runs as a dynamic workflow. Requirement identifiers (R IDs) follow 09 section 6 and open-question identifiers (O-IDs) follow 00.

## Before pasting

- [ ] S05 is merged into `sprint/1-v1`: the Kuhn, AKQ and Leduc fixtures, the OpenSpiel Leduc exploitability curve with `PROVENANCE.md`, and the `validation/reports/` format exist as pending tests tagged R2.4 to R2.6 (R0.11, O-30; 09 section 3).
- [ ] S12 is merged: `gto-model` provides the card and hand encodings (09 section 3).
- [ ] The clone at `C:\Users\stack\projects\g-tee-oh` is on `sprint/1-v1` and clean.
- [ ] Nothing else is needed from the owner.

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull --ff-only
git switch -c p2/toy-gates
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault and append any new O-ID to `planning/00-open-questions-and-risks.md`.
2. Stay in the default permission mode, so you approve the workflow when it launches.
3. Paste the prompt below.

## The prompt

```text
Role and context
You are running session S13 of sprint 1 of g-tee-oh, Phase 2 (engine validation and solution pipeline), on branch p2/toy-gates off the sprint branch sprint/1-v1. Goal: tools/validate with G1, G2 and G3 passing in the CI rust job with reports, plus the 169 by 169 equity table fixture (R2.4 to R2.6, R2.20 table part); this closes success criterion 1.

Reading order (vault root V = C:\Users\stack\vault\projects\g-tee-oh)
1. V\planning\phases\phase-2-engine-and-pipeline.md
2. V\planning\09-v1-sprint-roadmap.md sections 3, 5 (row S13), 6 (R2.4 to R2.6, R2.20) and 7
3. V\planning\00-open-questions-and-risks.md, the answered questions O-17 to O-67 (O-30, O-32, O-63 matter most)
4. V\planning\04-solver-engine.md sections 1, 2 and 6; V\planning\01-product-spec.md section 6 criterion 1
5. V\planning\architecture\A1-repo-and-conventions.md sections 1 and 2; A2-engine.md sections 1, 5 and 6; A9-quality-security-ops.md sections 1 and 2
6. V\decisions\ file 0002
7. The repo's CLAUDE.md, validation/fixtures/PROVENANCE.md, and any docs/ mirrored files that exist

Rules
- Clone C:\Users\stack\projects\g-tee-oh, Claude Code in PowerShell, native Windows Rust toolchain; WSL2 (Windows Subsystem for Linux 2) only for Linux container builds and benchmarks (O-23).
- Branch p2/toy-gates off sprint/1-v1; merge by pull request into sprint/1-v1; sprint/1-v1 reaches main only in S35 (R4.18).
- Development gates in order: plan first in plan mode and wait for my approval (trivial one-liners exempt); concrete task list; smallest working increment; tests green before advancing, never on red; /code-review and fix CRITICAL and HIGH findings; /security-review not expected here; conventional commits (feat:, fix:, chore:, refactor:, docs:, test:, perf:, ci:) ending with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Test-driven: the S05 pending tests tagged R2.4 to R2.6 turn green; 80 percent coverage or better on new code.
- Accepted ADRs (architecture decision records) are fixed; if a step would contradict one, stop and raise it. Cite O-IDs and ADR numbers wherever you use an answer or a decision.
- Privacy: nothing GTO Wizard-specific enters this repo (O-26, ADR 0017, ADR 0021). This session touches no reference data.
- A step runs as a dynamic workflow only where this prompt says so in my words. Keep every workflow under 10 agents and name what its verifier runs.
- Report honestly at every gate: show failing test output; name any skipped step.
- Any documentation you write: no em dashes or en dashes, no bold, acronyms expanded on first use, mechanism before conclusion.

Inputs
- validation/fixtures/: Kuhn, AKQ and Leduc fixtures; the OpenSpiel Leduc curve with PROVENANCE.md (version, command, seed); the validation/reports/ format (R0.11).
- The vendored engine's Kuhn and AKQ toy games (04 section 2). Leduc is not in it, so implement it as a toy game beside them in a toy module of the gto-solve crate stub from S01 (S15 adds the postflop adapter to the same crate in another module; coordinate by file, not by crate).
- The evaluator in the vendored engine, for the equity table (O-32 allows a direct dependency on it from solver-query; the table is a static fixture so that dependency is paid once here).
- Pass rules from 04 section 6: G1 Kuhn game value within 0.001 of minus 1/18 and exploitability below 0.001; G2 bluff and defense frequencies within 0.5 points of closed form (pot-sized polar bet: bettor bluffs one third of the betting range, caller defends half of the bluff-catchers); G3 within tolerance of the committed curve. No document fixes the G3 number (open, see the phase doc). Use this proposed default until the owner answers the O-ID you record: at every checkpoint iteration in the committed curve, exploitability within the larger of 0.001 absolute and 10 percent relative.

Requirements this session closes (tests copied from the phase doc)
- R2.4 G1 Kuhn poker: game value within 0.001 of minus 1/18, exploitability below 0.001. Test: tools/validate G1 report in the CI rust job.
- R2.5 G2 AKQ and toy river games match closed-form bluff and defense frequencies within 0.5 points. Test: G2 report in CI.
- R2.6 G3 Leduc exploitability curve within tolerance of the committed OpenSpiel fixture (O-30). Test: G3 report in CI.
- R2.20, table part only: the 169 by 169 preflop equity table shipped under validation/fixtures/ (O-32). Test: deterministic, symmetric where it must be, spot-checked against hand-computed all-in equities; S19 owns the rest of R2.20.

Steps
1. (single) Read everything above. Enter plan mode: the tools/validate CLI shape (subcommands per gate; Markdown and JSON reports under validation/reports/ per A2 section 6), where the toy games live, how the CI rust job runs the gates and uploads the reports, and the equity table format and path. Wait for my approval.
2. (single) Make the S05 pending tests for R2.4 to R2.6 real and red; add a red report-format test and a red equity-table test. Commit red.
3. Use a dynamic workflow for this step, under 6 agents: one agent per gate (G1 Kuhn; G2 AKQ and the toy river games; G3 Leduc with the comparison against the committed OpenSpiel curve) and one integrator for the tools/validate CLI, the CI rust job wiring and the 169 by 169 equity table; the verifier agent runs tools/validate for all three gates, checks each report against its pass rule and the report schema, and reports any failure verbatim.
4. (single) Run the CI rust job locally end to end, commit this run's three reports under validation/reports/, run /code-review and fix CRITICAL and HIGH, open the pull request into sprint/1-v1 with R2.4, R2.5, R2.6 and R2.20 in the template.

Definition of done
- [ ] G1, G2 and G3 reports pass locally and in the CI rust job on the branch, each tagged with its R ID.
- [ ] The equity table fixture exists under validation/fixtures/ with a provenance note (how it was computed).
- [ ] The G3 tolerance is recorded as a proposed O-ID in V\planning\00-open-questions-and-risks.md with the default used.
- [ ] /code-review done; CRITICAL and HIGH findings fixed.
- [ ] Pull request opened into sprint/1-v1 listing R2.4 to R2.6 and R2.20 (table part).

Report back
Your final message lists: each R ID with its test command and result; the branch and pull request link; the files written; the report paths under validation/reports/; usage notes (units used against the planned medium level, about 2); any new question as a proposed O-ID with a default, appended to V\planning\00-open-questions-and-risks.md under a new dated subsection.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| `tools/validate/` CLI with `g1`, `g2`, `g3` subcommands | public repo, branch `p2/toy-gates` |
| Leduc toy game beside Kuhn and AKQ | a `toy` module in `crates/gto-solve/` |
| G1, G2, G3 reports (Markdown and JSON) | `validation/reports/` and the CI `rust` job artifacts |
| 169 by 169 equity table with a provenance note | `validation/fixtures/` |
| Proposed O-ID for the G3 tolerance | `planning/00-open-questions-and-risks.md` in the vault |
| Pull request into `sprint/1-v1` | GitHub |
