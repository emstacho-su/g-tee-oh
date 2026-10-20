---
id: 'g-tee-oh-handoff-s20-deploy-1'
title: 'S20 Deploy 1'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 2
session: 'S20'
branch: 'p2/deploy-1'
tags: [g-tee-oh, handoff, phase-2]
---
# S20 Deploy 1 (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-2-engine-and-pipeline|Phase 2 Engine validation and solution pipeline]]. This session closes Phase 2: the first real build on the Zenbook with `library-builder --once` from the packed first configuration (O-41), then Deploy 1 on the Mac with the owner's explicit yes (Postgres, SeaweedFS and the builder, images built there, the reference library imported, a nightly backup, the builder started on the O-52 line), the Mac rerun of the push/fold spike (R2.21 Mac part), and the Deploy 1 report that is also the Phase 2 gate report (R2.22). It runs on branch `p2/deploy-1` in parallel group F, earliest day 9 (2026-10-28), paced for week 3 at about day 21 (2026-11-09) ([[projects/g-tee-oh/planning/09-v1-sprint-roadmap|09 v1 sprint roadmap]] sections 4 and 5). It is a public single session (no workflow) at medium usage with the owner present. It has two sittings on two machines: sitting 1 on the Zenbook in PowerShell, sitting 2 on the Mac in zsh (O-59). Nothing deploys without the explicit yes at that moment (O-20). Requirement identifiers (R IDs) follow 09 section 6 and open-question identifiers (O-IDs) follow 00.

## Before pasting

- [ ] S04 has landed: `validation/reports/mac-bootstrap.md` exists on `sprint/1-v1` and passes the O-50 rule (R0.9, O-47, O-67; 09 section 3).
- [ ] S17 passed G4 (its report is in the private repo; have the path at hand) and S18's builder image builds for arm64 (09 section 3: "G4 passed, builder image, spike").
- [ ] S19 is merged: the Zenbook spike report and the fixture library exist.
- [ ] S12 to S19 are all merged into `sprint/1-v1`.
- [ ] The first configuration is packed with its sizing convention row (S10, R1.7, O-37), or you accept the O-61 smoke build on the synthetic 6-max ranges.
- [ ] The Mac: Docker running with the virtual machine at 10 GB and all but 2 cores, sleep prevented on power, the external drive attached, the clone at `~/projects/g-tee-oh` (O-20, O-59). `.env` values ready to fill (A9 section 3; never committed).
- [ ] The medium for importing the packed reference library onto the Mac is your choice (open, see the problems list in the Phase 2 plan); the external drive is the proposed default.
- [ ] The vault is not on the Mac unless you sync it; sitting 2 reads the phase doc and this handoff from the `docs/` mirror (O-45), and any new O-ID is appended from the Zenbook afterwards (open, see the problems list).

## How to start

Sitting 1, Zenbook:

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull --ff-only
git switch -c p2/deploy-1
claude
```

Sitting 2, Mac (the branch already exists from sitting 1, so switch rather than create):

```zsh
cd ~/projects/g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull --ff-only
git switch p2/deploy-1
git pull --ff-only
claude
```

1. On the Zenbook, run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault and append any new O-ID to `planning/00-open-questions-and-risks.md`. On the Mac, skip this and rely on `docs/`.
2. Stay in the default permission mode, so every deploy action is approved by you.
3. Paste the prompt below, then on the next line type "Sitting 1" or "Sitting 2".

## The prompt

```text
Role and context
You are running session S20 of sprint 1 of g-tee-oh, Phase 2 (engine validation and solution pipeline), on branch p2/deploy-1 off the sprint branch sprint/1-v1. Goal: the first real build on the Zenbook, then Deploy 1 on the Mac with my explicit yes, the Mac spike rerun, and the Deploy 1 report that closes the Phase 2 gate (R2.21 Mac part, R2.22). This session has two sittings on two machines; my next line after this prompt says which one this is. Do only that sitting's steps.

