---
id: 'g-tee-oh-planning-10-traceability'
title: '10 Traceability'
collection: 'g-tee-oh'
type: planning
status: 'ready'
created: 2026-10-19
public: true
tags: [g-tee-oh, planning, sprint-1]
---
# 10 Traceability

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/09-v1-sprint-roadmap|09 v1 sprint roadmap]]. This file is the Step 3 verification of the five phase docs and the 35 handoffs. Every chain below was rebuilt from the phase docs and handoffs themselves, then compared with 09; where 09 differs, the difference is listed in section 6. Requirement identifiers (R IDs) come from 09 section 6, open-question identifiers (O-IDs) from [[projects/g-tee-oh/planning/00-open-questions-and-risks|00 Open questions and risks]], and architecture decision records (ADRs) from the [[projects/g-tee-oh/decisions/_README|ADR index]]. Continuous integration is written CI, quality assurance QA, expected value EV, the 95th percentile latency p95, and GTO Wizard is named only as the product being emulated (GTO stands for game theory optimal). The owner's reply to the writer reports was "defaults for all, I see no issues" (2026-10-19), so every proposed default in section 6 stands until planning/00 carries it under its number.

## 1. Summary

| Check | Result | Specifics |
|---|---|---|
| 1 Criterion to requirement to handoff to test | pass | All eleven criteria chain to at least one R ID, one handoff and a named artifact in that handoff's definition of done (section 2) |
| 2 Requirement IDs | pass | 85 R IDs (12, 11, 22, 22, 18) each appear in exactly one phase doc with the 09 statement and test; none added, dropped, merged or renumbered; R0.3 is split across S01, S02 and S06 without renumbering |
| 3 Definitions of done | pass | Each phase doc's Definition of Done covers every R ID of its phase; every closing handoff carries a checkbox naming the proof |
| 4 Phase doc sections | pass | All five docs have exactly MVP (minimum viable product), Scope, Blockers/Constraints, Inputs, Instruments, Requirements, Definition of Done, in that order |
| 5 Handoff shape | pass | 35 files S01 to S35, no duplicates, full frontmatter with one visibility flag each; S03 and S07 to S11 private; S17 public and marked as running in the private repo; S20 and S34 carry the explicit-yes stop; S09 carries the first-run and daily check-in prompts; branches and workflow or single marks match 09 section 5 |
| 6 Dependencies | pass | No handoff starts before a session that 09 section 3 says blocks it; S10 and S11 add two practical preconditions 09 does not list (section 6) |
| 7 ADRs and O-17 to O-67 | pass | No handoff contradicts an accepted ADR or an answered question; 33 proposed O-IDs are registered in section 6; the ADR index still shows 0004 and 0013 as Proposed, which O-25 asks Step 3 to fix |
| 8 Privacy | pass | Every hit in a public file is a category word inside a privacy rule or an owner screenshot of the local app; no route, payload, code, tier, method, tool name or volume in any public file |
| 9 Style | pass | No em or en dash, no bold, every wikilink in full form and resolving; AKQ is unexpanded in two public files (minor) |
| 10 Public-safe existing files | reported | Section 5 lists the files checked with the check 8 patterns that qualify as they stand; 01, 02, 05, 07, 08, A9 and 00 do not |

## 2. Criterion to requirement to handoff to test

Criteria are shortened from [[projects/g-tee-oh/planning/01-product-spec|01 Product spec]] section 6. Each artifact is named in the definition of done of the handoff that writes it.

