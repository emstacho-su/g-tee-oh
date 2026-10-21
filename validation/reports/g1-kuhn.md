# Gate report g1-kuhn (R2.4)

| Field | Value |
|---|---|
| R IDs | R2.4 |
| Commit | 48e1cb7bfdfd61dd7207f1e11f03f5d7b21df137 |
| Date | 2026-10-21T00:41:36Z |
| Machine | zenbook (AMD Ryzen AI 9 465 w/ Radeon 880M, 20 cores, 31 GB, Windows 11 (26200)) |
| Toolchain | rustc 1.99.1 (58cf8f9c3 2026-10-13) |
| Verdict | pass |

engine DCFR with the default schedule (alpha 1.5, beta 0, gamma 2, regret floor off), chunks of 1000 iterations until NashConv < 0.0001 chips or 200000 iterations; NashConv = gain_0 + gain_1 of the average strategy, judged strictly below exploitability_max; the strategy facts are informational and document the one-parameter equilibrium family, parameter a = 0.1892087757587433 bound from p0-open-bet-j; fixture validation/fixtures/toy-games/kuhn.json

| Measurement | Value | Unit | Threshold | Pass |
|---|---|---|---|---|
| kuhn/standard/value-player-0 | -0.05555558204650879 | chips | none | informational |
| kuhn/standard/value-abs-error | 0.000000026490953236590897 | chips | at most 0.001 chips | yes |
| kuhn/standard/nash-conv | 0.00006592646241188049 | chips | at most 0.001 chips | yes |
| kuhn/standard/iterations | 5000 | iterations | none | informational |
| kuhn/standard/parameter-a | 0.1892087757587433 | frequency | none | informational |
| kuhn/standard/p0-facing-bet-after-check-call-j | 0.000000000007397937297481949 | frequency | none | informational |
| kuhn/standard/p0-facing-bet-after-check-call-k | 1 | frequency | none | informational |
| kuhn/standard/p0-facing-bet-after-check-call-q | 0.5228664875030518 | frequency | none | informational |
| kuhn/standard/p0-open-bet-j | 0.1892087757587433 | frequency | none | informational |
| kuhn/standard/p0-open-bet-k | 0.5676799416542053 | frequency | none | informational |
| kuhn/standard/p0-open-bet-q | 0.000000001047003039822414 | frequency | none | informational |
| kuhn/standard/p1-after-check-bet-j | 0.33332559466362 | frequency | none | informational |
| kuhn/standard/p1-after-check-bet-k | 1 | frequency | none | informational |
| kuhn/standard/p1-after-check-bet-q | 0.0000000003598902009738225 | frequency | none | informational |
| kuhn/standard/p1-facing-bet-call-j | 0.000000000011996304123684798 | frequency | none | informational |
| kuhn/standard/p1-facing-bet-call-k | 1 | frequency | none | informational |
| kuhn/standard/p1-facing-bet-call-q | 0.3333888351917267 | frequency | none | informational |
