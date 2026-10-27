# Gate report g6a-pushfold (R2.19)

| Field | Value |
|---|---|
| R IDs | R2.19 |
| Commit | 2233fccbdd905ef97f751f3157eaa46264de14de |
| Date | 2026-10-27T22:01:51Z |
| Machine | zenbook (AMD Ryzen AI 9 465 w/ Radeon 880M, 20 cores, 31 GB, Windows 11 (26200)) |
| Toolchain | rustc 1.99.1 (58cf8f9c3 2026-10-13) |
| Verdict | pass |

Push/fold solved exactly per depth: CFR+ (alternating updates, linear averaging) over the 169 classes with exact card removal finds the support, the mixed classes are solved from their indifference equations by Gaussian elimination in f64, and an exact best response certifies each seat's gain at or below 1e-9 bb (O-223). EVs follow O-224: final stack minus the stack behind at the node, in bb.
Depth 1 bb: 256 CFR+ iterations, gains BB 0e0 bb and BTN 0e0 bb, mixed push [], mixed call [], committed preflop/cfg_2_online_norake_1/be0d7db1-7b41-80dd-9023-5ed65fd3eeb5 (0 differences).
Depth 2 bb: 256 CFR+ iterations, gains BB 0e0 bb and BTN 0e0 bb, mixed push [], mixed call [], committed preflop/cfg_2_online_norake_2/2a661c8a-ac05-861d-95b8-774516758df1 (0 differences).
Depth 3 bb: 256 CFR+ iterations, gains BB 0e0 bb and BTN 0e0 bb, mixed push [T2o 0.344114], mixed call [63o 0.461797], committed preflop/cfg_2_online_norake_3/78c3a07c-1409-842b-97c8-6d236a6521c2 (0 differences).
Depth 4 bb: 256 CFR+ iterations, gains BB 0e0 bb and BTN 0e0 bb, mixed push [], mixed call [], committed preflop/cfg_2_online_norake_4/936f5b76-f371-8240-9242-1ff1dcd12cbb (0 differences).
Depth 5 bb: 256 CFR+ iterations, gains BB 0e0 bb and BTN 0e0 bb, mixed push [96o 0.156335], mixed call [97o 0.751653], committed preflop/cfg_2_online_norake_5/ecaa3711-e6e9-8a38-91a7-553fff6ba065 (0 differences).
Depth 6 bb: 256 CFR+ iterations, gains BB 0e0 bb and BTN 0e0 bb, mixed push [86o 0.990397], mixed call [98o 0.999139], committed preflop/cfg_2_online_norake_6/6d84d8be-9d14-854a-93cb-e90f149af794 (0 differences).
Depth 7 bb: 256 CFR+ iterations, gains BB 0e0 bb and BTN 1.7917216398395484e-17 bb, mixed push [86o 0.772866], mixed call [97s 0.658180], committed preflop/cfg_2_online_norake_7/119c6e27-8768-8ee0-b67f-d3380d997793 (0 differences).
Depth 8 bb: 256 CFR+ iterations, gains BB 0e0 bb and BTN 0e0 bb, mixed push [Q4o 0.191686], mixed call [Q7o 0.528463], committed preflop/cfg_2_online_norake_8/8cb085eb-7568-849e-8a49-5b9624fef56f (0 differences).
Depth 9 bb: 256 CFR+ iterations, gains BB 0e0 bb and BTN 0e0 bb, mixed push [], mixed call [], committed preflop/cfg_2_online_norake_9/3985998c-c4cd-8176-a404-f2d5982ef323 (0 differences).
Depth 10 bb: 256 CFR+ iterations, gains BB 0e0 bb and BTN 0e0 bb, mixed push [43s 0.710748], mixed call [Q6s 0.402779], committed preflop/cfg_2_online_norake_10/77d568b2-bf44-8f55-b130-48954e2ac642 (0 differences).
Depth 11 bb: 256 CFR+ iterations, gains BB 3.583443279679097e-17 bb and BTN 0e0 bb, mixed push [76o 0.054719], mixed call [K6o 0.548098], committed preflop/cfg_2_online_norake_11/479b8a45-2412-819c-8208-a9dd30bad818 (0 differences).
Depth 12 bb: 256 CFR+ iterations, gains BB 0e0 bb and BTN 0e0 bb, mixed push [], mixed call [], committed preflop/cfg_2_online_norake_12/ae24c412-885f-8f01-a385-0959a7405df6 (0 differences).
Depth 13 bb: 256 CFR+ iterations, gains BB 0e0 bb and BTN 0e0 bb, mixed push [J8o 0.811837], mixed call [JTo 0.035294], committed preflop/cfg_2_online_norake_13/6748bc40-4ad4-8d35-a925-4f092cb1339c (0 differences).
Depth 14 bb: 256 CFR+ iterations, gains BB 0e0 bb and BTN 0e0 bb, mixed push [J8o 0.287813], mixed call [K8o 0.208919], committed preflop/cfg_2_online_norake_14/20f7d2e6-a87e-8f43-a41c-dd734c1b256f (0 differences).
Depth 15 bb: 256 CFR+ iterations, gains BB 0e0 bb and BTN 0e0 bb, mixed push [Q4s 0.844934], mixed call [QTo 0.711405], committed preflop/cfg_2_online_norake_15/1874e345-dfe7-8889-85f0-62b3a077db65 (0 differences).
Chart: HoldemResources.net heads-up push/fold Nash equilibrium chart, no-ante variant, https://www.holdemresources.net/hune; parameters: heads-up, small blind 0.5, big blind 1, no ante, no rake, effective stack before blinds, push or fold. Its per-hand thresholds are not redistributed: the site grants no reuse right (O-221), so the transcription stays outside the repository, named by --chart or G6A_CHART_PATH.
Chart comparison against "HoldemResources.net, HeadsUp Push/Fold Nash Equilibrium, No Ante charts (Pusher and Caller)" (https://www.holdemresources.net/hune, retrieved 2026-10-27): 7 disagreements between the chart and the solution's majority action (frequency at least 0.5 is in), the largest absolute EV gap 0.007699 bb; near-indifferent means at most 0.02 bb (O-222).
Disagreement: depth 4 bb, 53s push, our frequency 0.000000, EV gap -0.007699 bb.
Disagreement: depth 5 bb, 96o push, our frequency 0.156335, EV gap 0.000000 bb.
Disagreement: depth 6 bb, 94s push, our frequency 0.000000, EV gap -0.003859 bb.
Disagreement: depth 6 bb, 63s push, our frequency 0.000000, EV gap -0.000735 bb.
Disagreement: depth 8 bb, 84s push, our frequency 0.000000, EV gap -0.001515 bb.
Disagreement: depth 8 bb, 43s push, our frequency 0.000000, EV gap -0.002819 bb.
Disagreement: depth 9 bb, 84s push, our frequency 0.000000, EV gap -0.001413 bb.

| Measurement | Value | Unit | Threshold | Pass |
|---|---|---|---|---|
| depth-1/certificate-gain | 0 | bb | at most 0.000000001 bb | yes |
| depth-1/library-frequency-diff | 0 | frequency | at most 0.00392156862745098 frequency | yes |
| depth-1/library-differences | 0 | count | at most 0 count | yes |
| depth-1/iterations | 256 | count | none | informational |
| depth-2/certificate-gain | 0 | bb | at most 0.000000001 bb | yes |
| depth-2/library-frequency-diff | 0 | frequency | at most 0.00392156862745098 frequency | yes |
| depth-2/library-differences | 0 | count | at most 0 count | yes |
| depth-2/iterations | 256 | count | none | informational |
| depth-3/certificate-gain | 0 | bb | at most 0.000000001 bb | yes |
| depth-3/library-frequency-diff | 0.0009841960230577151 | frequency | at most 0.00392156862745098 frequency | yes |
| depth-3/library-differences | 0 | count | at most 0 count | yes |
| depth-3/iterations | 256 | count | none | informational |
| depth-4/certificate-gain | 0 | bb | at most 0.000000001 bb | yes |
| depth-4/library-frequency-diff | 0 | frequency | at most 0.00392156862745098 frequency | yes |
| depth-4/library-differences | 0 | count | at most 0 count | yes |
| depth-4/iterations | 256 | count | none | informational |
| depth-5/certificate-gain | 0 | bb | at most 0.000000001 bb | yes |
| depth-5/library-frequency-diff | 0.0012885898231669302 | frequency | at most 0.00392156862745098 frequency | yes |
| depth-5/library-differences | 0 | count | at most 0 count | yes |
| depth-5/iterations | 256 | count | none | informational |
| depth-6/certificate-gain | 0 | bb | at most 0.000000001 bb | yes |
| depth-6/library-frequency-diff | 0.0017598871835575736 | frequency | at most 0.00392156862745098 frequency | yes |
| depth-6/library-differences | 0 | count | at most 0 count | yes |
| depth-6/iterations | 256 | count | none | informational |
| depth-7/certificate-gain | 0.000000000000000017917216398395484 | bb | at most 0.000000001 bb | yes |
| depth-7/library-frequency-diff | 0.0006436420234078311 | frequency | at most 0.00392156862745098 frequency | yes |
| depth-7/library-differences | 0 | count | at most 0 count | yes |
| depth-7/iterations | 256 | count | none | informational |
| depth-8/certificate-gain | 0 | bb | at most 0.000000001 bb | yes |
| depth-8/library-frequency-diff | 0.0009492617886379673 | frequency | at most 0.00392156862745098 frequency | yes |
| depth-8/library-differences | 0 | count | at most 0 count | yes |
| depth-8/iterations | 256 | count | none | informational |
| depth-9/certificate-gain | 0 | bb | at most 0.000000001 bb | yes |
| depth-9/library-frequency-diff | 0 | frequency | at most 0.00392156862745098 frequency | yes |
| depth-9/library-differences | 0 | count | at most 0 count | yes |
| depth-9/iterations | 256 | count | none | informational |
| depth-10/certificate-gain | 0 | bb | at most 0.000000001 bb | yes |
| depth-10/library-frequency-diff | 0.0011424105858544586 | frequency | at most 0.00392156862745098 frequency | yes |
| depth-10/library-differences | 0 | count | at most 0 count | yes |
| depth-10/iterations | 256 | count | none | informational |
| depth-11/certificate-gain | 0.00000000000000003583443279679097 | bb | at most 0.000000001 bb | yes |
| depth-11/library-frequency-diff | 0.0009218172471320285 | frequency | at most 0.00392156862745098 frequency | yes |
| depth-11/library-differences | 0 | count | at most 0 count | yes |
| depth-11/iterations | 256 | count | none | informational |
| depth-12/certificate-gain | 0 | bb | at most 0.000000001 bb | yes |
| depth-12/library-frequency-diff | 0 | frequency | at most 0.00392156862745098 frequency | yes |
| depth-12/library-differences | 0 | count | at most 0 count | yes |
| depth-12/iterations | 256 | count | none | informational |
| depth-13/certificate-gain | 0 | bb | at most 0.000000001 bb | yes |
| depth-13/library-frequency-diff | 0.00007249863842639925 | frequency | at most 0.00392156862745098 frequency | yes |
| depth-13/library-differences | 0 | count | at most 0 count | yes |
| depth-13/iterations | 256 | count | none | informational |
| depth-14/certificate-gain | 0 | bb | at most 0.000000001 bb | yes |
| depth-14/library-frequency-diff | 0.0015383548032948946 | frequency | at most 0.00392156862745098 frequency | yes |
| depth-14/library-differences | 0 | count | at most 0 count | yes |
| depth-14/iterations | 256 | count | none | informational |
| depth-15/certificate-gain | 0 | bb | at most 0.000000001 bb | yes |
| depth-15/library-frequency-diff | 0.0017963579741054891 | frequency | at most 0.00392156862745098 frequency | yes |
| depth-15/library-differences | 0 | count | at most 0 count | yes |
| depth-15/iterations | 256 | count | none | informational |
| chart/max-ev-gap | 0.007698838905393024 | bb | at most 0.02 bb | yes |
| chart/disagreements | 7 | count | none | informational |
