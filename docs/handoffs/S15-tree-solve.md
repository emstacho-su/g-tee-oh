---
id: 'g-tee-oh-handoff-s15-tree-solve'
title: 'S15 Tree and solve adapter'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 2
session: 'S15'
branch: 'p2/tree-solve'
tags: [g-tee-oh, handoff, phase-2]
---
# S15 Tree and solve adapter (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-2-engine-and-pipeline|Phase 2 Engine validation and solution pipeline]]. This session produces the `gto-tree` crate (preflop tree from a sizing convention spec, postflop tree config with at most one size per bucket per node, canonical tree hash) and the heads-up postflop solve adapter in `gto-solve` over the vendored engine (`estimate_bytes`, stop rule, progress sink, 16-bit default, exact best response), joined by one integration test (R2.9, R2.10). It runs on branch `p2/tree-solve` in parallel group C, earliest day 3 (2026-10-22), paced for week 2 ([[projects/g-tee-oh/planning/09-v1-sprint-roadmap|09 v1 sprint roadmap]] sections 4 and 5). It is a public single session (no workflow) at medium usage. Requirement identifiers (R IDs) follow 09 section 6 and open-question identifiers (O-IDs) follow 00.

## Before pasting

- [ ] S12 is merged into `sprint/1-v1`: `gto-model` provides the game config, bucket and node-key types (09 section 3).
- [ ] S01's vendored engine builds in continuous integration (CI) (R0.2).
- [ ] Practical input, not a 09 section 3 edge: the placeholder sizing convention rows from S02's catalog seed (R0.6), so the integration test can build a tree from a real row. If S02 has not landed, the test uses a hand-made spec.
- [ ] The clone at `C:\Users\stack\projects\g-tee-oh` is on `sprint/1-v1` and clean.

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull --ff-only
git switch -c p2/tree-solve
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault and append any new O-ID to `planning/00-open-questions-and-risks.md`.
2. Stay in the default permission mode.
3. Paste the prompt below.

## The prompt