Reading order (vault root V = C:\Users\stack\vault\projects\g-tee-oh on the Zenbook; on the Mac read the same files under docs/ in the repo)
1. V\planning\phases\phase-2-engine-and-pipeline.md (Instruments and Definition of Done)
2. V\planning\09-v1-sprint-roadmap.md sections 2 (the Phase 2 gate row), 3, 5 (row S20), 6 (R2.21, R2.22, R1.7) and 7
3. V\planning\00-open-questions-and-risks.md, the answered questions O-17 to O-67 (O-20, O-41, O-46, O-48 to O-52, O-59, O-61, O-67 matter most)
4. V\planning\02-architecture.md sections 5.2 and 6; V\planning\04-solver-engine.md section 7
5. V\planning\architecture\A9-quality-security-ops.md sections 3 to 6; A1-repo-and-conventions.md section 6; A5-services-and-interfaces.md section 1; A4-data-model.md section 3
6. V\decisions\ files 0018, 0019 and 0023
7. The repo's CLAUDE.md, infra/compose/, validation/reports/mac-bootstrap.md, validation/reports/bench-flop-line-zenbook.md, validation/reports/spike-preflop-zenbook.md

Rules
- Sitting 1 on the Zenbook (clone C:\Users\stack\projects\g-tee-oh, PowerShell; the --once run is a Windows Subsystem for Linux 2 (WSL2) container under a 5 GB limit, O-23, O-48). Sitting 2 on the Mac (clone ~/projects/g-tee-oh, zsh, O-59). The Zenbook never deploys remotely.
- Branch p2/deploy-1 off sprint/1-v1; merge by pull request into sprint/1-v1 after Deploy 1; sprint/1-v1 reaches main only in S35 (R4.18).
- Development gates: plan first in plan mode and wait for my approval; concrete task list; one operation at a time; every check green before the next, never advance on red; /code-review on any code or compose change; /security-review on the Mac compose profile and .env handling (secrets, resource limits, non-root containers, A9 section 3); conventional commits (chore:, ci:, docs:, fix:) ending with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Accepted ADRs (architecture decision records) are fixed; if a step would contradict one, stop and raise it. Cite O-IDs and ADR numbers wherever you use an answer.
- Privacy: nothing GTO Wizard-specific enters the public repo (O-26, ADR 0017, ADR 0021). The reference library is imported into the Mac's reference-private bucket from the medium I name; its contents never appear in the report beyond counts of solutions and bytes.
- Explicit-yes stop (O-20): building images and filling .env are preparation. just mac-up, applying migrations on the Mac, importing data, installing the backup job and starting the builder are deploy actions. Before the first deploy action, stop and ask me exactly: "Deploy 1 now? Reply yes to proceed." Proceed only on my literal reply "yes". Any other reply means wait.
- No dynamic workflow in this session; 09 section 5 marks it single.
- Report honestly: every measurement is a real number from this run; a pass rule that fails is written as failed, with the number.
- The report you write: no em dashes or en dashes, no bold, acronyms expanded on first use, mechanism before conclusion.

Inputs
- Sitting 1: the packed first configuration and its sizing convention row (R1.7, O-37); if absent, the synthetic 6-max ranges from S19 for an O-61 smoke build under a smoke/ prefix. The S18 builder image and bench. The S19 spike report.
- Sitting 2: the arm64 build cache warmed by S04; the compose mac profile (A1 section 6) with resource limits from 02 section 6.2 (Postgres 1 GB, SeaweedFS 0.5 GB, builder 5 GB cap); Deploy 1 runs Postgres, SeaweedFS and library-builder only, no solver-query (O-46); the builder's first line is online 6-max 100 big blinds (bb), button versus big blind single-raised pot (O-52); K from O-14; the backup to the external drive (A9 section 5).
- Pass rules: O-50 for the flop solve (peak resident set size, RSS, under 5 GB and under 30 minutes to 0.3 percent pot per preflop line); O-51 for storage (projection at K = 20 for the top pair over all 1,755 flops plus 184-flop subsets at K = 10 for the next pairs inside 650 GB; lower K before narrowing flops); O-49 and O-48 for the spike rerun.

Requirements this session closes (tests copied from the phase doc)
- R2.21, Mac part: the push/fold spike rerun on the Mac inside the 5 GB cap, with the result added to the spike report per machine against the O-49 pass rule.
- R2.22 First real build on the Zenbook with --once from the packed first configuration (O-41), then Deploy 1 with my explicit yes: images built on the Mac, Postgres, SeaweedFS and the builder up, reference library imported, nightly backup job, builder started on the first line (O-52) inside the 5 GB cap (O-20). Test: Deploy 1 report with one published build at target exploitability, per-container peak RSS against the 02 section 6.2 budget, bytes per runout and the projection against 650 GB (O-51), K written to builder_setting, a coverage row and a notify observed, the first backup present with one solution restored from it.

