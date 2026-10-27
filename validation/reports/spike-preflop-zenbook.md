# Gate report spike-preflop-zenbook (R2.21)

| Field | Value |
|---|---|
| R IDs | R2.21 |
| Commit | 77ff43ec374c39dc887fb792a7d5b9ece78c15f3 |
| Date | 2026-10-27T22:03:54Z |
| Machine | zenbook (AMD Ryzen AI 9 465 w/ Radeon 880M, 20 cores, 20 GB, Debian GNU/Linux 12) |
| Toolchain | rustc 1.99.1 (58cf8f9c3 2026-10-13) |
| Verdict | pass |

100bb: measured (O-227 placeholder: heads-up BB-BTN at 100bb, realization factor 1.0 for both seats, rake-free, online seed sizing spec).
Pass rules. O-80: push/fold peak bytes under 5 GiB (the largest of the accounted, VmHWM and cgroup readings) and the G6a certificate gain at most 1e-9 bb at every depth; push/fold wall seconds are recorded, not gated. O-49: the measured 100bb run's peak under 4 GiB, its seconds to target under 12 hours and its larger seat gain at most 0.3 percent of the starting pot; an extrapolated 100bb figure is informational only.
push/fold, 15 depths from 1 to 15 bb: 0.298 s, 3840 iterations, gain 3.583443279679097e-17; peak accounted 1759458 bytes, VmHWM 6541312 bytes, cgroup 5423104 bytes.
100bb P2, 10 decision nodes, 7 flop lines: 0.377 s, 175 iterations, gain 2.5834675531773843e-1; peak accounted 1157741 bytes, VmHWM 6578176 bytes, cgroup 5423104 bytes.
Container: docker run --rm --memory 5g --memory-swap 5g g-tee-oh/spike-preflop:dev (linux/amd64, Docker Desktop WSL2 backend)
Heavy work running concurrently: none in this worktree; no cargo or rustc process on the machine at start; idle containers only (bb2dash workspace, harness-postgres, s18-throwaway-pg); bench.lock held by S19
working tree dirty at run time

| Measurement | Value | Unit | Threshold | Pass |
|---|---|---|---|---|
| push-fold/peak-bytes | 6541312 | bytes | under 5368709120 bytes | yes |
| push-fold/certificate-gain | 0.00000000000000003583443279679097 | bb | at most 0.000000001 bb | yes |
| push-fold/seconds | 0.298324384 | seconds | none | informational |
| push-fold/iterations | 3840 | iterations | none | informational |
| push-fold/peak-accounted | 1759458 | bytes | none | informational |
| push-fold/peak-vmhwm | 6541312 | bytes | none | informational |
| push-fold/peak-cgroup | 5423104 | bytes | none | informational |
| hu100/peak-bytes | 6578176 | bytes | under 4294967296 bytes | yes |
| hu100/seconds | 0.376972997 | seconds | under 43200 seconds | yes |
| hu100/gain-pct-pot | 0.25834675531773843 | percent of the starting pot | at most 0.3 percent of the starting pot | yes |
| hu100/iterations | 175 | iterations | none | informational |
| hu100/peak-accounted | 1157741 | bytes | none | informational |
| hu100/peak-vmhwm | 6578176 | bytes | none | informational |
| hu100/peak-cgroup | 5423104 | bytes | none | informational |
