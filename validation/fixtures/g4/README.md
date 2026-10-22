# G4 tiny pair

This directory holds the smoke inputs of the public G4 compare step, `validate g4`
(requirement identifier (R ID) R2.11, 04 Solver engine section 6): one tiny spot list in
the layout of `../g4-spots.json`, an engine-side node dump, an oracle-side node dump and a
failing twin of the oracle dump. Every number here is synthetic and written by hand so the
compare's three rules can be exercised in milliseconds; nothing comes from a solver, from
the oracle crate or from any reference tool (open question identifier (O-ID) O-26,
architecture decision record (ADR) 0017). The real G4 inputs are the spot list
`../g4-spots.json` (public, O-87), its informational twin `../g4-spots-raked.json` (the two
raked spots, O-161) and the dumps the Zenbook runs write into the private repository (09
section 7, O-170).

## Files

- `tiny-spots.json`: one river spot, three combos a side, with the tree, the stop rule and
  the three rules; read by `validate g4 --spots` and by `tools/validate/tests/g4.rs`.
- `engine-tiny.json`: the engine side of the pair, two decision nodes in the node-dump
  schema; read by `validate g4 --engine`.
- `oracle-tiny.json`: the oracle side, the same two nodes with numbers moved by the margins
  stated below; read by `validate g4 --oracle`.
- `oracle-tiny-failing.json`: the oracle side with one edit per rule, so one compare fails
  all three; read by `tools/validate/tests/g4.rs`.

Both dumps follow `packages/contracts/schemas/node-dump.schema.json` and pass the criterion
2 invariants of `tools/library-pack` (rules 1 to 5). The compare reads them through that
checker, so a dump that breaks a rule is refused before any number is judged.

## The spot

Big blind (BB) against the button (BTN) at the online 100 big blind configuration
`cfg_6_online_100`, after `r250.c` preflop, `x.b275.c` on the flop `Ah7d2c`, `x.b700.c` on
the turn `Ks`, river `9h`: pot 2500 centi-big-blinds (cbb), 8775 cbb behind each. The out
of position (OOP) range is two sets and one air hand (`AdAs`, `KcKh`, `6s5s`), the in
position (IP) range three pairs that lose to the sets and beat the air (`JdJh`, `TdTh`,
`8c8s`). The tree bets 75 percent of the pot (1875 cbb at the root, under half the stack
behind, so no size turns into an all-in), raises are all-in only. The R2.11 test
`r2_11_g4_engine_dump_from_a_river_solve_compares_with_itself` solves this spot with the
engine under the list's stop rule (0.3 percent of the pot, 2000 iterations, 60 seconds)
and compares the dump it writes with itself; the hand-made dumps below are not that solve.

## How the pair passes, and by how much

The compare judges a gated spot on four measurements (O-160). The pair's values:

- `g4/tiny-river/engine/exploitability`: the engine root's `accuracy_pct_pot`, 0.12,
  against at most 0.3 percent of the pot.
- `g4/tiny-river/oracle/exploitability`: the oracle root's `accuracy_pct_pot`, 0.05,
  against the same rule.
- `g4/tiny-river/root/frequency-mad`: 0.7 points against under 2.0 points, strict.
- `g4/tiny-river/root/ev-abs-error`: 0.136 percent of the pot against at most 0.3; the
  engine root EV is 25.62 bb and the oracle's 25.586 bb.

Frequency-mad: per root hand the mean over the two actions of the absolute frequency
difference, averaged over hands weighted by the engine dump's `reach` for the actor
(0.5, 0.3, 0.2), times 100. `AdAs` differs by 0 on both actions, `KcKh` by 0.01 (0.00
against 0.01 and 1.00 against 0.99), `6s5s` by 0.02; 0.5 x 0 + 0.3 x 0.01 + 0.2 x 0.02 is
0.007, which is 0.7 points. Unweighted the mean is 1.0 points and the largest single
difference is 0.02 (both informational rows).

Root EV: each side's reach-weighted sum over its root hands of the frequency-weighted
`ev_bb`. Engine: 0.5 x 32 + 0.3 x 31 + 0.2 x (0.6 x 0 + 0.4 x 4) = 25.62 bb. Oracle:
0.5 x 32 + 0.3 x (0.01 x 25 + 0.99 x 31) + 0.2 x (0.38 x 4) = 25.586 bb. The difference,
0.034 bb, is 0.136 percent of the 25 bb pot.

The second node (`|9h|x`, BTN to act after a check) is a deeper root-street node, so its
frequency-mad is informational: only `8c8s` differs (0.90 against 0.92), weight 0.25, 0.5
points.

## How the failing twin fails

`oracle-tiny-failing.json` is `oracle-tiny.json` with one edit per rule, applied to the
root node and the dump header only:

1. `exploitability_pct_pot` becomes `[0.04, 0.31]` and every `accuracy_pct_pot` 0.31, so
   `g4/tiny-river/oracle/exploitability` reads 0.31, above 0.3.
2. Every root hand's check frequency rises by 0.03 (`AdAs` 0.03/0.97, `KcKh` 0.04/0.96,
   `6s5s` 0.65/0.35), so the reach-weighted frequency-mad is 0.5 x 0.03 + 0.3 x 0.04 +
   0.2 x 0.05 = 0.037, which is 3.7 points, at or above 2.0.
3. Every root `ev_bb` entry drops by 0.25 bb, 1 percent of the pot. With the frequency
   shift of edit 2 the oracle root EV is 0.5 x 31.54 + 0.3 x 30.51 + 0.2 x 1.15 = 25.153
   bb, 0.467 bb or 1.868 percent of the pot away from the engine's 25.62 bb, above 0.3.

The engine side passes its own exploitability rule unchanged, so exactly three judged
measurements carry `pass: false`.

## Conventions the dumps follow

They are the conventions `validate g4` writes for the engine side and the private oracle
program mirrors: hand labels in `gto-model`'s canonical spelling (rank descending, then
suit ascending, so a pair reads `AdAs`); `reach` in pair order, the actor's entry the
matchup weight of the hand normalised over the node's hands; `ev_bb` per action in big
blinds, the hero's net chips against the start of the solve plus half the root pot;
`accuracy_pct_pot` on every node of a spot, the larger of the two seats' gains of that
spot's solve, and the dump-level `exploitability_pct_pot` the per-seat maximum over the
spots the dump holds.
