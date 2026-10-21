# Gate report g2-akq (R2.5)

| Field | Value |
|---|---|
| R IDs | R2.5 |
| Commit | 48e1cb7bfdfd61dd7207f1e11f03f5d7b21df137 |
| Date | 2026-10-21T00:41:36Z |
| Machine | zenbook (AMD Ryzen AI 9 465 w/ Radeon 880M, 20 cores, 31 GB, Windows 11 (26200)) |
| Toolchain | rustc 1.99.1 (58cf8f9c3 2026-10-13) |
| Verdict | pass |

DCFR default schedule (alpha 1.5, beta 0, gamma 2, no regret floor) in chunks of 1000 iterations until NashConv < 0.00001 chips or 1000000 iterations; every strategy fact and ratio fact judged within 0.005 in frequency units (the fixture's 0.5 percentage points); bluff share = weighted bluff bets / weighted bets, defense share = weighted calls of the holdings facing a bluff / their weight; fixture validation/fixtures/toy-games/akq.json

| Measurement | Value | Unit | Threshold | Pass |
|---|---|---|---|---|
| akq/pot1-bet-quarter/p1-open-bet-q | 0.2000708431005478 | frequency | 0.195 to 0.20500000000000002 frequency | yes |
| akq/pot1-bet-quarter/p1-open-bet-k | 0.00000000018735957230120448 | frequency | -0.005 to 0.005 frequency | yes |
| akq/pot1-bet-quarter/p1-open-bet-a | 1 | frequency | 0.995 to 1.005 frequency | yes |
| akq/pot1-bet-quarter/p0-facing-bet-call-q | 0.0000000001873596000567801 | frequency | -0.005 to 0.005 frequency | yes |
| akq/pot1-bet-quarter/p0-facing-bet-call-k | 0.6000082492828369 | frequency | 0.595 to 0.605 frequency | yes |
| akq/pot1-bet-quarter/p0-facing-bet-call-a | 1 | frequency | 0.995 to 1.005 frequency | yes |
| akq/pot1-bet-quarter/bluff-share-of-bets | 0.1667158603340462 | frequency | 0.16166666666666665 to 0.17166666666666666 frequency | yes |
| akq/pot1-bet-quarter/defense-share-of-range | 0.8000041246414185 | frequency | 0.795 to 0.805 frequency | yes |
| akq/pot1-bet-quarter/nash-conv | 0.000006237998604774475 | chips | none | informational |
| akq/pot1-bet-quarter/iterations | 2000 | iterations | none | informational |
| akq/pot1-bet-half/p1-open-bet-q | 0.33330008387565613 | frequency | 0.3283333333333333 to 0.3383333333333333 frequency | yes |
| akq/pot1-bet-half/p1-open-bet-k | 0.000000000004372269473557067 | frequency | -0.005 to 0.005 frequency | yes |
| akq/pot1-bet-half/p1-open-bet-a | 0.9999999403953552 | frequency | 0.995 to 1.005 frequency | yes |
| akq/pot1-bet-half/p0-facing-bet-call-q | 0.000000000004372269473557067 | frequency | -0.005 to 0.005 frequency | yes |
| akq/pot1-bet-half/p0-facing-bet-call-k | 0.3333057165145874 | frequency | 0.3283333333333333 to 0.3383333333333333 frequency | yes |
| akq/pot1-bet-half/p0-facing-bet-call-a | 0.9999999403953552 | frequency | 0.995 to 1.005 frequency | yes |
| akq/pot1-bet-half/bluff-share-of-bets | 0.24998130788814518 | frequency | 0.245 to 0.255 frequency | yes |
| akq/pot1-bet-half/defense-share-of-range | 0.6666528284549713 | frequency | 0.6616666666666666 to 0.6716666666666666 frequency | yes |
| akq/pot1-bet-half/nash-conv | 0.0000073909759521484375 | chips | none | informational |
| akq/pot1-bet-half/iterations | 7000 | iterations | none | informational |
| akq/pot1-bet-pot/p1-open-bet-q | 0.00008642899774713442 | frequency | -0.005 to 0.505 frequency | yes |
| akq/pot1-bet-pot/p1-open-bet-k | 0.0000000014977492579504315 | frequency | -0.005 to 0.005 frequency | yes |
| akq/pot1-bet-pot/p1-open-bet-a | 0.999951183795929 | frequency | 0.995 to 1.005 frequency | yes |
| akq/pot1-bet-pot/p0-facing-bet-call-q | 0.0000000014977492579504315 | frequency | -0.005 to 0.005 frequency | yes |
| akq/pot1-bet-pot/p0-facing-bet-call-k | 0.00000001684968076176574 | frequency | -0.005 to 0.005 frequency | yes |
| akq/pot1-bet-pot/p0-facing-bet-call-a | 1 | frequency | 0.995 to 1.005 frequency | yes |
| akq/pot1-bet-pot/defense-share-of-range | 0.5000000084248404 | frequency | 0.495 to 0.505 frequency | yes |
| akq/pot1-bet-pot/nash-conv | 0 | chips | none | informational |
| akq/pot1-bet-pot/iterations | 1000 | iterations | none | informational |
| akq/polar-river-pot-bet/p1-open-bet-nuts | 1 | frequency | 0.995 to 1.005 frequency | yes |
| akq/polar-river-pot-bet/p1-open-bet-air | 0.49999746680259705 | frequency | 0.495 to 0.505 frequency | yes |
| akq/polar-river-pot-bet/p0-facing-bet-call-bluff-catcher | 0.5000174045562744 | frequency | 0.495 to 0.505 frequency | yes |
| akq/polar-river-pot-bet/bluff-share-of-bets | 0.33333220746591957 | frequency | 0.3283333333333333 to 0.3383333333333333 frequency | yes |
| akq/polar-river-pot-bet/defense-share-of-bluff-catchers | 0.5000174045562744 | frequency | 0.495 to 0.505 frequency | yes |
| akq/polar-river-pot-bet/nash-conv | 0.000009953975677490234 | chips | none | informational |
| akq/polar-river-pot-bet/iterations | 44000 | iterations | none | informational |
