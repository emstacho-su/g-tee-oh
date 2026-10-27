# Flop-line benchmark: bench-flop-line

Tool-written by `library-builder bench-report` from the run summaries; rerun the tool to change a number, never edit this page.

- Verdict against O-50: pass
- R IDs: R2.12, R2.16, R2.17, R2.18
- Commit: 635fd4ebd94916e7af9c7ecf1c806f9f320c64bc
- Date: 2026-10-27T18:44:56Z
- Machine: zenbook, Windows 11 Home, AMD Ryzen AI 9 465 w/ Radeon 880M, 20 logical cores, 31 GB of memory
- Toolchain: g-tee-oh-builder/0.1.0

## Thresholds (O-50)

| Limit | Bound |
|---|---|
| exploitability_pct_pot | at most 0.3 pct_pot |
| peak_rss_bytes | under 5000000000 bytes |
| seconds_per_line | at most 1800.0 seconds |

## Measurements

| Id | Value | Unit | Threshold | Verdict |
|---|---|---|---|---|
| flop-line/staged | 1.0 | boolean | at least 1 boolean | pass |
| flop-line/peak-rss | 1592279040 | bytes | under 5000000000 bytes | pass |
| flop-line/r250.c/seconds | 396.841611714 | seconds | at most 1800.0 seconds | pass |
| flop-line/r250.c/gain-oop | 0.25305747985839844 | pct_pot | at most 0.3 pct_pot | pass |
| flop-line/r250.c/gain-ip | 0.2836449579759078 | pct_pot | at most 0.3 pct_pot | pass |
| flop-line/r250.c/iterations | 240 | iterations | none | informational |
| flop-line/r250.c/estimate-bytes | 1468527056 | bytes | none | informational |
| flop-line/r250.c/flop-bytes | 48052 | bytes | none | informational |
| flop-line/r250.c/mean-runout-bytes | 366613 | bytes | none | informational |
| flop-line/bytes-written | 7386222 | bytes | none | informational |
| flop-line/job-seconds | 402.086883426 | seconds | none | informational |
| flop-line-16bit/staged | 1 | boolean | none | informational |
| flop-line-16bit/peak-rss | 919986176 | bytes | none | informational |
| flop-line-16bit/r250.c/seconds | 485.913231474 | seconds | none | informational |
| flop-line-16bit/r250.c/gain-oop | 0.403894077647816 | pct_pot | none | informational |
| flop-line-16bit/r250.c/gain-ip | 0.4875524477525191 | pct_pot | none | informational |
| flop-line-16bit/r250.c/iterations | 210 | iterations | none | informational |
| flop-line-16bit/r250.c/estimate-bytes | 795214176 | bytes | none | informational |
| flop-line-16bit/r250.c/flop-bytes | 50823 | bytes | none | informational |
| flop-line-16bit/r250.c/mean-runout-bytes | 389659 | bytes | none | informational |
| flop-line-16bit/bytes-written | 7849911 | bytes | none | informational |
| flop-line-16bit/job-seconds | 492.16623249 | seconds | none | informational |
| sweep/flops | 1755 | flops | none | informational |
| sweep/cap-bytes | 5368709120 | bytes | none | informational |
| sweep/r250.c/max-estimate-bytes | 1558549576 | bytes | none | informational |
| sweep/r250.c/min-estimate-bytes | 1246447400 | bytes | none | informational |

## Notes

Judged against O-50: peak resident set size under 5000000000 bytes and every line at most 1800 seconds to 0.3 percent of the pot for both seats; a miss is recorded as a miss (O-178). Verdict: pass. peak resident set size 1592279040 bytes is under the O-50 limit of 5000000000 bytes; every line finished within the O-50 limit of 1800 seconds; both seats of every line reached the O-50 target of 0.3 percent of the pot. By the bench method the judged summary is the 32-bit run at the 0.3 percent target (O-194, O-200), the judged storage of O-50 by the O-200 erratum. Judged run stop reasons: r250.c target. The flop-line-16bit rows are the informational 16-bit run at the 0.5 percent floor of O-194, never judged (O-200); its stop reasons: r250.c target. The sweep estimated 1755 canonical flops per line at 32-bit storage against a cap of 5368709120 bytes (O-194): r250.c at most 1558549576 bytes on 2c2d2h.
