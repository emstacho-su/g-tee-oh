# Phase 2 gate and Deploy 1 report

Started by S20 on 2026-11-05. This report closes the Phase 2 gate (R2.1 to R2.22) and records Deploy 1, the first deploy event of O-20. It runs under O-61 and O-507: no configuration is packed yet, so the build measured here is a smoke build on the hand-made ranges for the O-52 line, deleted after its numbers are recorded; S20b, after the first pack (S10), adds the first real build as an addendum and replaces the smoke numbers. Every row names the requirement identifier (R ID), the evidence and where it lives. Sitting 1 ran on the Zenbook; sitting 2, the deploy, runs on the Mac (O-59) and is recorded in its own section below.

## Gate conditions already met before S20

| R ID | Condition | Evidence | Result |
|---|---|---|---|
| R2.4 to R2.6 | Gates G1 (Kuhn poker), G2 (the ace, king, queen toy game and the toy river) and G3 (Leduc poker) pass in the continuous integration (CI) `rust` job | `rust` run on `sprint/1-v1` at 4059b23: https://github.com/emstacho-su/g-tee-oh/actions/runs/42060272171 (`just gates-check` against the committed reports `g1-kuhn`, `g2-akq`, `g3-leduc`) | Pass |
| R2.11 | G4, heads-up river and turn spots against the local oracles, both sides at 0.3 percent of the pot or better | Private, in the capture repository under `validation/reports/g4/`: the rake-free and the raked reports, both written 2026-10-22 at commit 63bf014 (O-31, architecture decision record (ADR) 0017); only the verdicts are recorded here | Pass (both) |
| R2.19 | G6a, heads-up push/fold against the computed equilibrium, in every CI run | The same `rust` run (`just g6a-smoke`); the committed `g6a-pushfold` report with the local chart comparison | Pass |
| R2.15 | No request path can start a solve: `solver-query` does not depend on `gto-solve` | The same `rust` run (`just rust-boundary`) | Pass |
| R2.21 | The preflop spike inside the 5 GB container on both machines against O-48, O-49 and O-80 | `spike-preflop-zenbook` (S19) and `spike-preflop-mac` (2026-11-05, the Mac's Docker virtual machine, push/fold 0.125 seconds, judged peak 7,802,880 bytes, the 100 big blind placeholder run 0.150 seconds at 0.258 percent of the pot) | Pass (both) |
| R0.9 | The Mac part of the Phase 0 gate, checked before Deploy 1 (O-67) | `mac-bootstrap.md`: the flop-line benchmark in the 5 GB container on the Mac, peak resident set size (RSS) 1,489,641,472 bytes and 232 seconds to 0.3 percent of the pot | Pass |

## Sitting 1: the smoke build on the Zenbook (2026-11-05)

Mechanism. The dev profile's Postgres and SeaweedFS ran under the Windows Subsystem for Linux 2 (WSL2) backend with the migrations applied. Three settings were written through `scripts/mac/setting.mjs`: `plan_configs` set to `[]`, so the builder plans nothing beyond the one job (O-509), `k_runouts` 20 and `k_runouts_rare` 10 (O-14, O-191). One job was queued through the new `library-builder queue` command (O-510), which computes the tree hash the way the claim path checks it and writes the flop in its canonical form: the O-52 line (online 6-max 100 big blinds, big blind against button single-raised pot, line `r250.c`) on Kh7d2c, written as Kc7d2h, K = 20, at the head of the queue. K = 20 is the top-pair K of the O-51 rule; the planner ranks another pair first and would give BB-BTN K = 10, so the measurement is the conservative one, and the Mac sitting queues K = 20 explicitly to match it. `library-builder --once --job <id>` then ran in the builder container under its compose limits (5 GB memory, no swap beyond it) with the hand-made ranges the image carries (O-83, O-201), while a separate Postgres session listened on `coverage_added`. The run is a smoke build in the sense of O-61: its ranges are not solver output, so its strategy is not a library entry, but its memory, time and bytes are the engine's on the real tree.

| Measurement | Value | Rule | Result |
|---|---|---|---|
| Outcome | published, one solution row with status `published` | one published build at target exploitability (R2.22) | Pass |
| Exploitability per seat | 0.253 and 0.284 percent of the pot | at most 0.3 percent of the pot (O-50) | Pass |
| Iterations, stop reason | 240, target | none | recorded |
| Seconds for the line | 253.1 | under 1,800 seconds per preflop line (O-50) | Pass |
| Judged peak memory | 1,491,238,912 bytes (cgroup `memory.peak`; process peak RSS 1,482,354,688) | under 5,000,000,000 bytes (O-50) | Pass |
| Memory estimate before the solve | 1,463,919,296 bytes | under the 4 GiB `memory_cap_bytes` | Pass |
| Flop tree bytes for the line | 48,034 | none | recorded |
| Runout bytes | 20 runouts, mean 368,796, total 7,375,921 | none | recorded |
| Bytes written for the build | 7,429,888 (the storage ledger grew by exactly this) | none | recorded |
| Scenario rows | 20, one per runout, flop weight 24 | one per kept runout | Pass |
| Notification | `coverage_added` with `{"config_id":"cfg_6_online_100","pair":"BB-BTN","flop":"Kc7d2h","build_id":"01a1ac99-f8fa-7efd-90a7-f1dd98cac025","scenario_count":20}` | a notify observed (R2.22) | Pass |
| K in `builder_setting` | `k_runouts` 20, `k_runouts_rare` 10, `plan_configs` [] | K written (R2.22) | Pass |

The machine: AMD Ryzen AI 9 465, 20 logical cores, 20 GB, Docker Desktop with the WSL2 backend, linux/amd64 container. Nothing else of this project ran during the measurement; other projects' idle containers were up.

Storage projection (O-51). The rule takes the top position pair at K = 20 over all 1,755 canonical flops plus 184-flop subsets at K = 10 for the other pairs, and asks for the total inside 650 GB. The planner gives 15 pairs for `cfg_6_online_100`, three flop lines each except SB-BB with seven (pinned by `r2_22_projection_counts_for_the_6max_100bb_configuration` in `crates/gto-planner/tests/r2_16_planner.rs`). One line costs the flop tree plus K runouts, 48,034 + K x 368,796 bytes from this build. Taking the seven-line pair as the top one gives the upper bound: 1,755 x 7 x 7,423,954 = 91.2 GB for the top pair plus 184 x 42 x 3,735,994 = 28.9 GB for the rest, 120.1 GB in all. With a three-line top pair it is 70.7 GB. Both are inside 650 GB, so K stays at 20 and 10. Caveat: the bytes per line come from the single-raised line only; the 3-bet and 4-bet lines have shallower trees and are expected to be smaller, so the bound is conservative, and S20b replaces it with the first real build's bytes.

Rehearsal of the deploy sequence. The same scripts the Mac runs were run against the dev stack with a scratch directory standing in for the external drive. `scripts/mac/peaks.mjs` read the containers' cgroup peaks (Postgres 92,721,152 bytes against a 1 GiB budget, SeaweedFS 308,531,200 against 512 MiB). `scripts/mac/backup.mjs` wrote a 109,764-byte dump with its sha256 receipt and mirrored both buckets. `scripts/mac/restore-check.mjs` restored the dump into a scratch database and checked the smoke build's 21 files in the mirror against its manifest: verdict restored. `scripts/mac/smoke-clean.mjs` then deleted the solution, its 20 scenario rows and the job in one transaction, gave the 7,429,888 bytes back to the ledger and purged the build's prefix, leaving no object under it. The first cleanup attempt refused a valid job because Postgres folds a constant division by zero at plan time; the guard was fixed (commit 1df404c) and the rerun succeeded. The dev stack was stopped with its volumes kept.

Reference library. Under O-61 nothing is imported into `reference-private`: no configuration is packed. S20b imports the first pack.

## Sitting 2: Deploy 1 on the Mac

The explicit yes (O-20). The preparation ran first and needed no yes: the branch at 8608609 with the hooks installed, `.env` filled by the owner (its values are not read by the session and appear nowhere here), `just mac-build` (the data and one-shot images pulled, the builder image built for linux/arm64, exit 0) and a security review of the branch's compose `mac` profile, one-shots, scripts and `.env` handling, which found nothing at the reporting threshold. The session then asked "Deploy 1 now? Reply yes to proceed." The owner's first reply was not the literal word and was treated as wait; the owner replied "yes." at 2026-11-05T17:54:16Z (09:54:16 Pacific Standard Time, the Mac's clock). No deploy action ran before that time.

The external drive. The owner had no backup drive attached for this sitting and said so before the yes. The deploy went ahead without it, so the backup steps and the smoke build's cleanup wait for the drive (see Pending below).

Mechanism. `just mac-up` checked that `POSTGRES_PASSWORD` is URL-safe, started `postgres-mac` and `seaweedfs-mac` under their limits until both were healthy, then ran the one-shots `migrate-mac` (the migrations and the catalog seed over the network gto, O-511) and `bucket-init-mac` (the two buckets with their own credentials); both exited 0. The same three settings as sitting 1 were written: `plan_configs` `[]`, `k_runouts` 20, `k_runouts_rare` 10 (O-14, O-191, O-509). `just mac-queue cfg_6_online_100 BB-BTN Kh7d2c r250.c 20` queued the O-52 line through `library-builder queue` (O-510) at the head of an empty queue: job 01a1acd9-7ae3-72f8-abd5-c13146fbe7b2, flop written as Kc7d2h, tree hash 9bb40617...d8bd, estimate 283,889,825 bytes. A Postgres session ran `LISTEN coverage_added` from 17:55:12Z. `just mac-builder-up` started the builder's claim loop at 17:55:26Z under its 5 GB cap with `restart: unless-stopped`; it reported itself throttled to 5 of the virtual machine's 10 threads (central processing unit (CPU) share 0.5), claimed the job and published at 18:00:12.9Z, then went idle because `plan_configs` is empty. The numbers below come from the job and solution rows, the builder's `/metrics` (read from inside the network gto, nothing published) and the object listing of the build's prefix.

| Measurement | Value | Rule | Result |
|---|---|---|---|
| Outcome | job `done`, 0 retries; one solution row with status `published`, source `own` | one published build at target exploitability (R2.22) | Pass |
| Exploitability per seat | 0.253 and 0.284 percent of the pot (identical to the Zenbook) | at most 0.3 percent of the pot (O-50) | Pass |
| Iterations | 240 (identical to the Zenbook) | none | recorded |
| Seconds for the line | 292.0 (`builder_line_seconds_sum`, one line), at half the virtual machine's threads | under 1,800 seconds per preflop line (O-50) | Pass |
| Builder peak memory | process peak RSS 1,481,654,272 bytes (`builder_peak_rss_bytes`); container cgroup `memory.peak` 1,487,368,192 | under 5,000,000,000 bytes (O-50) | Pass |
| Flop tree bytes for the line | 48,034 | none | recorded |
| Runout bytes | 20 runouts, mean 366,306, total 7,326,115 | none | recorded |
| Bytes for the build | 7,380,082: the manifest 5,933, the flop file and the 20 runout files; the storage ledger's library bytes for the day are exactly this | none | recorded |
| Scenario rows | 20, one per runout, flop weight 24 | one per kept runout | Pass |
| Notification | `coverage_added` with `{"config_id":"cfg_6_online_100","pair":"BB-BTN","flop":"Kc7d2h","build_id":"01a1acd9-d958-7df7-ae41-f781f662581f","scenario_count":20}` | a notify observed (R2.22) | Pass |
| K in `builder_setting` | `k_runouts` 20, `k_runouts_rare` 10, `plan_configs` [] | K written (R2.22) | Pass |

The runout bytes differ from the Zenbook's (mean 366,306 against 368,796, a 0.7 percent difference) while the exploitability, the iterations and the tree hash match. This was not traced in this sitting; the projection below uses the Mac's own bytes.

Per-container peak memory against 02 section 6.2, from `just mac-peaks` (cgroup `memory.peak`) with all three services up after the build.

| Service | Peak bytes | Budget bytes | Result |
|---|---|---|---|
| library-builder | 1,487,368,192 | 5,368,709,120 (5 GiB) | Pass |
| postgres-mac | 123,723,776 | 1,073,741,824 (1 GiB) | Pass |
| seaweedfs-mac | 351,866,880 | 536,870,912 (512 MiB) | Pass |

Storage projection from the Mac's bytes (O-51). The same counts as sitting 1, with one line costing 48,034 + K x 366,306 bytes: the seven-line top pair gives 1,755 x 7 x 7,374,149 = 90.6 GB plus 184 x 42 x 3,711,092 = 28.7 GB for the rest, 119.3 GB in all; a three-line top pair gives 70.2 GB. Both are inside 650 GB, so K stays at 20 and 10, with the same caveat as sitting 1 (the single-raised line only; S20b replaces it with a real build's bytes).

Reference library. Nothing imported into `reference-private` under O-61, as in sitting 1 (`reference_bytes` 0 in the ledger).

Left running. Postgres, SeaweedFS and the builder are up and healthy under the `mac` profile with `restart: unless-stopped`; the builder is idle with planning off (`plan_configs` []), so it builds only what is queued by hand.

### Pending: the external drive

These steps did not run because no backup drive was attached. They are not passed.

- `just mac-backup-install` (the nightly LaunchAgent at 03:30), the first `just mac-backup`, and `just mac-restore-check` with verdict restored. `BACKUP_DRIVE_PATH` must name the mounted drive first.
- The smoke build's cleanup (O-61). The preview ran and deleted nothing: job 01a1acd9-7ae3-72f8-abd5-c13146fbe7b2, solution 01a1acd9-d958-7df7-ae41-f781f662581f, status `published`, 7,380,082 bytes, 20 scenarios, prefix `builds/cfg_6_online_100/BB-BTN/Kc7d2h/01a1acd9-d958-7df7-ae41-f781f662581f`. It waits for two reasons. The restore check verifies the newest build against the mirror, so the build must survive until the first backup and restore check have run. And the purge runs in the `backup-mirror` one-shot, which bind-mounts the drive; without it the mount can fail after the rows are already deleted, leaving the prefix behind. Order once the drive is attached: install, backup, restore check, then `just mac-smoke-clean 01a1acd9-7ae3-72f8-abd5-c13146fbe7b2 --yes` on the owner's go.

The smoke build stays published in the library bucket until then. Nothing serves it: Deploy 1 runs no `solver-query` on the Mac (O-46).

The owner's decision at the sitting: no drive is available for the foreseeable future, and the cleanup waits for the drive rather than running now. Until a drive arrives, the Mac has no backup at all, nightly or by hand. The database and the bucket hold only the smoke build and settings, all rebuildable from the repo, so nothing is at risk yet; that changes once S20b imports the first pack or the builder publishes real builds. Proposed question O-514 asks where the backup goes without a drive.

## Phase 2 Definition of Done

| Item | Evidence | Result |
|---|---|---|
| G1, G2 and G3 pass in the CI `rust` job (R2.4 to R2.6) | the table at the top; `rust` green again at 8608609 on this branch (https://github.com/emstacho-su/g-tee-oh/actions/runs/42070974187) | Pass |
| G4 passes and is stored privately; the public `tools/validate g4` step runs on a generic dump (R2.11) | the table at the top | Pass |
| G6a passes in public CI with its provenance note, then in every CI run (R2.19, O-63) | the table at the top; the same `rust` run | Pass |
| A simple-tree flop solve on the Mac builder inside 5 GB within the O-50 time rule (R2.22) | sitting 2: 292.0 seconds, peak 1,487,368,192 bytes | Pass |
| The no-solve tests: the `cargo tree` and `pnpm why` steps in CI and green (R2.15) | `just rust-boundary` in `rust` and `just ts-boundary` in `ts`, both green at 8608609 | Pass |
| The Deploy 1 report meets O-50 and O-51, and the builder runs on the O-52 line (R2.22) | this section; the builder running, idle after publishing the O-52 line, planning off | Pass |
| Every requirement R2.1 to R2.22 has its test green or its gate artifact present | all seven CI workflows (rust, ts, e2e, contracts, images, licenses, security) green at 8608609; the gate artifacts in the table at the top; the rows were not re-traced one by one in this sitting | Pass, by CI |
| S12 to S19 merged into `sprint/1-v1` by pull request; S20 merged after Deploy 1 | the S20 handoff status (2026-11-04); S20's pull request 55 is open and the owner merges it | Pass for S12 to S19; S20 open |
| The partial criteria carry their named tests (criteria 2, 3, 4, 5, 9, 10, 11) | in the CI suites green at 8608609 | Pass, by CI |
| Deploy 1 with the owner's explicit yes at that moment (O-20), on the Mac (O-59), after the S04 report was checked (R0.9, O-67) | the yes at 2026-11-05T17:54:16Z; `mac-bootstrap.md` in the table at the top | Pass |
| The spike report for both machines and the O-4 decision recorded in 00 (R2.21) | both spike reports pass; 00 lives in the vault, which is not on the Mac, so the O-4 record is checked from the Zenbook | Pass for the reports; the O-4 record not checked here |
| The first real build from the packed configuration, or the O-61 smoke build ran and its `smoke/` prefix was deleted after the report (O-41, O-61) | the smoke build ran on both machines; the Zenbook's was deleted; the Mac's waits for the drive | Pending |
| R2.22's backup: the nightly job installed and the first backup present with one solution restored from it | not run: no drive attached | Pending |

Gate verdict. Every Phase 2 gate condition that can be measured without the external drive passes. Two items stay open until a drive is attached: the backup with its restore check, and the smoke build's cleanup. The owner chose to merge with them recorded as pending; a follow-up closes them.
