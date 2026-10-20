---
id: 'g-tee-oh-handoff-s12-gto-model'
title: 'S12 gto-model'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 2
session: 'S12'
branch: 'p2/model'
tags: [g-tee-oh, handoff, phase-2]
---
# S12 gto-model (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-2-engine-and-pipeline|Phase 2 Engine validation and solution pipeline]]. This session produces the `gto-model` crate: the canonical encodings every later crate keys on (cards, hand indexes, canonical flops, node keys, action tokens, spot-class keys), the rake models and the bucket mapping, each backed by test vectors (R2.1 to R2.3). It runs on branch `p2/model` in parallel group B, earliest day 2 (2026-10-21), paced for week 1 ([[projects/g-tee-oh/planning/09-v1-sprint-roadmap|09 v1 sprint roadmap]] sections 4 and 5). It is a public session at high usage, and its build step runs as a dynamic workflow. Requirement identifiers (R IDs) follow 09 section 6 and open-question identifiers (O-IDs) follow 00.

## Before pasting

- [ ] S01 is merged into `sprint/1-v1`: the Cargo workspace with crate stubs, the vendored engine, continuous integration (CI) and the private-data guard exist (09 section 3).
- [ ] S05 is not required. S12 writes the two `gto-model` vectors from R0.11 (the bucket-edge table and the node-key round trip) red first inside its own session (09 section 3).
- [ ] The clone at `C:\Users\stack\projects\g-tee-oh` is on `sprint/1-v1` and clean.
- [ ] Nothing else is needed from the owner.

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull --ff-only
git switch -c p2/model
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault and append any new O-ID to `planning/00-open-questions-and-risks.md`.
2. Stay in the default permission mode, so you approve the workflow when it launches.
3. Paste the prompt below.

## The prompt

