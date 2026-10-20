---
id: 'g-tee-oh-handoff-s17-g4-oracle'
title: 'S17 G4 oracle'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 2
session: 'S17'
branch: 'p2/g4-oracle (private repo) and p2/validate-g4 (public)'
tags: [g-tee-oh, handoff, phase-2]
---
# S17 G4 oracle (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-2-engine-and-pipeline|Phase 2 Engine validation and solution pipeline]]. This session produces gate G4: a small private Rust program that links the GNU Affero General Public License (AGPL) oracle crate for private use only and emits a generic oracle dump, a public `tools/validate g4` step that compares the own engine's heads-up river and turn solves against that dump, and the G4 report (R2.11). It runs in the private capture repo on branch `p2/g4-oracle` and in the public repo on branch `p2/validate-g4`, in parallel group D, earliest day 4 (2026-10-23), paced for week 3 ([[projects/g-tee-oh/planning/09-v1-sprint-roadmap|09 v1 sprint roadmap]] sections 4 and 5). It is a single session (no workflow) at medium usage. It lives in the private repo only because of the AGPL boundary set by architecture decision record (ADR) 0002 and O-31, and carries no capture detail, so this handoff is public-safe (O-43). G4 passing is what lets the builder start on the Mac (S17 blocks S20). Requirement identifiers (R IDs) follow 09 section 6 and open-question identifiers (O-IDs) follow 00.

## Before pasting

- [ ] S13 is merged into `sprint/1-v1`: `tools/validate` and the report format exist (09 section 3).
- [ ] S15 is merged: the heads-up postflop solve adapter is what G4 compares (09 section 3).
- [ ] The private capture repo exists at `C:\Users\stack\projects\g-tee-oh-capture` (S03, O-28), because the oracle program lives there (O-31). No capture tooling is touched.
- [ ] The oracle crate source (b-inary/postflop-solver, AGPL) can be fetched into the private repo at a pinned version. The second oracle named in 04 section 2 is C++ and cannot be linked as a crate (open, see the problems list in the Phase 2 plan; the prompt says what to do).
- [ ] Both clones are on their sprint branch and clean.

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull --ff-only
git switch -c p2/validate-g4
cd C:\Users\stack\projects\g-tee-oh-capture
git fetch origin
# use the private repo's default branch here if S03 made no sprint/1-v1 branch (open, see the problems list)
git switch sprint/1-v1
git pull --ff-only
git switch -c p2/g4-oracle
cd C:\Users\stack\projects\g-tee-oh
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault and append any new O-ID to `planning/00-open-questions-and-risks.md`, and `/add-dir C:\Users\stack\projects\g-tee-oh-capture` so it can write the private oracle program.
2. Stay in the default permission mode.
3. Paste the prompt below.

## The prompt

