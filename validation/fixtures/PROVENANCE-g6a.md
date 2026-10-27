# Provenance of gate G6a, heads-up push/fold

Gate G6a (R2.19, 04 section 6, O-63) checks the heads-up push/fold solver two ways: the
solver's own result must be the exact equilibrium of the game it models, and it must agree
with a published chart except at hands that are near-indifferent. This note records the
game, the chart, why the chart is not in the repository, how the comparison is rerun, and
how the committed fixture library under `library/preflop/cfg_2_online_norake_<d>/` is made.

## The game

Two players, both with the same stack of d big blinds (bb) before the blinds, d a whole
number from 1 to 15. The button posts the small blind of 0.5 bb and the big blind posts
1 bb; there is no ante and no rake (architecture decision record (ADR) 0014: rake models
exist only for the keyed stakes). The button folds or moves all-in; the big blind facing
the all-in folds or calls. Showdowns are valued with the committed 169 by 169 equity table
(`equity/preflop-169.json`, O-126), and each pair of hand classes is weighted by its count
of disjoint combo pairs, so the class game is the combination (combo) game with exact card
removal.

The configuration is `GameConfig` online, heads-up, the rake-free stake `norake` (50 and
100 cents, zero percent, zero cap), so the configuration identifiers read
`cfg_2_online_norake_<d>` (O-220). They are off the v1 catalog on purpose; `v1_configs()`
and the seed specs are unchanged.

## The chart (O-221)

- Name: HoldemResources.net, "HeadsUp Push/Fold Nash Equilibrium", the No Ante tab, Pusher
  and Caller charts.
- Address: https://www.holdemresources.net/hune
- Retrieved: 2026-10-27.
- Parameters as the page states them: two players, small blind half the big blind, no ante,
  no rake, effective stack before the blinds are posted, push or fold only. They match the
  game above exactly.
- Form: per hand class the largest effective stack, at 0.1 bb resolution, at which the small
  blind pushes and the big blind calls; "20+" means every stack up to 20 bb. Three hands
  have gaps in the push chart (63s, 53s and 43s) and are played on two stack ranges.

The page also links a raw-data archive of the unsimplified strategies. The gate does not
use it.

## Why the thresholds are not in the repository

The site's legal pages, https://www.holdemresources.net/legal and
https://www.holdemresources.net/legal/termsofuse (read 2026-10-27), grant no right to reuse
or redistribute the website's content. The only notice on the page is
"© 2026 HoldemResources GmbH", and the Terms of Use cover "only HRC software license keys"
(HRC is HoldemResources Calculator, the site's product).
With no grant, the per-hand thresholds are not committed anywhere in this repository: not
as a fixture, not in a test, not in a report. What is committed is the result of the
comparison (the hands that disagree, with depth, side, our frequency and expected value
(EV) gap), which is our solver's output, plus the chart's name, address and parameters.

## How the transcription was made

The page was downloaded with curl into an empty scratch directory outside the repository
and treated as untrusted data. A small Node.js script, kept in a different directory, read
the No Ante tab panel only and parsed its two 13 by 13 grids. Each grid cell carries the
page's own class for pairs, suited and offsuit hands; the script mapped a cell in row r and
column c to the pair when r equals c, to the suited class when the column rank is lower
than the row rank (above the diagonal), and to the offsuit class otherwise, and refused to
write anything when a cell's class disagreed with that mapping. It wrote "20+" as the
interval from 0 to 1000 bb, every other number t as the interval from 0 to t, and the three
gap hands as two intervals each from the footnote below the charts. It then checked the
page's own worked example (T3s pushes up to 7.7 bb, Q2o calls up to 5.6 bb), that AA is
"20+" on both charts and that all 169 classes are present once, before writing the
JavaScript Object Notation (JSON) file in the shape `tools/validate/src/fixtures/g6a_chart.rs` reads (`Chart::load` refuses
a file without all 169 classes).

The file lives outside the repository and is named by `--chart PATH` or the environment
variable `G6A_CHART_PATH`.

## Rerunning the comparison locally

With a transcription in hand:

    cargo run --release -p validate -- g6a --chart PATH --out target/gate-reports

or set `G6A_CHART_PATH` and run the ignored test:

    cargo test --release -p validate --test g6a -- --ignored

Continuous integration (CI) runs `validate g6a` without a chart. It then judges the
certificate at all 15 depths and the committed library against the recomputation, and the
report notes say the chart comparison runs locally and point at the committed report,
`validation/reports/g6a-pushfold.json`, which holds the result of the last local run.

## Pass rules

- Exactness (O-223). The solver runs counterfactual regret minimization plus (CFR+) with
  alternating updates and linear averaging to find which classes mix, fixes every other
  class to its pure action, solves the mixed classes from their indifference equations by
  Gaussian elimination in f64, and resets the pure classes to their best response until
  nothing changes. An exact best response then measures each seat's gain against the
  result; the gate passes a depth only when both gains are at or below 1e-9 bb per hand.
  When no candidate support certifies, CFR+ runs longer and the search repeats a bounded
  number of times; failing that is an error, never a pass.
- Near-indifferent (O-222). A class is in the solution's push or call range when its
  frequency is at least 0.5. Where the chart and the solution disagree, the EV gap is the
  EV of the chart's action minus the EV of the solution's majority action, so it is zero or
  negative at an equilibrium. Every disagreement is listed, and each must have an absolute
  gap at or below 0.02 bb, the preflop noise floor fallback of O-22.
- Expected values (O-224). An action's EV is the actor's expected final stack minus its
  stack behind at the node, in bb. At the button's node folding is 0, a push the big blind
  folds to is +1.5, and a called push is 2d times the equity minus (d minus 0.5); at the
  big blind's node folding is 0 and calling is 2d times the equity minus (d minus 1). The
  equity is the class pair equity averaged with the pair weights and the opponent's reach.

## The committed library

`cargo run --release -p validate -- g6a-pack` solves the 15 depths and packs each into
`library/preflop/cfg_2_online_norake_<d>/<id>/`. Each solution is first written as a
`preflop_169` node dump: source `own`, seed 0, the CFR+ iteration count, each seat's
best-response gain as a percent of the 1.5 bb starting pot, and a fixed export time, so the
dump is the same on every run. The dump goes through library-pack's conversion (both
criterion 2 checkers) and gto-library's writer, and the solution id is the dump's sha256
(O-131), so a regeneration of an unchanged solver writes the same bytes. A regeneration
removes any other solution directory under the same configuration. The gate reads each
committed solution back through gto-library's reader and compares it with a fresh solve
within the O-133 tolerances: frequencies within 1/255, the best action's EV equal as an
f32, other losses within half a storage unit.