```text
Role and context
You are running session S12 of sprint 1 of g-tee-oh, Phase 2 (engine validation and solution pipeline), on branch p2/model off the sprint branch sprint/1-v1. Goal: the gto-model crate with canonical encodings, rake models and bucket mapping, each backed by test vectors (R2.1 to R2.3).

Reading order (vault root V = C:\Users\stack\vault\projects\g-tee-oh)
1. V\planning\phases\phase-2-engine-and-pipeline.md
2. V\planning\09-v1-sprint-roadmap.md sections 3, 5 (row S12), 6 (R2.1 to R2.3) and 7
3. V\planning\00-open-questions-and-risks.md, the answered questions O-17 to O-67
4. V\planning\04-solver-engine.md sections 1 to 3; V\planning\05-training-and-grading.md section 6; V\planning\08-glossary.md
5. V\planning\architecture\A1-repo-and-conventions.md; A2-engine.md sections 1, 2 and 5; A3-library-format.md section 1; A6-trainer-and-learning-engine.md section 4 (the spot-class key)
6. V\decisions\ files 0002, 0004, 0008, 0014 and 0020 (file names start with those numbers)
7. The repo's CLAUDE.md and any docs/ mirrored files that exist

Rules
- Clone C:\Users\stack\projects\g-tee-oh, Claude Code in PowerShell, native Windows Rust toolchain; WSL2 (Windows Subsystem for Linux 2) only for Linux container builds and benchmarks (O-23).
- Branch p2/model off sprint/1-v1; merge by pull request into sprint/1-v1; sprint/1-v1 reaches main only in S35 (R4.18).
- Development gates in order: plan first in plan mode and wait for my approval (trivial one-liners exempt); concrete task list; smallest working increment; tests green before advancing, never on red, and write the suite if none exists; /code-review and fix CRITICAL and HIGH findings; /security-review for anything touching auth, user input, secrets or endpoints (not expected here); conventional commits (feat:, fix:, chore:, refactor:, docs:, test:, perf:, ci:) ending with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Test-driven: red test tagged with its R ID first, then green, then refactor; 80 percent coverage or better on new code.
- Accepted ADRs (architecture decision records) are fixed; if a step would contradict one, stop and raise it. Cite O-IDs and ADR numbers wherever you use an answer or a decision.
- Privacy: nothing GTO Wizard-specific enters this repo (O-26, ADR 0017, ADR 0021). This session touches no reference data.
- A step runs as a dynamic workflow only where this prompt says so in my words. Keep every workflow under 10 agents and name what its verifier runs.
- Report honestly at every gate: show failing test output; name any skipped step.
- Any documentation you write: no em dashes or en dashes, no bold, acronyms expanded on first use, mechanism before conclusion.

Inputs
- The vendored engine at crates/vendor/postflop-engine, for cross-checking card and evaluator conventions only; gto-model must not depend on it or on gto-solve (A1 section 2).
- A3 section 1: rank and suit characters, the 169-class order (pairs, then suited, then offsuit), the 1,326-combo order, action tokens, the node-key grammar and its example.
- A2 section 2 types; chips as integer centi-big-blinds (cbb) outside the solver internals.
- R0.11's bucket-edge table: 25, 50, 75, 110 and 150 percent of pot, upper edge inclusive, all-in separate.
- Stake facts: live 1/3 with a $5 cap gives 167 cbb; live 2/5 with the $5 default gives 100 cbb (O-2, O-66); one online profile (ADR 0014).

Requirements this session closes (tests copied from the phase doc)
- R2.1 gto-model canonical encodings with test vectors: cards, 169-class and 1,326-combo indexes, canonical flop with multiplicity weights summing to 22,100, node key round trip, action tokens, spot-class key. Test: unit tests on the vectors; proptest node-key round trip, suit-permutation invariance, weight sum.
- R2.2 Rake models: one online profile; live 10 percent to the stake's cap in cbb, no flop no drop (ADR 0014); configurations keyed by stake. Test: 1/3 at a $5 cap gives 167 cbb; 2/5 at the $5 default gives 100 cbb; no rake at a preflop terminal; the same action at 1/3 and 2/5 yields a different config_id.
- R2.3 Bucket mapping with contiguous edges, upper edge inclusive, all-in separate (ADR 0008); the only implementation of this poker number (ADR 0004). Test: the R0.11 bucket-edge table passes at every edge, one tick above, and all-in.

Steps
1. (single) Read everything above. Enter plan mode and write the plan: the crate's module layout (cards and indexes; board isomorphism; keys and tokens; rake and buckets), the public types from A2 section 2, the vectors each module needs, and the two R0.11 vectors that must exist red before any green. Wait for my approval.
2. (single) Create crates/gto-model with the module stubs and the pending tests tagged R2.1, R2.2 and R2.3, plus the R0.11 tags on the bucket-edge table and the node-key round trip. Commit red.
3. Use a dynamic workflow for this step, under 6 agents: one agent per module (cards and indexes; board isomorphism with the 1,755 canonical flops and their weights; node keys, action tokens and spot-class keys; rake models and bucket mapping), each turning its own red vectors green without touching another module's files, plus one integrator that owns the shared types; the verifier agent runs cargo test -p gto-model, cargo clippy with warnings as errors, and the proptest suite (node-key round trip, suit-permutation invariance, weight sum 22,100), and reports any red test verbatim.
4. (single) Integrate, run the workspace tests and fmt, measure coverage on the new crate, run /code-review and fix CRITICAL and HIGH, commit, open the pull request into sprint/1-v1 with R2.1 to R2.3 in the template.

Definition of done
- [ ] R2.1, R2.2 and R2.3 tests green, each tagged with its R ID; the two R0.11 vectors green with their tags.
- [ ] cargo tree -p gto-model shows neither gto-solve nor the vendored engine.
- [ ] CI rust job green on the branch; coverage of the new crate at 80 percent or better.
- [ ] /code-review done; CRITICAL and HIGH findings fixed.
- [ ] Pull request opened into sprint/1-v1 listing R2.1 to R2.3.

Report back
Your final message lists: each R ID with its test command and result; the branch and pull request link; the files written; the vectors added and where they live; usage notes (units used against the planned high level, about 3); any new question as a proposed O-ID with a default, appended to V\planning\00-open-questions-and-risks.md under a new dated subsection.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| `crates/gto-model/` with modules for cards and indexes, isomorphism, keys and tokens, rake and buckets | public repo, branch `p2/model` |
| Test vectors and proptest suites tagged R2.1 to R2.3, and the two R0.11 vectors | `crates/gto-model/tests/` |
| Pull request into `sprint/1-v1` | GitHub |
| Any new O-ID | `planning/00-open-questions-and-risks.md` in the vault |
