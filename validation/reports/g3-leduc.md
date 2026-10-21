# Gate report g3-leduc (R2.6)

| Field | Value |
|---|---|
| R IDs | R2.6 |
| Commit | 48e1cb7bfdfd61dd7207f1e11f03f5d7b21df137 |
| Date | 2026-10-21T00:41:36Z |
| Machine | zenbook (AMD Ryzen AI 9 465 w/ Radeon 880M, 20 cores, 31 GB, Windows 11 (26200)) |
| Toolchain | rustc 1.99.1 (58cf8f9c3 2026-10-13) |
| Verdict | pass |

plain CFR: alternating updates as OpenSpiel's CFRSolver runs them (O-128), uniform averaging, no discounting, no regret floor; exploitability = NashConv / 2 per O-108, O-109. Fixture average-policy value to player 0 at iteration 5000: -0.0859431179350123 chips (reports only). Curve openspiel/leduc_exploitability.json with provenance openspiel/PROVENANCE.md.

| Measurement | Value | Unit | Threshold | Pass |
|---|---|---|---|---|
| leduc/plain-cfr/exploitability@1 | 2.373611196875572 | chips | 2.13625 to 2.610972222222222 chips | yes |
| leduc/plain-cfr/exploitability@10 | 0.8885789960622787 | chips | 0.7997210848518921 to 0.977436881485646 chips | yes |
| leduc/plain-cfr/exploitability@100 | 0.09571578353643417 | chips | 0.08614471770413785 to 0.10528798830505738 chips | yes |
| leduc/plain-cfr/exploitability@1000 | 0.012098122388124466 | chips | 0.010636029233807659 to 0.012999591285764917 chips | yes |
| leduc/plain-cfr/exploitability@5000 | 0.0032889991998672485 | chips | 0.002552366213441127 to 0.004552366213441127 chips | yes |
| leduc/plain-cfr/value-player-0@5000 | -0.08592837303876877 | chips | none | informational |
| leduc/dcfr-default/exploitability@1 | 2.373611196875572 | chips | none | informational |
| leduc/dcfr-default/exploitability@10 | 0.7788012027740479 | chips | none | informational |
| leduc/dcfr-default/exploitability@100 | 0.00683227926492691 | chips | none | informational |
| leduc/dcfr-default/exploitability@1000 | 0.0001696273684501648 | chips | none | informational |
| leduc/dcfr-default/exploitability@5000 | 0.000009838491678237915 | chips | none | informational |