| Criterion | R IDs | Handoffs | Test or gate artifact |
|---|---|---|---|
| 1 Toy-game gates pass in CI | R0.11, R2.4, R2.5, R2.6 | [[projects/g-tee-oh/handoffs/S05-test-vectors|S05]], [[projects/g-tee-oh/handoffs/S13-toy-gates|S13]] | G1, G2 and G3 reports from `tools/validate` in the CI `rust` job under `validation/reports/` (S13) |
| 2 Reference coverage report, QA pass, invariants | R0.8, R1.2, R1.3, R1.4, R1.5, R1.9, R2.8 | [[projects/g-tee-oh/handoffs/S03-capture-repo|S03]], [[projects/g-tee-oh/handoffs/S08-capture-tooling|S08]], [[projects/g-tee-oh/handoffs/S09-campaign|S09]], [[projects/g-tee-oh/handoffs/S10-normalize-qa|S10]], [[projects/g-tee-oh/handoffs/S11-exit|S11]], [[projects/g-tee-oh/handoffs/S14-library-format|S14]] | Private coverage and QA report pair with the blocked share (S11); public pack round trip and invariant rejection test (S14) |
| 3 Displayed EV loss equals an independent recomputation | R1.5, R2.1, R2.7, R2.13, R2.19, R2.20, R3.6, R3.7, R3.8, R3.13, R4.15 | [[projects/g-tee-oh/handoffs/S12-gto-model|S12]], [[projects/g-tee-oh/handoffs/S16-solver-query|S16]], [[projects/g-tee-oh/handoffs/S22-grading-policy|S22]], [[projects/g-tee-oh/handoffs/S23-api-trainer|S23]], [[projects/g-tee-oh/handoffs/S29-phase-3-gate|S29]], [[projects/g-tee-oh/handoffs/S33-phase-4-gate|S33]] | `tools/validate recompute` over 200 seeded attempts, `validation/reports/recompute.json` with the seed (S29, O-60); the grade recomputation check (S16) |
| 4 Bucket edges tested; the random number generator (RNG) matches frequencies by chi-square | R0.11, R2.3, R2.9, R2.19, R2.20, R3.8, R3.9, R3.10, R3.13, R3.22, R4.15 | S12, [[projects/g-tee-oh/handoffs/S15-tree-solve|S15]], S22, [[projects/g-tee-oh/handoffs/S25-web-study-trainer|S25]], S29 | Bucket-edge table in `gto-model` (S12); chi-square over 10,000 seeded rolls (S22, rerun at S29); `ActionBar` test and flow 4 (S25) |
| 5 Every build-card preflop drill expressed and run | R1.1, R2.9, R2.19, R2.20, R3.14, R3.15, R3.22 | [[projects/g-tee-oh/handoffs/S07-recon|S07]], [[projects/g-tee-oh/handoffs/S26-drills|S26]], S29 | Acceptance file under `research/` with one case per drill against the fixture library (S26); build-card run and flow 2 in the Phase 3 gate report (S29, O-64) |
| 6 Glicko-2 worked example, simulated learner, anti-farming | R0.11, R4.1, R4.2, R4.3, R4.4, R4.5, R4.9, R4.10, R4.11 | S05, [[projects/g-tee-oh/handoffs/S30-learning-core|S30]], [[projects/g-tee-oh/handoffs/S31-api-learning|S31]], [[projects/g-tee-oh/handoffs/S32-web-progress|S32]], S33 | Worked example, simulation and anti-farming matrix in `packages/learning` (S30); flow 1 in CI and `validation/reports/phase-4-gate.md` (S33) |
| 7 Scheduler passes the ts-fsrs published vectors | R0.11, R4.6 | S05, S30, S33 | ts-fsrs vectors through the adapter (S30, O-35), recorded in the Phase 4 gate report (S33) |
| 8 Leak-cost trend and heat map aggregate fixture data | R4.7, R4.8, R4.11, R4.12 | S30, S31, S32, S33 | Aggregation unit tests on fixture attempts (S31); flow 6 (S32, CI at S33) |
| 9 Templates show only grounded numbers; validator rejects others | R2.14, R2.19, R3.19, R3.20 | S16, [[projects/g-tee-oh/handoffs/S27-insights-explanations|S27]], S29 | Number-membership test with snapshots and the planted-number validator test with the mocked model (S27; closing run at S29, O-54) |
| 10 No request path starts a solve; reads inside the latency budget | R0.6, R0.9, R0.10, R2.7, R2.13, R2.15, R2.17, R2.19, R2.20, R2.22, R3.1, R3.3, R3.4, R3.12, R3.22, R4.16 | [[projects/g-tee-oh/handoffs/S02-infra|S02]], [[projects/g-tee-oh/handoffs/S04-mac-bootstrap|S04]], S16, [[projects/g-tee-oh/handoffs/S18-builder|S18]], [[projects/g-tee-oh/handoffs/S20-deploy-1|S20]], [[projects/g-tee-oh/handoffs/S21-api-foundation|S21]], S23, [[projects/g-tee-oh/handoffs/S28-coverage-admin|S28]], S29, [[projects/g-tee-oh/handoffs/S34-deploy-2|S34]] | `cargo tree` and `pnpm why` CI steps (S16); request-path test (S23); `validation/reports/perf-zenbook.json` against O-40 (S29); Mac p95 in `validation/reports/deploy-2.md` (S34, O-21) |
| 11 Live rake follows the selected stake | R0.6, R1.5, R1.8, R2.2, R2.20, R3.2, R3.21 | S02, S10, S11, S12, [[projects/g-tee-oh/handoffs/S19-g6a-fixtures|S19]], S21, S29 | Cap conversion and `config_id` tests (S12); keying test over 1/3 and 2/5, `validation/reports/keying.json` (S29, O-18, O-57) |