Steps, sitting 1 (Zenbook)
1. (single) Plan mode: confirm every p2 branch is merged into sprint/1-v1; confirm validation/reports/mac-bootstrap.md exists and passes O-50; confirm G4 passed (I give you the private report path) and G6a is green in continuous integration (CI); list the sitting 1 and sitting 2 checks. Wait for my approval.
2. (single) Run library-builder --once in the compose dev profile under a 5 GB WSL2 Docker limit against the packed first configuration (O-41). Record the published build, its exploitability per player, iterations, peak RSS, seconds per line and bytes per runout. If no configuration is packed, run the O-61 smoke build on the synthetic 6-max ranges under smoke/, record the same numbers, delete the smoke/ prefix and its rows, and say so in the report.
3. (single) Write the sitting 1 section of validation/reports/phase-2-gate.md, commit, push the branch. Stop: "Sitting 1 done; move to the Mac."

Steps, sitting 2 (Mac)
4. (single) Plan mode: read the sitting 1 section; list the deploy actions in order. Wait for my approval. Build the images locally on the Mac (arm64); fill .env with me from .env.example; run /security-review on the mac profile. These are preparation, not deploy actions.
5. (single) STOP and ask: "Deploy 1 now? Reply yes to proceed." Continue only on "yes".
6. (single) just mac-up with Postgres, SeaweedFS and library-builder; apply migrations and the catalog seed; import the reference library into reference-private from the medium I name; install the nightly backup job to the external drive; write K to builder_setting (O-14); queue and start the O-52 line inside the 5 GB cap; wait for one published build at target exploitability; observe the solution and scenario rows, the coverage row and NOTIFY coverage_added.
7. (single) Rerun the push/fold spike in the builder container under the 5 GB cap; write validation/reports/spike-preflop-mac.md with the Mac numbers against O-49 and O-48 (R2.21).
8. (single) Measure per-container peak RSS against 02 section 6.2, bytes per runout, the O-51 projection; run the first backup and restore one solution from it on the Mac; finish validation/reports/phase-2-gate.md with the Phase 2 gate checklist from the phase doc; leave the builder running; commit, push, open the pull request into sprint/1-v1 with R2.21 and R2.22 in the template.

Definition of done
- [ ] Sitting 1: one --once build (real or O-61 smoke, stated which) with its numbers in the report; the S04 report and the G4 and G6a results checked.
- [ ] Sitting 2: my literal "yes" recorded with its time in the report before any deploy action; Postgres, SeaweedFS and the builder healthy on the Mac; the reference library imported; the backup job installed and the first backup restored once.
- [ ] One published build on the O-52 line at target exploitability inside 5 GB within the O-50 time rule; the O-51 projection inside 650 GB or K lowered and the new projection recorded.
- [ ] validation/reports/spike-preflop-mac.md exists with the Mac numbers (R2.21).
- [ ] validation/reports/phase-2-gate.md carries every Phase 2 gate condition with pass or fail and the numbers; the builder is left running.
- [ ] /code-review and /security-review done; pull request opened into sprint/1-v1 listing R2.21 and R2.22.

Report back
Your final message lists: R2.21 and R2.22 with the commands run and their results; the branch and pull request link; the report path; the time of my "yes"; the Mac numbers (peak RSS per container, seconds per line, bytes per runout, projection, spike); anything that failed its rule; usage notes (units used against the planned medium level, about 2); any new question as a proposed O-ID with a default, to be appended to V\planning\00-open-questions-and-risks.md under a new dated subsection (from the Zenbook if this is sitting 2).
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| Deploy 1 report, which is also the Phase 2 gate report | `validation/reports/phase-2-gate.md` |
| Mac spike report (R2.21) | `validation/reports/spike-preflop-mac.md` |
| Running stack: Postgres, SeaweedFS, `library-builder` on the O-52 line | the Mac, compose `mac` profile |
| Imported reference library and the first nightly backup | the Mac's `reference-private` bucket and the external drive |
| `K` in `builder_setting`, one `solution` row, `scenario` rows, a coverage row | the Mac's Postgres |
| Pull request into `sprint/1-v1` | GitHub |
| Any new O-ID | `planning/00-open-questions-and-risks.md` in the vault, from the Zenbook |
