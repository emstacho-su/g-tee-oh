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

Mechanism. The dev profile's Postgres and SeaweedFS ran under the Windows Subsystem for Linux 2 (WSL2) backend with the migrations applied. Three settings were written through `scripts/mac/setting.mjs`: `plan_configs` set to `[]`, so the builder plans nothing beyond the one job (O-509), `k_runouts` 20 and `k_runouts_rare` 10 (O-14, O-191). One job was queued through the new `library-builder queue` command (O-510), which computes the tree hash the way the claim path checks it and writes the flop in its canonical form: the O-52 line (online 6-max 100 big blinds, big blind against button single-raised pot, line `r250.c`) on Kh7d2c, written as Kc7d2h, K = 20, at the head of the queue. `library-builder --once --job <id>` then ran in the builder container under its compose limits (5 GB memory, no swap beyond it) with the hand-made ranges the image carries (O-83, O-201), while a separate Postgres session listened on `coverage_added`. The run is a smoke build in the sense of O-61: its ranges are not solver output, so its strategy is not a library entry, but its memory, time and bytes are the engine's on the real tree.

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

To be recorded at the Mac sitting: the time of the owner's explicit yes (O-20), `just mac-up`, the migrations and buckets, the settings, the queued O-52 line claimed by the running builder, the published build's numbers on the Mac against O-50, per-container peak memory against 02 section 6.2, the O-51 projection from the Mac's bytes, the nightly backup job installed, the first backup and the restore check, the smoke build removed, and the builder left running with planning off.