## 3. Gates

| Gate | Requirement | Handoff | Where the artifact lands | Visibility |
|---|---|---|---|---|
| G1 Kuhn | R2.4 | S13 | `validation/reports/`, then every CI `rust` run | public |
| G2 AKQ (ace, king, queen) and toy river games | R2.5 | S13 | `validation/reports/`, then every CI run | public |
| G3 Leduc versus the OpenSpiel curve | R2.6 | S13 | `validation/reports/` with the fixture's `PROVENANCE.md` (O-30); tolerance per O-79 in section 6 | public |
| G4 heads-up river and turn versus local oracles | R2.11 | [[projects/g-tee-oh/handoffs/S17-g4-oracle|S17]] | G4 report and oracle dump in the private capture repo; `validation/fixtures/g4-spots.json` and the `tools/validate g4` step public (O-31, O-43) | private report, public compare step |
| G6a heads-up push/fold | R2.19 | S19, Mac rerun of the spike in S20 (R2.21) | `validation/reports/` in public CI with `validation/fixtures/PROVENANCE-g6a.md` (O-63); the solution is the fixture seed (O-30) | public |

## 4. Requirement coverage by phase

| Phase | Doc | R IDs | With a test or gate artifact | In the Definition of Done | Closed by a handoff |
|---|---|---|---|---|---|
| 0 | [[projects/g-tee-oh/planning/phases/phase-0-foundations|Phase 0]] | 12 (R0.1 to R0.12) | 12 | 12 | 12 (S01 to S06; the two `gto-model` vectors of R0.11 in S12) |
| 1 | [[projects/g-tee-oh/planning/phases/phase-1-data-acquisition|Phase 1]] | 11 (R1.1 to R1.11) | 11 | 11 | 11 (S07 to S11) |
| 2 | [[projects/g-tee-oh/planning/phases/phase-2-engine-and-pipeline|Phase 2]] | 22 (R2.1 to R2.22) | 22 | 22 | 22 (S12 to S20) |
| 3 | [[projects/g-tee-oh/planning/phases/phase-3-preflop-trainer|Phase 3]] | 22 (R3.1 to R3.22) | 22 | 22 | 22 (S21 to S29) |
| 4 | [[projects/g-tee-oh/planning/phases/phase-4-rating-and-release|Phase 4]] | 18 (R4.1 to R4.18) | 18 | 18 | 18 (S30 to S35) |

Requirements lacking a test, a definition of done or a handoff: none. Requirements whose closing proof moves to a later session than 09 section 5 names: R1.7 (the `--once` run executes at S20 unless S18 has merged by day 8, O-41), R4.10 (flow 1 lands with S32 and runs in CI at S33). No R ID changed.

## 5. File register

