---
id: 'g-tee-oh-handoff-s34-deploy-2'
title: 'S34 Deploy 2 and the v1 gate'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 4
session: 'S34'
branch: 'p4/deploy-2'
tags: [g-tee-oh, handoff, phase-4]
---
# S34 Deploy 2 and the v1 gate (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-4-rating-and-release|Phase 4 Rating, scheduling, progress, Deploy 2 and the v1 gate]]. This session runs Deploy 2 on the Mac with the owner present and an explicit-yes stop before any deploy action, then measures the Mac 95th percentile latency (p95), runs the restore drill to the Zenbook, and writes the post-deploy report and the v1 gate report. It closes R4.16 and R4.17. Branch `p4/deploy-2` off `sprint/1-v1`; parallel group G, earliest day 14 (2026-11-02), paced for day 31 (2026-11-19), slipping to the O-39 fallback date (about 2026-11-26) if the owner is unavailable (O-67); single session; public; medium usage (2 units). It runs in Claude Code on the Mac at `~/projects/g-tee-oh` (O-59). Decisions are cited as ADR nnnn (architecture decision record); answered questions by O-ID from [[projects/g-tee-oh/planning/00-open-questions-and-risks|00 Open questions and risks]].

## Before pasting

- [ ] S29 (Phase 3 gate) and S33 (Phase 4 gate) merged into `sprint/1-v1`, and `sprint/1-v1` green on all seven continuous integration (CI) jobs at its head (09 section 3, R4.16).
- [ ] S20 done: the Deploy 1 stack (Postgres, SeaweedFS, the library builder) running on the Mac with its report and its nightly backup on the external drive (O-20, R2.22); S04's bootstrap report present (R0.9).
- [ ] S11 done: the criterion 2 report and the O-18 decision note in the private capture repo, with their paths at hand for the v1 gate report; if S11 slid to week 5, the report is attached at this gate (09 section 4).
- [ ] The Phase 3 gate report, the Phase 4 gate report, the perf reports and every public criterion report present under `validation/reports/` on `sprint/1-v1`.
- [ ] The owner at the Mac: the clone at `~/projects/g-tee-oh`, `.env` complete for the `mac` profile (database and bucket credentials from Deploy 1, the `api` session secret; no model key is needed, O-54), the external drive attached, the Mac on power with sleep prevented, the Zenbook on and reachable for the restore drill.
- [ ] The vault reachable from the Mac for `/add-dir`; if it is not, the fallback in the problems list applies: new O-IDs come back in the report and the owner appends them from the Zenbook.

## How to start

```zsh
cd ~/projects/g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull --ff-only
git switch -c p4/deploy-2
claude
```

1. Run `/add-dir` on the vault folder as it is reachable from the Mac (on the Zenbook it is `C:\Users\stack\vault\projects\g-tee-oh`; the Mac path is open, see problems list) so the session can read the vault and append O-IDs to `planning/00-open-questions-and-risks.md`.
2. Stay in the default permission mode, so every command that changes the Mac is approved by you.
3. Paste the prompt below.

## The prompt