```text
Role and context
You are running session S17 of sprint 1 of g-tee-oh, Phase 2 (engine validation and solution pipeline), on branch p2/validate-g4 in the public repo and p2/g4-oracle in the private capture repo, both off their sprint/1-v1. Goal: gate G4, heads-up river and turn spots from the own engine compared against a local AGPL oracle through a private program that emits a generic dump, with a public compare step and a privately stored report (R2.11).

Reading order (vault root V = C:\Users\stack\vault\projects\g-tee-oh)
1. V\planning\phases\phase-2-engine-and-pipeline.md
2. V\planning\09-v1-sprint-roadmap.md sections 3, 5 (row S17), 6 (R2.11) and 7, and section 10's erratum on 04 section 2
3. V\planning\00-open-questions-and-risks.md, the answered questions O-17 to O-67 (O-31, O-43 matter most)
4. V\planning\04-solver-engine.md sections 2 and 6
5. V\planning\architecture\A2-engine.md sections 3 and 6; A1-repo-and-conventions.md sections 2 and 4; A9-quality-security-ops.md section 2 (the licenses job)
6. V\decisions\ files 0002 and 0017
7. Both repos' CLAUDE.md and any docs/ mirrored files that exist

Rules
- Public clone C:\Users\stack\projects\g-tee-oh and private clone C:\Users\stack\projects\g-tee-oh-capture (O-28), Claude Code in PowerShell, native Windows Rust toolchain; WSL2 (Windows Subsystem for Linux 2) only for Linux container builds and benchmarks (O-23).
- Branches p2/validate-g4 (public) off sprint/1-v1 and p2/g4-oracle (private) off the private repo's sprint branch, or its default branch if S03 made none; merge by pull request; the public sprint/1-v1 reaches main only in S35 (R4.18).
- Development gates in order: plan first in plan mode and wait for my approval; concrete task list; smallest working increment; tests green before advancing, never on red; /code-review and fix CRITICAL and HIGH findings; /security-review not expected here; conventional commits (feat:, fix:, chore:, refactor:, docs:, test:, perf:, ci:) ending with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Test-driven: red test tagged R2.11 first, then green, then refactor; 80 percent coverage or better on the public compare step.
- Accepted ADRs (architecture decision records) are fixed. ADR 0002: the AGPL crate is never vendored, linked, imported or required by anything in the public repo; the public licenses job must stay green. If a step would contradict an ADR, stop and raise it. Cite O-IDs and ADR numbers wherever you use an answer.
- Privacy and the boundary: the private repo is used only for the AGPL link (O-31, O-43). Do not touch, read or reference capture tooling, captured data or the capture schema. Nothing from the oracle crate's source enters the public repo. The oracle dump and the G4 report stay in the private repo (09 section 7); the public repo gets only the generic compare step, the hand-made spot list and a one-line pass note.
- No dynamic workflow in this session; 09 section 5 marks it single.
- Report honestly at every gate: show failing test output; name any skipped step.
- Any documentation you write: no em dashes or en dashes, no bold, acronyms expanded on first use, mechanism before conclusion.

Inputs
- The solve adapter from S15 (PostflopProblem, StopRule, best_response) and tools/validate from S13 with its report format.
- The node-dump JSON schema in packages/contracts/schemas/ (R0.7, S14), which the oracle dump must satisfy so the compare step stays generic.
- Pass rule (04 section 6): both sides at 0.3 percent pot exploitability or better, mean absolute frequency difference per hand under 2 points, root expected value (EV) within 0.3 percent of pot.
- Oracle: b-inary/postflop-solver as a crate at a pinned version. The C++ oracle named in 04 section 2 cannot be linked; proposed default, pending the owner's answer: one crate oracle satisfies R2.11, and the binary oracle is optional when installed. Record that as a proposed O-ID.

Requirements this session closes (test copied from the phase doc)
- R2.11 G4: heads-up river and turn spots versus the local oracles through a private Rust program linking the AGPL crates (O-31), which emits a generic oracle dump; a public tools/validate g4 step compares. Test: G4 report (both sides at 0.3 percent pot or better, mean absolute frequency difference under 2 points, root EV within 0.3 percent pot), stored privately.

Steps
1. (single) Read everything above. Enter plan mode: the spot list (a hand-made set of heads-up river and turn spots with ranges, pot, stacks and a simple tree, at least four river and four turn spots, none derived from reference data), the oracle program's shape, the dump path, the compare algorithm and the report layout. Wait for my approval.
2. (single, public clone) Write the spot list to validation/fixtures/g4-spots.json and the tools/validate g4 compare step with a red test tagged R2.11 on a tiny hand-made pair of dumps (engine side, oracle side) that exercises all three rules, including a failing pair. Turn it green. Commit on p2/validate-g4.
3. (single, private clone) On p2/g4-oracle, write the oracle program: it depends on the pinned oracle crate, reads validation/fixtures/g4-spots.json from the public clone by path, solves each spot to 0.3 percent pot or better, and writes a generic oracle dump in the node-dump schema. Add a provenance note with the crate name, version and commit. Commit.
4. (single) Run tools/validate g4 with the engine solve (the public step drives the S15 adapter) and the oracle dump. Write the G4 report into the private repo's reports folder. If any spot fails a rule, investigate the adapter and the tree mapping first; never loosen the rule or drop a spot without telling me.
5. (single) Pull requests in both repos. The public one carries the compare step, the spot list, the test and a one-line note "G4 passed on <date>; report in the private repo". Run /code-review on both; fix CRITICAL and HIGH.

Definition of done
- [ ] The G4 report exists in the private repo and every spot passes the three rules.
- [ ] The public tools/validate g4 step and its R2.11 test are green; the public licenses job is green (no AGPL crate anywhere in the public workspace).
- [ ] The provenance note (oracle crate, version, commit) is in the private repo.
- [ ] The proposed O-ID about the second oracle is recorded in V\planning\00-open-questions-and-risks.md.
- [ ] /code-review done in both repos; pull requests opened into each sprint/1-v1 listing R2.11.

Report back
Your final message lists: R2.11 with the compare command, the per-spot numbers and the result; both branches and pull request links; the files written in each repo; the private report path (so S20 can cite it); usage notes (units used against the planned medium level, about 2); any new question as a proposed O-ID with a default, appended to V\planning\00-open-questions-and-risks.md under a new dated subsection.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| `validation/fixtures/g4-spots.json`, hand-made heads-up river and turn spots | public repo, branch `p2/validate-g4` |
| `tools/validate g4` compare step and its R2.11 test | public repo |
| Oracle program linking the pinned AGPL crate, plus its provenance note | private capture repo, branch `p2/g4-oracle` |
| Generic oracle dump (node-dump schema) and the G4 report | private capture repo reports folder |
| Proposed O-ID on the second oracle | `planning/00-open-questions-and-risks.md` in the vault |
| Two pull requests, one per repo | GitHub |