| File | Visibility |
|---|---|
| [[projects/g-tee-oh/planning/phases/phase-0-foundations|Phase 0 Foundations and test scaffolding]] | public: true |
| [[projects/g-tee-oh/planning/phases/phase-1-data-acquisition|Phase 1 Data acquisition and aggregation]] | private: true |
| [[projects/g-tee-oh/planning/phases/phase-2-engine-and-pipeline|Phase 2 Engine validation and solution pipeline]] | public: true |
| [[projects/g-tee-oh/planning/phases/phase-3-preflop-trainer|Phase 3 Preflop trainer]] | public: true |
| [[projects/g-tee-oh/planning/phases/phase-4-rating-and-release|Phase 4 Rating, scheduling, progress, Deploy 2 and the v1 gate]] | public: true |
| [[projects/g-tee-oh/handoffs/S01-foundations|S01 Foundations]], [[projects/g-tee-oh/handoffs/S02-infra|S02 Infra]], [[projects/g-tee-oh/handoffs/S04-mac-bootstrap|S04 Mac bootstrap]], [[projects/g-tee-oh/handoffs/S05-test-vectors|S05 Test vectors]], [[projects/g-tee-oh/handoffs/S06-contracts|S06 Contracts]] | public: true |
| [[projects/g-tee-oh/handoffs/S03-capture-repo|S03 Capture repo]] | private: true |
| [[projects/g-tee-oh/handoffs/S07-recon|S07 Reconnaissance]], [[projects/g-tee-oh/handoffs/S08-capture-tooling|S08 Capture tooling]], [[projects/g-tee-oh/handoffs/S09-campaign|S09 Capture campaign and daily check-ins]], [[projects/g-tee-oh/handoffs/S10-normalize-qa|S10 Normalize, QA and first pack]], [[projects/g-tee-oh/handoffs/S11-exit|S11 Phase 1 exit]] | private: true |
| [[projects/g-tee-oh/handoffs/S12-gto-model|S12 gto-model]], [[projects/g-tee-oh/handoffs/S13-toy-gates|S13 Toy gates]], [[projects/g-tee-oh/handoffs/S14-library-format|S14 Library format]], [[projects/g-tee-oh/handoffs/S15-tree-solve|S15 Tree and solve adapter]], [[projects/g-tee-oh/handoffs/S16-solver-query|S16 solver-query]] | public: true |
| [[projects/g-tee-oh/handoffs/S17-g4-oracle|S17 G4 oracle]] | public: true; runs in the private repo for the GNU Affero General Public License (AGPL) boundary only (O-43) |
| [[projects/g-tee-oh/handoffs/S18-builder|S18 Builder]], [[projects/g-tee-oh/handoffs/S19-g6a-fixtures|S19 G6a and fixtures]], [[projects/g-tee-oh/handoffs/S20-deploy-1|S20 Deploy 1]] | public: true |
| [[projects/g-tee-oh/handoffs/S21-api-foundation|S21 api foundation]], [[projects/g-tee-oh/handoffs/S22-grading-policy|S22 grading policy]], [[projects/g-tee-oh/handoffs/S23-api-trainer|S23 api trainer]], [[projects/g-tee-oh/handoffs/S24-web-foundation|S24 web foundation]], [[projects/g-tee-oh/handoffs/S25-web-study-trainer|S25 web study and trainer]] | public: true |
| [[projects/g-tee-oh/handoffs/S26-drills|S26 drills]], [[projects/g-tee-oh/handoffs/S27-insights-explanations|S27 insights and explanations]], [[projects/g-tee-oh/handoffs/S28-coverage-admin|S28 coverage and admin]], [[projects/g-tee-oh/handoffs/S29-phase-3-gate|S29 Phase 3 gate]] | public: true |
| [[projects/g-tee-oh/handoffs/S30-learning-core|S30 Learning core]], [[projects/g-tee-oh/handoffs/S31-api-learning|S31 api learning]], [[projects/g-tee-oh/handoffs/S32-web-progress|S32 Web progress]], [[projects/g-tee-oh/handoffs/S33-phase-4-gate|S33 Phase 4 gate]], [[projects/g-tee-oh/handoffs/S34-deploy-2|S34 Deploy 2 and the v1 gate]], [[projects/g-tee-oh/handoffs/S35-docs-release|S35 Docs and release]] | public: true |
| 10 Traceability (this file) | public: true |
| [[projects/g-tee-oh/planning/09-v1-sprint-roadmap|09 v1 sprint roadmap]] | already flagged public: true; checked, only owner screenshots of the local app |
| [[projects/g-tee-oh/planning/04-solver-engine|04 Solver engine]], [[projects/g-tee-oh/planning/06-rating-and-progress|06 Rating and progress]] | qualifies, not flagged (O-26) |
| [[projects/g-tee-oh/planning/architecture/A1-repo-and-conventions|A1]], [[projects/g-tee-oh/planning/architecture/A2-engine|A2]], [[projects/g-tee-oh/planning/architecture/A3-library-format|A3]], [[projects/g-tee-oh/planning/architecture/A4-data-model|A4]], [[projects/g-tee-oh/planning/architecture/A5-services-and-interfaces|A5]], [[projects/g-tee-oh/planning/architecture/A6-trainer-and-learning-engine|A6]], [[projects/g-tee-oh/planning/architecture/A7-web-app|A7]] | qualifies, not flagged (A7 names only owner screenshots) |
| ADRs 0001, 0002, 0004, 0005, 0006, 0008, 0009, 0010, 0011, 0012, 0013, 0014, 0015, 0016, 0017, 0018, 0019, 0020, 0023 | qualifies, not flagged; 0007 and 0021 excluded by O-26, 0003 and 0022 superseded |
| Not as they stand: 01 (section 4 item 1 lists the capture value order), 02 (names the recon tool twice, section 7 guard patterns), 05 (section 4 parameter names and a game type code), 07 (Phase 1 checklist), 08 (three capture-tool glossary entries), A9 (section 3 capture row), 00 (O-7, O-12, O-19, risks R-4 and R-15) | not public-safe without a trim; reported, not flagged |