```text
Role and context
You are running session S15 of sprint 1 of g-tee-oh, Phase 2 (engine validation and solution pipeline), on branch p2/tree-solve off the sprint branch sprint/1-v1. Goal: gto-tree and the heads-up postflop solve adapter over the vendored engine, with one integration test joining them (R2.9, R2.10).

Reading order (vault root V = C:\Users\stack\vault\projects\g-tee-oh)
1. V\planning\phases\phase-2-engine-and-pipeline.md
2. V\planning\09-v1-sprint-roadmap.md sections 3, 5 (row S15), 6 (R2.9, R2.10, R1.6, R0.6) and 7
3. V\planning\00-open-questions-and-risks.md, the answered questions O-17 to O-67 (O-22, O-48, O-50 matter most)
4. V\planning\04-solver-engine.md sections 1 to 3; V\planning\05-training-and-grading.md section 6 (buckets and simple trees); V\planning\02-architecture.md sections 3.2 and 6.2
5. V\planning\architecture\A2-engine.md sections 1 to 3 and 5; A3-library-format.md section 1; A4-data-model.md section 2 (sizing_convention and game_config); A1-repo-and-conventions.md sections 2 and 5
6. V\decisions\ files 0002, 0008, 0015, 0020 and 0023
7. The repo's CLAUDE.md, crates/vendor/postflop-engine/UPSTREAM.md, and any docs/ mirrored files that exist

Rules
- Clone C:\Users\stack\projects\g-tee-oh, Claude Code in PowerShell, native Windows Rust toolchain; WSL2 (Windows Subsystem for Linux 2) only for Linux container builds and benchmarks (O-23).
- Branch p2/tree-solve off sprint/1-v1; merge by pull request into sprint/1-v1; sprint/1-v1 reaches main only in S35 (R4.18).
- Development gates in order: plan first in plan mode and wait for my approval (trivial one-liners exempt); concrete task list; smallest working increment; tests green before advancing, never on red; /code-review and fix CRITICAL and HIGH findings; /security-review not expected here; conventional commits (feat:, fix:, chore:, refactor:, docs:, test:, perf:, ci:) ending with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Test-driven: red test tagged with its R ID first, then green, then refactor; 80 percent coverage or better on new code.
- Accepted ADRs (architecture decision records) are fixed; if a step would contradict one, stop and raise it. Cite O-IDs and ADR numbers wherever you use an answer or a decision. ADR 0015 caps postflop at heads-up in v1, ADR 0020 caps sizes at one per bucket per node, ADR 0023 means every flop solve treats the turn and river as unknown.
- Privacy: nothing GTO Wizard-specific enters this repo (O-26, ADR 0017, ADR 0021). Sizing conventions arrive later as database rows, never as repo files (A4 section 3); this session uses placeholder and hand-made specs only.
- No dynamic workflow in this session; 09 section 5 marks it single.
- Report honestly at every gate: show failing test output; name any skipped step.
- Any documentation you write: no em dashes or en dashes, no bold, acronyms expanded on first use, mechanism before conclusion.

Inputs
- The vendored engine's tree config (per-street bet and raise sizes, donk sizes, all-in threshold, raise cap), its discounted counterfactual regret minimization (DCFR) solver, its best-response calculator and its 16-bit storage mode (04 section 2).
- A2 section 2 types: TreeConfig, tree_hash, PostflopProblem, StopRule, SolveReport, ProgressSink, estimate_bytes, solve_postflop, best_response. Chips in centi-big-blinds (cbb).
- The sizing convention spec: the sizing_convention.spec JSON column (A4 section 2) whose JSON Schema no document assigns an owner (open, see the Phase 2 plan's problems list). Proposed default: this session writes packages/contracts/schemas/sizing-convention.json as gto-tree's input contract and validates S02's placeholder rows against it; record that as a proposed O-ID.
- The memory cap: 5 GB on the Mac (O-20), emulated by a 5 GB Docker limit in WSL2 (O-48); the flop-solve pass rule in O-50 is measured later (S18, S20), not here.

Requirements this session closes (tests copied from the phase doc)
- R2.9 gto-tree: preflop tree from a sizing convention spec, postflop tree config with at most one size per bucket per node, canonical tree hash. Test: proptest never two sizes in one bucket at a node (ADR 0020); insta golden for the hash, stable across machines.
- R2.10 Heads-up postflop solve adapter over the vendored engine: estimate_bytes, stop rule, progress sink, 16-bit default, exact best response. Test: integration test where a small flop solve reaches target and a problem above the cap is refused before allocation.

Steps
1. (single) Read everything above. Enter plan mode: gto-tree's spec types and schema, the preflop tree builder, the postflop TreeConfig per street, the canonical description the hash is computed over (so it is stable across x86 and arm64), the adapter's mapping from PostflopProblem to the vendor's config, how estimate_bytes is derived (node count times per-node bytes at 16-bit), and the two integration cases. Wait for my approval.
2. (single) gto-tree red first: the proptest (no two sizes in one bucket at any node), the insta golden hash on a fixed spec, the preflop tree shape test from a placeholder convention, the schema validation test. Then green, then refactor.
3. (single) Adapter red first in crates/gto-solve (postflop module; the toy module is S13's): a small flop solve (a tiny tree, two sizes, a target of 0.3 percent pot) reaches target and reports iterations, exploitability for both players, peak bytes and seconds through the ProgressSink; a problem whose estimate_bytes exceeds a tiny test cap is refused before any allocation. Then green with 16-bit storage as the default and the exact best response in the report, then refactor.
4. (single) The joining integration test: build a TreeConfig from a sizing convention spec with gto-tree, solve the small flop with the adapter, assert the tree hash in the SolveReport matches gto-tree's hash. Run the workspace tests, fmt and clippy.
5. (single) Run /code-review and fix CRITICAL and HIGH, commit, open the pull request into sprint/1-v1 with R2.9 and R2.10 in the template.

Definition of done
- [ ] R2.9 and R2.10 tests green and tagged; the insta golden hash committed.
- [ ] The sizing convention JSON Schema exists and the proposed O-ID about its ownership is recorded in V\planning\00-open-questions-and-risks.md.
- [ ] cargo tree shows gto-tree depending only on gto-model; gto-solve depends on gto-model, gto-tree and the vendored engine (A1 section 2).
- [ ] CI rust job green; coverage of the two crates at 80 percent or better.
- [ ] /code-review done; CRITICAL and HIGH findings fixed.
- [ ] Pull request opened into sprint/1-v1 listing R2.9 and R2.10.

Report back
Your final message lists: each R ID with its test command and result; the branch and pull request link; the files written; the small flop solve's iterations, exploitability, peak bytes and seconds; usage notes (units used against the planned medium level, about 2); any new question as a proposed O-ID with a default, appended to V\planning\00-open-questions-and-risks.md under a new dated subsection.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| `crates/gto-tree/` with the spec types, preflop and postflop builders and `tree_hash` | public repo, branch `p2/tree-solve` |
| Heads-up postflop adapter module in `crates/gto-solve/` | public repo |
| `packages/contracts/schemas/sizing-convention.json` (proposed owner, see the problems list) | public repo |
| proptest, insta golden and the integration test tagged R2.9, R2.10 | `crates/gto-tree/tests/`, `crates/gto-solve/tests/` |
| Proposed O-ID on schema ownership | `planning/00-open-questions-and-risks.md` in the vault |
| Pull request into `sprint/1-v1` | GitHub |