```text
You are running session S34 of sprint 1 of g-tee-oh, Phase 4 (rating, scheduling, progress, Deploy 2 and the v1 gate), on branch p4/deploy-2 off the sprint branch sprint/1-v1, in Claude Code on the Mac at ~/projects/g-tee-oh (O-59). Goal: Deploy 2 with the owner's explicit yes, the Mac p95, the restore drill, the post-deploy report and the v1 gate report, closing R4.16 and R4.17.

Reading order (vault root as added with /add-dir; paths are relative to it):
1. planning/phases/phase-4-rating-and-release.md
2. planning/09-v1-sprint-roadmap.md sections 1, 2, 5 (row S34), 6 (Phase 4) and 7 (the traceability and gate tables)
3. planning/00-open-questions-and-risks.md, answered questions O-17 to O-67; O-20, O-21, O-26, O-39, O-40, O-54, O-59, O-66 and O-67 bind this session
4. planning/01-product-spec.md section 6 (the eleven criteria)
5. planning/architecture/A9-quality-security-ops.md sections 2 to 6; A5-services-and-interfaces.md section 1; A1-repo-and-conventions.md section 6; planning/02-architecture.md section 6.2 (the memory budget)
6. decisions/0001-personal-self-hosted-portfolio-grade-multi.md, 0018-library-first-serving-the-user-never.md, 0019-object-store-is-seaweedfs.md, 0017-planning-docs-live-in-the-private.md
7. The repo's CLAUDE.md; validation/reports/ (the Deploy 1 report, mac-bootstrap.md, the Phase 3 and Phase 4 gate reports); any docs/ mirrored files

Rules:
- This session runs on the Mac; the Zenbook never deploys remotely (O-59). Branch p4/deploy-2; merge by pull request into sprint/1-v1; sprint/1-v1 merges into main only in S35 (R4.18).
- Nothing deploys to the Mac service without the owner's explicit yes at that moment (O-20): step 3 below is a hard stop. Until the owner types yes in this session, you run only read-only checks and image builds.
- Gates in order: plan first in plan mode and wait for approval; a task list; tests and checks green, never advance on red; /code-review on what you commit; /security-review, because this session touches secrets, the user account and the exposed stack; conventional commits (chore:, docs:, ci:), each ending with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Accepted ADRs are fixed; cite O-IDs; anything open becomes a proposed O-ID with a default (appended to planning/00 if the vault is reachable, otherwise carried in the report).
- Privacy (O-26, O-19): the reference library import follows the private repo's procedure and nothing about it enters the public repo; the v1 gate report links private reports by capture-repo path, never by content; no capture detail, tier, volume or screenshot in any file you write.
- Report honestly: a failed budget or drill is recorded as failed, not tuned away on the Mac.

Inputs:
- The Deploy 1 stack and report (S20), the bootstrap report (S04), the Phase 3 and Phase 4 gate reports (S29, S33), the perf reports (O-40), the public criterion reports under validation/reports/, the private criterion 2 report and O-18 note (S11) by path.
- Budgets: Mac p95 study node read under 150 ms, decision to feedback under 250 ms, solver-query grade under 30 ms warm (A9 section 6, O-21); per-container memory per 02 section 6.2 (Postgres 1 GB, SeaweedFS 0.5 GB, api 0.5 GB, solver-query 2 GB, builder 5 GB cap, Caddy and overhead 1 GB) inside the 10 GB virtual machine.
- Operations: just mac-up with the mac profile, seed the catalog, import the reference library, create the user, nightly pg_dump plus a SeaweedFS mirror to the external drive, restore drill to the Zenbook (A9 section 5).

Requirements this session closes (gate artifact in parentheses):
- R4.16 Deploy 2 with the owner's explicit yes (O-20): full stack on the Mac, catalog seeded, reference library imported, user created, nightly backups, restore drill to the Zenbook running the end-to-end flows; sprint/1-v1 green on all seven jobs; full-history guard clean (post-deploy report with the Mac p95 inside both budgets and the restore drill result).
- R4.17 v1 gate report listing all eleven criteria with report paths, public under validation/reports/ and private in the capture repo (just v1-gate asserts every linked report exists and passes; its output committed with validation/reports/v1-gate.md).

Steps, every one single and in this order:
1. (single) Plan mode: read; write the plan as this list with the exact commands; wait for approval; task list.
2. (single) Preflight, read-only: the head of sprint/1-v1 contains the S29 and S33 merges and is green on all seven jobs (link the run); just guard-history is clean; the Deploy 1 containers are healthy and the builder is running; the external drive is mounted and holds Deploy 1's latest backup; free disk against the 650 GB plan; .env complete for the mac profile. Build the arm64 release images for api, web and solver-query on the Mac; start nothing. Then show the owner: the containers that will start, the migrations that run on start, the catalog seed, the reference library import, the user to create, the backup job, and the rollback (stop the new containers; the Deploy 1 stack and its backup are untouched).
3. (single) STOP. Ask exactly: "Deploy 2 to the Mac now? Type yes to continue." Do nothing until the owner types yes in this session. Any other answer ends the session with a report of the preflight state. The yes covers only the actions listed in step 2.
4. (single) Deploy: just mac-up with the mac profile; migrations run on start; every container healthy with restart: unless-stopped; seed the catalog; import the reference library per the private procedure; create the user; install the nightly backup job and run one backup now; record per-container peak resident set size (RSS) against the 02 section 6.2 budget.
5. (single) Verify in the browser on the Mac: sign in; run flows 1 to 6 by hand or with Playwright pointed at the Mac stack; the builder still running on its Deploy 1 line; the health page shows builder state, storage against budget and the last backup.
6. (single) Mac p95: run just perf against the Mac stack with a warm cache and a stated sample size for study node read, decision to feedback and the solver-query grade call; record the numbers against 150 ms, 250 ms and 30 ms (O-21). If a budget fails, record it; criterion 10 then reads failed in the gate report and S35 waits.
7. (single) Restore drill (A9 section 5): copy today's backup to the Zenbook; give the owner the Zenbook commands to restore into the dev profile and run the end-to-end flows there; the owner pastes the output; record pass or fail.
8. (single) Write validation/reports/deploy-2.md (name proposed, see problems list): what ran, container health and peak RSS, the p95 table, the backup, the restore result, the guard scan. Write validation/reports/v1-gate.md: all eleven criteria with the requirement IDs from 09 section 7 and the path of each report, public paths under validation/reports/ and private ones as capture-repo paths; note the O-66 status of the 2/5 cap row beside criterion 11. Run just v1-gate and commit its output beside the report (private-path handling open, see problems list).
9. (single) /code-review and /security-review on the committed files and any configuration change; commit; push p4/deploy-2; open the pull request into sprint/1-v1 listing R4.16 and R4.17.

Definition of done:
- [ ] The owner typed yes in this session before any deploy action, and the transcript shows it.
- [ ] Full stack healthy on the Mac; catalog seeded; reference library imported; user created; nightly backup installed and one backup taken.
- [ ] Mac p95 recorded for all three paths; restore drill result recorded; peak RSS recorded; just guard-history clean.
- [ ] validation/reports/deploy-2.md and validation/reports/v1-gate.md committed with the just v1-gate output.
- [ ] /code-review and /security-review done; pull request opened into sprint/1-v1.

Report back, in the final message: R4.16 and R4.17 with the commands and results (the p95 table, the drill result, the just v1-gate output); the branch and pull request link; the files written; the gate artifacts under validation/reports/; the stack state on the Mac; usage in units against the planned medium (2); any new question as a proposed O-ID with a default, appended to planning/00 or carried in this message if the vault was not reachable.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| The full v1 stack running on the Mac under the `mac` profile, with backups on the external drive | the Mac |
| Post-deploy report (Mac p95, peak RSS, backup, restore drill, guard scan) | `validation/reports/deploy-2.md` on `p4/deploy-2` (name proposed) |
| v1 gate report and the committed `just v1-gate` output | `validation/reports/v1-gate.md` |
| Restore drill result from the Zenbook | recorded in the post-deploy report |
| Pull request into `sprint/1-v1` | GitHub |
| Proposed O-IDs, if any | vault `planning/00-open-questions-and-risks.md`, or the report if the vault was not reachable from the Mac |