## 6. Problems

The owner accepted every proposed default (O-68 to O-100) on 2026-10-19; the answers are recorded in [[projects/g-tee-oh/planning/00-open-questions-and-risks|00 Open questions and risks]] and each handoff cites its O-ID at the spot where the answer applies.

Blocking means a privacy leak in a public file or a criterion with no chain; major means a missing or mismatched requirement, section, dependency or definition of done; minor means style, wording or a proposed question. No blocking or major problem was found. Rows O-68 to O-100 are the writers' proposed questions, numbered here in one sequence after O-67; the owner accepted every default on 2026-10-19, and the append to planning/00 is owed outside this workflow's files.

| Severity | File | What | Fix |
|---|---|---|---|
| minor | decisions/_README | ADR 0004 and 0013 still read Proposed, and 0005 and 0011 lack the O-56 note, although O-25 and O-56 say Step 3 records them | Update the three status lines and add the O-56 note beside O-25 |
| minor | planning/09 | Frontmatter status still reads draft, awaiting approval, although the owner accepted every default; S01 mirrors the file as is | Set the status to accepted 2026-10-19 before S01 runs |
| minor | planning/phases/phase-1 | Frontmatter id equals the id of planning/03 | Re-id the phase doc to g-tee-oh-phase-1-data-acquisition-and-aggregation |
| minor | planning/02, 03, 04, 07 | Errata per O-23, O-27, O-28, O-31, O-63 not yet written: 02 sections 6.1, 6.4 and 7; 04 sections 2 and 6; 03 section 6 still says reference schema; 07's Phase 0 checklist names the reference schema and a phase-0 branch | Add the errata sections; the phase docs already follow the answered questions |
| minor | planning/09 section 5 | The S20 row reads as one sitting while the handoff has two sittings on two machines (O-41 on the Zenbook, O-59 on the Mac); S04 runs in PowerShell on the Zenbook with the owner typing at the Mac | Add a two-sitting note to the S20 row; keep S04 as written |
| minor | planning/09 sections 2 and 5 | S09's first sitting is medium in section 5 but counts as one low unit in the Phase 1 total, so Phase 1 may cost 16 units rather than 15 | Adjust the Phase 1 units |
| minor | handoffs/S10, S11 | Before pasting lists S16 (S10) and S15 (S11), which 09 section 3 does not list as edges; both are paced earlier, so no session starts early | Add the two edges to 09 section 3 or leave them as practical inputs |
| minor | handoffs/S30 to S35 | Cross-phase sessions are named by id in plain text rather than by wikilink | Optional: link S04-mac-bootstrap, S05-test-vectors, S11-exit, S19-g6a-fixtures, S20-deploy-1, S22-grading-policy, S23-api-trainer, S24-web-foundation, S25-web-study-trainer, S29-phase-3-gate |
| minor | planning/phases/phase-2, handoffs/S13 | AKQ not expanded on first use | Write AKQ (ace, king, queen) at first use |
| minor | handoffs/S01 | The commit-msg hook detects a Claude commit through the CLAUDECODE environment variable, unverified | S01 verifies the variable at run time or substitutes an equivalent |
| minor | handoffs/S04 | Adds installing Claude Code on the Mac, which R0.9 does not list but O-59 needs before S20 | Keep; the owner may strike it |
| minor | planning/phases/phase-0 | R0.3 is split across S01 (job definitions), S02 (Dockerfiles, images matrix) and S06 (end-to-end (e2e) smoke, one-service build) while 09 names S01 and S06 | Accept the split or name one owning session |
| minor | handoffs/S05 | Scaffolds pending tests beyond R0.11's literal list (R3.8, R3.10, R3.20, R4.7 to R4.9), following the Phase 0 goal | Keep, or trim S05's learning lane if R0.11 is to stay literal |
| minor | handoffs/S33, phase-4 R4.15 | The amendment ADR names only ADR 0011 while tau and the labels are grading parameters from ADR 0008 territory | The S33 amendment names ADR 0008 as well as 0011 |
| minor | phase-0, every handoff | Proposed O-68: who merges a pull request into sprint/1-v1 | Default: the owner merges after review; a session never merges its own |
| minor | handoffs/S01 | Proposed O-69: the public CI identifier check needs the salt (O-58) | Default: GUARD_SALT as a repository secret and a local variable from .guard-private/; fails closed on the main repo; pattern check only on forks |
| minor | handoffs/S01, S03, S07 | Proposed O-70: who seeds the plain denylist before reconnaissance | Default: S01 seeds it from planning/00 and the owner's names, S03 moves it to the private repo, S07 extends it |
| minor | handoffs/S02 | Proposed O-71: where the unverified flag on the 2/5 stake row lives (O-66) | Default: a nullable note column on stake, rendered as a banner later |
| minor | handoffs/S02 | Proposed O-72: whether straddle-on rows are seeded | Default: straddle-off only (11 game_config rows); straddle-on rows come with R1.6 after O-9 |
| minor | handoffs/S03, S07, S17 | Proposed O-73: the private repo's branch model and layout | Default: it mirrors main, sprint/1-v1 and p<phase>/<slug>, with validation/reports/ and docs/ as in A1 section 1; S03 creates sprint/1-v1 |
| minor | handoffs/S02, S10, S11 | Proposed O-74: R1.6 needs the capture role to update game_config.sizing_convention_id, which A4 section 3 does not grant | Default: S02 grants UPDATE on that one column; if S02 has merged, a one-migration public pull request before the first pack |
| minor | handoffs/S11, S15 | Proposed O-75: R1.6's public sizing test has no public owner | Default: S15 writes it beside the gto-tree tests against the R0.6 seed; S11 reruns it locally against the reference rows |
| minor | handoffs/S15 | Proposed O-76: the sizing convention spec JSON Schema has no owner | Default: S15 writes packages/contracts/schemas/sizing-convention.json and validates S02's placeholder rows against it |
| minor | handoffs/S07 | Proposed O-77: where the sanitized vault copies land | Default: research/<date>-recon-feature-map.md and research/<date>-recon-drill-schema.md, private: true unless verified clean |
| minor | handoffs/S09 | Proposed O-78: the campaign branch after p1/campaign merges at the O-19 completion | Default: re-create p1/campaign from sprint/1-v1 after each merge and merge weekly until the campaign ends |
| minor | phase-2, handoffs/S13 | Proposed O-79: G3 has no numeric tolerance (R2.6) | Default: at every committed checkpoint iteration, exploitability within the larger of 0.001 absolute and 10 percent relative |
| minor | phase-2, handoffs/S19 | Proposed O-80: push/fold spike pass rule (O-49 covers only the 100 big blind (bb) measurement) | Default: passes when peak bytes stay under 5 GB and the G6a exact match holds; wall time recorded, not gated |
| minor | handoffs/S17 | Proposed O-81: R2.11 says crates, but the second oracle in 04 section 2 is C++ | Default: b-inary/postflop-solver alone satisfies R2.11; the binary oracle is optional when installed |
| minor | handoffs/S06, S14 | Proposed O-82: manifest and node-dump schema ownership is split between R0.7 and R2.7, R2.8 | Default: S14 owns the content per A3 sections 3 and 4, S06 the pipeline; whichever lands first commits, the other reconciles |
| minor | handoffs/S18 | Proposed O-83: the Zenbook flop-line benchmark runs before any configuration is packed | Default: hand-made fixture ranges for the O-52 line with the R0.6 placeholder convention; the real number comes from S20 |
| minor | handoffs/S20, S34 | Proposed O-84: vault access on the Mac for /add-dir | Default: ~/vault/projects/g-tee-oh when synced; otherwise read the phase doc and handoff from docs/ (O-45) and carry new O-IDs in the report for the owner to append from the Zenbook |
| minor | handoffs/S20 | Proposed O-85: the medium for importing the packed reference library onto the Mac | Default: the external drive (A9 section 5) |
| minor | phase-2, handoffs/S16 | Proposed O-86: where the R2.13 grade p95 bench runs | Default: on the Zenbook with the R0.10 harness; the committed JSON is checked by hosted CI (O-40 pattern) |
| minor | handoffs/S13 to S34 | Proposed O-87: report and fixture file names 09 leaves unnamed | Default: phase-2-gate.md, bench-flop-line-zenbook.md, spike-preflop-zenbook.md, spike-preflop-mac.md, library-size-estimate.md, PROVENANCE-g6a.md, g4-spots.json, phase-3-gate.md, recompute.json, perf-zenbook.json, keying.json, phase-4-gate.md, deploy-2.md |
| minor | handoffs/S23 | Proposed O-88: the app role has no access to builder internals (A4 section 3) but R3.5 writes settings | Default: a migration grants app read on build_job, builder_setting and storage_ledger and update on builder_setting, nothing else |
| minor | handoffs/S22 | Proposed O-89: the R3.11 queue test has no Phase 3 owner | Default: S22 writes the confident-miss ordering as a pure function in packages/learning; S30's queue selection reuses it |
| minor | handoffs/S22 | Proposed O-90: significance level of the 10,000-roll chi-square test | Default: a fixed seed; pass when p is above 0.01, as a named constant |
| minor | handoffs/S23, S29, S33 | Proposed O-91: who builds the just perf target (O-40) | Default: S23 adds it and writes the first report; every gate session on the Zenbook runs it; S29 adds the hosted check and the advisory e2e timing |
| minor | handoffs/S29 | Proposed O-92: who writes tools/validate recompute (O-60) | Default: S29's criterion 3 agent; S23 renders feedback from the attempt row; at least 200 seeded attempts generated through api on the dev stack |
| minor | handoffs/S28, S29 | Proposed O-93: flow 5 has no author in 09 | Default: S28 writes it with the coverage screen; S29 wires it into the CI e2e job |
| minor | handoffs/S25 | Proposed O-94: the trainer has no Phase 3 route besides /drills/:id/run | Default: S25 runs spot mode on /drills/:id/run from a fixture drill created through the S21 endpoints |
| minor | handoffs/S28 | Proposed O-95: the admin screen has no route | Default: on /library with BuilderHealth; S28 records any split in its pull request |
| minor | handoffs/S33 | Proposed O-96: R4.15 with a small local-port sample | Default: under 100 attempts, keep tau at 4 percent pot and the 05 section 6.3 thresholds, record the sample size, leave the revisit to post-v1 |
| minor | handoffs/S34 | Proposed O-97: how just v1-gate handles private report paths in public CI | Default: a PRIVATE_REPORTS_PATH variable; unset in CI, public paths are checked and private ones listed as recorded in the committed output; the Mac run output is the evidence |
| minor | handoffs/S35 | Proposed O-98: SBOM (software bill of materials) tool and format (A9 section 3) | Default: CycloneDX JSON from cargo cyclonedx and @cyclonedx/cyclonedx-npm behind just sbom, attached to the release |
| minor | handoffs/S35 | Proposed O-99: the release tag name | Default: v1.0.0 on the sprint/1-v1 head after the S35 docs commit and before the merge into main |
| minor | handoffs/S31 | Proposed O-100: how the 30 holdout items per track are chosen (06 section 9) | Default: one seeded deterministic draw per track over covered nodes in scope when the tracks are seeded; seed stored; never redrawn |
