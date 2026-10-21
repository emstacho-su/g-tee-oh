# Library size estimate (R2.7)

Synthetic data, not measured solver output. Written by `library-pack estimate --seed 7`
from seeded synthetic trees (O-57); S20 replaces these numbers with real bytes (O-51).

R IDs: R2.7, as planning input for R-19.

## Method

1. `gto_library::synthetic_tree` builds one turn and river runout tree and one flop tree per
   scenario from seed 7; the configuration, seats, board, ranges, frequencies and
   expected values are drawn from that seed, and combos holding a board card are left out.
2. `NodeRecord::from_solved` quantizes every node into the record the writer stores (A3
   section 4, O-130): per hand 4 bytes of reach, 4 of best expected value, 1 per action of
   strategy and 2 per action of loss, plus a 2-byte hand index when the node holds fewer
   hands than the space, so 8 + 3a bytes at a actions, 19 at 3 actions on a board, against
   the 3 bytes per action, 9 at 3 actions, that 02 section 5.2 assumed. Raw bytes below are
   these records before compression; S18 and S20 confirm the gap on real solves.
3. `encode_file`, the chunk encoder `write_tree_file` calls, turns the records into one file
   at each setting: the writer's zstd level 19 with 64 KiB frames, level 3 with
   64 KiB frames, and level 19 with 256 KiB frames (O-129). File bytes are the
   whole file, directory frame included. Each data frame is compressed on its own, so bytes
   grow linearly with nodes.
4. The synthetic reach and expected values are uniform random draws, which do not compress,
   so the ratios below are a floor for the format: a real solve's reach and values vary
   smoothly across hands and compress better, which is what S20 measures.

## Scenarios

| Scenario | Runout nodes | Flop tree nodes | Range share | Pure share | Actions |
|---|---|---|---|---|---|
| pessimistic | 1,200 | 100 | 1.00 | 0.25 | 3 to 4 |
| central | 1,000 | 50 | 0.85 | 0.50 | 3 to 3 |
| optimistic | 800 | 20 | 0.50 | 0.75 | 2 to 3 |

## Per runout

Bytes of one turn and river runout per scenario and setting; ratio is raw over file bytes.

| Scenario | Level | Frame KiB | Nodes | Hands/node | Raw bytes | File bytes | Ratio | Bytes/node |
|---|---|---|---|---|---|---|---|---|
| pessimistic | 19 | 64 | 1,200 | 1,104 | 27,268,914 | 20,965,203 | 1.30 | 17,471 |
| pessimistic | 3 | 64 | 1,200 | 1,104 | 27,268,914 | 21,229,782 | 1.28 | 17,691 |
| pessimistic | 19 | 256 | 1,200 | 1,104 | 27,268,914 | 19,908,112 | 1.36 | 16,590 |
| central | 19 | 64 | 1,000 | 939 | 17,889,000 | 14,156,873 | 1.26 | 14,156 |
| central | 3 | 64 | 1,000 | 939 | 17,889,000 | 14,403,913 | 1.24 | 14,403 |
| central | 19 | 256 | 1,000 | 939 | 17,889,000 | 13,688,428 | 1.30 | 13,688 |
| optimistic | 19 | 64 | 800 | 552 | 7,760,812 | 6,161,141 | 1.25 | 7,701 |
| optimistic | 3 | 64 | 800 | 552 | 7,760,812 | 6,360,387 | 1.22 | 7,950 |
| optimistic | 19 | 256 | 800 | 552 | 7,760,812 | 6,016,089 | 1.29 | 7,520 |

## Per flop tree

Bytes of one flop tree per scenario and setting; ratio is raw over file bytes.

| Scenario | Level | Frame KiB | Nodes | Hands/node | Raw bytes | File bytes | Ratio | Bytes/node |
|---|---|---|---|---|---|---|---|---|
| pessimistic | 19 | 64 | 100 | 1,176 | 2,412,366 | 1,849,533 | 1.30 | 18,495 |
| pessimistic | 3 | 64 | 100 | 1,176 | 2,412,366 | 1,873,212 | 1.28 | 18,732 |
| pessimistic | 19 | 256 | 100 | 1,176 | 2,412,366 | 1,760,145 | 1.37 | 17,601 |
| central | 19 | 64 | 50 | 1,000 | 952,400 | 752,365 | 1.26 | 15,047 |
| central | 3 | 64 | 50 | 1,000 | 952,400 | 765,365 | 1.24 | 15,307 |
| central | 19 | 256 | 50 | 1,000 | 952,400 | 728,109 | 1.30 | 14,562 |
| optimistic | 19 | 64 | 20 | 588 | 208,470 | 165,733 | 1.25 | 8,286 |
| optimistic | 3 | 64 | 20 | 588 | 208,470 | 170,878 | 1.21 | 8,543 |
| optimistic | 19 | 256 | 20 | 588 | 208,470 | 162,049 | 1.28 | 8,102 |

## Against the planning figures (02 section 5.2, 04 section 7, O-51)

One build is 4 preflop lines, each a flop tree plus K = 20 runouts (O-14, O-51), so
build bytes are 4 x (flop tree + 20 x runout) at the writer's setting. The plan assumed 3,000,000
per runout (1,000,000 to 10,000,000), about 250,000,000 per build, 40,000 to 342,000 per flop tree
and about 2,500 builds in 650,000,000,000.

| Scenario | Runout | Flop tree | Build | Builds in budget | Runout in plan | Flop tree in plan |
|---|---|---|---|---|---|---|
| pessimistic | 20,965,203 | 1,849,533 | 1,684,614,372 | 385 | above | above |
| central | 14,156,873 | 752,365 | 1,135,559,300 | 572 | above | above |
| optimistic | 6,161,141 | 165,733 | 493,554,212 | 1,316 | yes | yes |
