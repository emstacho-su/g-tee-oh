# Validation fixtures

This directory holds the public inputs of the engine validation gates G1 to G4 (04 Solver engine section 6): three toy games with their known answers, one exploitability curve computed by a published reference implementation, and the hand-made spot list of the oracle gate G4 with the tiny pair its compare step is tested on. Beside them sits the 169 by 169 preflop equity table (R2.20), an exact enumeration the repository computes itself. The gate inputs were written in session S05 as the red half of test-driven development (requirement identifier (R ID) R0.11), and S13 wired the engine behind the gate tests that read them (R2.4 to R2.6). Reports that the gates write go to `validation/reports/`; the format rules for those are in `validation/reports/README.md`. The split is fixed: a fixture is an input a person can read and check against its source, a report is written by a tool and never by hand.

Two rules bound what may be in here. Only toy games, published vectors and exact enumerations from the rules of hold'em enter this directory; nothing derived from any reference tool does (open question identifier (O-ID) O-26, architecture decision record (ADR) 0017, ADR 0021). And every number names its source, so a reviewer can go from a fixture value to the paper, the planning document or the run that produced it without trusting the person who typed it. The G4 spot list and the tiny pair under `g4/` follow both rules: every spot, range, pot and stack is hand-made from the rules of hold'em and the catalog configuration, every number of the tiny pair is synthetic, and nothing in them is derived from the oracle or from reference data; the oracle's own output never enters this directory (09 section 7).

## Layout

| Path | What it is | Read by |
|---|---|---|
| `toy-games/kuhn.json` | Kuhn poker: rules, the game value of minus 1/18 and the equilibrium family (gate G1, R2.4) | `tools/validate` |
| `toy-games/akq.json` | The AKQ game (ace, king, queen) at three bet sizes plus the polar river toy game, with closed-form frequencies (gate G2, R2.5) | `tools/validate` |
| `toy-games/leduc.json` | Leduc hold'em as OpenSpiel defines it, pointing at the committed curve and carrying the O-79 tolerance (gate G3, R2.6) | `tools/validate` |
| `openspiel/leduc_curve.py` | The script that produced the curve: plain counterfactual regret minimization (CFR) from OpenSpiel on `leduc_poker`, measuring exploitability at fixed checkpoints | a person regenerating the curve |
| `openspiel/leduc_exploitability.json` | The curve: one row per checkpoint iteration with exploitability and NashConv, plus the final average policy value (O-30) | `tools/validate` G3 |
| `openspiel/PROVENANCE.md` | Version, exact command, seed, container digest, date and machine of the run that wrote the JSON (JavaScript Object Notation) file, plus the O-128 erratum on its generator block | a reviewer |
| `equity/` | `preflop-169.json`, the 169 by 169 preflop all-in equity table and its combo pair counts (R2.20, O-126), and `PROVENANCE.md`, the method, evaluator, commit, machine, elapsed time and spot-check values of the one run that wrote it | `tools/validate/tests/equity_table.rs`; S16 reads `equity` and `pairs` |
| `g4-spots.json` | The G4 spot list (O-87, R2.11): the catalog configuration, the position pair, one postflop tree, the stop rule of both solvers, the 04 section 6 rules, and eight hand-made heads-up turn and river spots, four gated of each street, all rake-free (O-161), with their root node keys, pots, stacks and ranges; `tools/validate/src/fixtures/g4_spots.rs` loads it and refuses a key that repeats or extends another's within its street or is not a root | `tools/validate` G4 (`just g4`); the private oracle program reads it by path |
| `g4-spots-raked.json` | The raked twins (O-161): the same layout and loader, two informational spots with the root keys, boards, pots, stacks and ranges of `turn-01-dry-ace` and `river-01-dry-ace` at the online rake, in a list of their own because a node dump holds each key once | `tools/validate` G4 (`just g4-raked`, report `g4-oracle-raked`); the private oracle program reads it by path |
| `g4/` | `tiny-spots.json`, `engine-tiny.json`, `oracle-tiny.json` and `oracle-tiny-failing.json`, the synthetic tiny pair the G4 compare step is tested and smoked on, with a README stating its margins and the failing twin's three edits (R2.11) | `tools/validate/tests/g4.rs` and `g4_engine.rs`, `just g4-check` |

Two more vectors of R0.11 are not here: the bucket-edge table (25, 50, 75, 110 and 150 percent of pot, upper edge inclusive, all-in separate, ADR 0008) and the node-key round trip. Both are `gto-model` vectors and live in `crates/gto-model`, written red first by S12 inside its own session (09 section 3), so S12 does not wait for S05.

## How a fixture is read

The loader lives in `tools/validate/src/fixtures/`. serde parses each file into a struct whose field set is closed (`deny_unknown_fields`), so a misspelled or extra field fails the parse instead of being ignored. The loader then checks the `schema_version` against the one it reads (1) and runs structural checks: at least one case, unique case and fact identifiers, and every `source` reference resolving to an entry of `sources`. A file that passes is returned as a fresh value; nothing is mutated afterwards.

`tools/validate/tests/gates.rs` holds the tests. The `r0_11_*` tests load every file here and check the fields above, so a broken fixture fails continuous integration (CI). The `r2_4_*`, `r2_5_*` and `r2_6_*` tests are the gates: their bodies are the pass rules written as assertions against two helpers that call `validate::gates`, which solves each game through `gto-solve`, the same code path `just gates` writes the reports in `validation/reports/` from.

## Toy-game schema, `schema_version` 1

Top level:

| Field | Type | Meaning |
|---|---|---|
| `schema_version` | integer | Always 1. |
| `id` | string | Short identifier, equal to the file stem. |
| `name` | string | Human name of the game. |
| `gate` | string | `G1`, `G2` or `G3`. |
| `r_id` | string | The requirement the gate closes. |
| `players` | integer | 2 for every v1 toy game. |
| `deck` | object | `ranks` (lowest first), `suits`, `cards` (ranks times suits), `private_cards_per_player`, `public_cards`. |
| `sources` | array | Citations: `id`, `citation`, `url` (nullable). Facts and tolerances reference them by `id`. |
| `tolerances` | object | `game_value_abs`, `exploitability_max`, `frequency_points`, `curve_abs`, `curve_rel`; each is null or `{ value, unit, source }`. |
| `cases` | array | Betting structures with known answers, below. |
| `curve` | object or null | `file` and `provenance`, paths relative to this directory, and `measure`, the checkpoint field the gate compares. Leduc only. |
| `notes` | string array | Reader notes: node names, equilibrium shape, unit conventions. |

One case:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Unique within the file. |
| `description` | string | The betting structure and who acts first, in words. |
| `betting` | object | `ante` per player, `dead_pot` (antes summed), `rounds`, `bet_sizes` (one per round), `max_raises_per_round`, `first_to_act`, `unit` (always `chips`). |
| `game_value` | object or null | `player`, `value`, `exact` (nullable string such as `-1/18`), `unit`, `source`. |
| `strategy_facts` | array | One equilibrium frequency each: `id`, `player`, `node`, `holding`, `action`, `frequency`, `source`. |
| `ratio_facts` | array | Range-level numbers: `id`, `name`, `value`, `exact`, `formula` in terms of pot `P` and bet `B`, `source`. |

A `frequency` is tagged by `kind`:

| Kind | Fields | Meaning |
|---|---|---|
| `exact` | `value`, `exact` | One value. |
| `parameter` | `name`, `min`, `max` | A free parameter of the equilibrium family; the solved frequency binds it, and the bound value must lie in the closed range. |
| `affine` | `parameter`, `scale`, `offset` | `scale` times the bound parameter plus `offset`. |
| `segment` | `min`, `max` | Any value in the closed range is an equilibrium. |

`node` names are per game and are explained in each file's `notes`. Holdings are ranks for the card games and `nuts`, `air` or `bluff_catcher` for the polar river toy.

## Where each number comes from

### Kuhn poker (G1, R2.4)

Three cards J, Q, K, one to each player, both ante 1 chip, one bet of 1 chip, no raise. Kuhn (1950) solved the game: the value to the first player is minus 1/18 chips, and the equilibria form a one-parameter family. The parameter `a` is the first player's bet frequency with J and may be anything in [0, 1/3]; the K bet frequency is then 3a and the Q call frequency after a check and a bet is a plus 1/3, while the second player bets J one third of the time and K always after a check, and calls Q one third of the time and K always facing a bet. The file carries the value, the family and the two tolerances 04 section 6 states for G1: value within 0.001 of minus 1/18, exploitability below 0.001. The strategy facts are for reports; G1's pass rule is the value and the exploitability only.

### AKQ closed forms (G2, R2.5)

Three cards Q, K, A, one to each player, a dead pot P with P/2 from each, player 0 checks in the dark, player 1 bets B or checks, player 0 calls or folds. The pure parts come first. Player 1 always bets A, because A is never called by a better hand. Player 1 never bets K: against Q a bet wins the same P/2 a check does, and against A it loses an extra B, so the bet is dominated. Player 0 always calls A and always folds Q, because only a bluff ever bets into A and only A ever gets called by Q profitably. Two mixed frequencies remain, the Q bluff frequency b and the K call frequency c, and each is fixed by making the other player's marginal hand indifferent.

Player 0 holding K faces a bet from A (always) or from Q (with frequency b), each with prior weight 1. Calling wins P/2 plus B against Q and loses the same against A; folding loses P/2 either way. Setting the two equal gives b times (P plus B) equal to B, so b is B divided by (P plus B). Player 1 holding Q faces A (always calls) or K (calls with frequency c). Checking loses P/2 against both; betting loses P/2 plus B against A and, against K, loses that much with frequency c or wins P/2 otherwise. Setting bet equal to check gives c times (P plus B) equal to P minus B, so c is (P minus B) divided by (P plus B).

Two range-level ratios follow. Bluffs as a share of all bets are b divided by (1 plus b), which simplifies to B divided by (P plus 2B). Player 0's continuing share against a bet is (1 plus c) divided by 2, which simplifies to P divided by (P plus B). These are the textbook bluff ratio and defense frequency (Chen and Ankenman, The Mathematics of Poker, 2006).

| Case | B | b (Q bluffs) | c (K calls) | bluff share | defense share |
|---|---|---|---|---|---|
| `pot1-bet-quarter` | 1/4 | 1/5 | 3/5 | 1/6 | 4/5 |
| `pot1-bet-half` | 1/2 | 1/3 | 1/3 | 1/4 | 2/3 |
| `pot1-bet-pot` | 1 | any value in [0, 1/2] | 0 | up to 1/3 | 1/2 |

At B equal to P the closed form for c reaches 0, and there the Q indifference no longer pins b: every b in [0, 1/2] with c equal to 0 is an equilibrium. The file records that case with `segment` facts, and only the defense share of 1/2 is pinned there. The numbers 04 section 6 states for a pot-sized polar bet, bluffs are 1/3 of the betting range and the caller defends half of the bluff catchers, are unique in the polar river toy game, where player 1 holds the nuts or air in equal measure and player 0 holds only bluff catchers. That game is the case `polar-river-pot-bet`: with equal nuts and air, betting air half the time makes bluffs one third of the bets, and the bluff catchers call half the time. AKQ cannot stand in for it, because AKQ's card removal ties the bettor's range to the caller's card, so S13 added a small game of its own, `PolarRiver` in `gto_solve::toy`: player 1 holds air or the nuts with weight 1 each, player 0 holds one bluff catcher, there is no card removal, and the tree and payoffs are AKQ's (a check shows down for P/2, a call for P/2 plus B, a fold gives player 1 P/2). At P equal to B its equilibrium is unique: bet the nuts always, bet air half the time, call half the time. The G2 tolerance is 0.5 percentage points, which is 0.005 in frequency units, from 04 section 6 and R2.5.

### Leduc hold'em (G3, R2.6)

Leduc hold'em is the toy game of Southey and others (Bayes' Bluff: Opponent Modelling in Poker, 2005). The fixture states the rules as the OpenSpiel `leduc_poker` game encodes them, read from the game object during the run recorded in `openspiel/PROVENANCE.md`: six cards (J, Q, K in two suits), one private card each, both ante 1 chip, a first betting round with a raise of 2, one public card, a second round with a raise of 4, at most two raises per round, 936 information states, a maximum win of 13 chips. A pair beats a high card; otherwise the higher rank wins and equal ranks split.

G3 compares curves, not a single value (04 section 6, O-30). The `game_value` in `leduc.json` is therefore the average policy's expected value to player 0 at the last checkpoint of the committed run, recorded so the number and its provenance sit together; it is not an analytic constant and no gate asserts it. The literature commonly quotes a first-player value of about minus 0.0856 chips for this game, which the run reproduces to three decimals.

## Tolerance rules

| Gate | Rule | Source |
|---|---|---|
| G1 | Player 0 game value within 0.001 chips of minus 1/18; exploitability of the average strategy below 0.001 chips | 04 section 6, R2.4 |
| G2 | Every closed-form frequency and ratio within 0.5 percentage points of the solved average strategy; segment facts accept any point of the segment | 04 section 6, R2.5 |
| G3 | At every committed checkpoint iteration, the engine's exploitability within the larger of 0.001 absolute and 10 percent relative of the fixture's value: the error must not exceed `max(0.001, 0.10 * fixture)` | O-79, R2.6 |

Units and the measure. Every chip figure uses the game's own ante as the unit, 1 chip in Kuhn and Leduc, 1/2 chip in the AKQ cases with a dead pot of 1. OpenSpiel's `exploitability` is `nash_conv` divided by the number of players: the mean of the two players' best-response gains. The vendored engine's `ExploitReport.chips` is the sum of the two gains, which is NashConv in a zero-sum game. The curve records both fields, so the G3 comparison is either the engine's `chips` divided by 2 against `exploitability`, or the engine's `chips` against `nash_conv` with the absolute part of the tolerance doubled. The fixture's `curve.measure` names `exploitability`, and the pending R2.6 test expects the mean. For G1 the fixture's `exploitability_max` applies to the engine's reported sum, the stricter reading.

Matching the solver. The curve comes from plain CFR as OpenSpiel's `CFRSolver` runs it: alternating updates (player 0's regrets and policy first, then player 1 against that updated policy), uniform averaging, no regret-matching-plus floor, no discounting. A run of discounted CFR (DCFR) converges faster and would sit below the curve at most checkpoints, which the 10 percent relative rule would reject, and the engine's own solver cannot switch its discounting off (O-124). G3 therefore runs the reference traversal `gto_solve::toy::plain_cfr` over the engine's Leduc model in one continuous run that reads the average strategy at 1, 10, 100, 1000 and 5000 iterations, and the engine's best-response calculator measures it; the engine's DCFR curve on the same model is reported for information only. The fixture first recorded simultaneous updates; the O-128 erratum in `openspiel/PROVENANCE.md` explains the correction, which changed no number.

## Regenerating the OpenSpiel curve

The committed JSON's numbers are never edited by hand; the one hand edit so far is the O-128 correction of the `alternating_updates` field in its generator block, recorded in `openspiel/PROVENANCE.md`. To change it, rerun the script, commit what it wrote, and update `openspiel/PROVENANCE.md` with the new version, command, digest, date and machine. The OpenSpiel wheel on PyPI (the Python Package Index) is built for Linux only, so on the Windows machine the run happens inside a Linux container with this directory mounted at `/out`. The exact command of the committed run is in `openspiel/PROVENANCE.md`; the shape is:

```text
docker run --rm -v "<absolute path of validation/fixtures>:/out" python:3.12-slim sh -c "pip install --quiet open_spiel==2.0.2 && python -I /out/openspiel/leduc_curve.py --out /out/openspiel/leduc_exploitability.json --seed 20261020"
```

On Linux or macOS the same script runs under uv without a container:

```text
uv run --python 3.12 --with open_spiel==2.0.2 validation/fixtures/openspiel/leduc_curve.py --out validation/fixtures/openspiel/leduc_exploitability.json --seed 20261020
```

The script accepts `--checkpoints 1,10,100` to change the schedule; a changed schedule changes what G3 checks, so `CURVE_ITERATIONS` in `tools/validate/tests/gates.rs` must follow. Plain CFR is deterministic, so a rerun at the same OpenSpiel version reproduces every number exactly; a different version may move the later checkpoints slightly and is a reason to record a new provenance note.

## Preflop equity table: `equity/preflop-169.json` (R2.20, O-126)

`gto_solve::equity` enumerates, for every disjoint ordered pair of hole-card combos, every five-card board from the 48 cards left, C(48, 5) = 1,712,304 boards, and scores each showdown with the vendored engine's seven-card evaluator `eval7`. To keep that tractable it first groups the 1,624,350 disjoint ordered combo pairs into classes that are equal under the 24 suit permutations, enumerates one representative per class with rayon across the cores, and weights each by its multiplicity; it then sums the combo-pair results into the 169 by 169 hand-class grid. `tools/validate` only serialises the result, so it names no engine type.

The file, `schema_version` 1:

| Field | Meaning |
|---|---|
| `classes` | The 169 hand-class labels in `gto_model::HandClass` index order, `AA` at 0 to `32o` at 168. |
| `equity` | `equity[i][j]` is (wins plus ties / 2) divided by total for hero class `i` against villain class `j`, over every disjoint combo pair of the two classes and every board. |
| `pairs` | `pairs[i][j]` is the number of disjoint ordered combo pairs behind `equity[i][j]`, so a range-weighted equity stays exact. |
| `method`, `evaluator`, `boards_per_pair` | The enumeration method, the evaluator (the vendored `eval7`) and 1,712,304. |
| `generated_at`, `commit` | When the run wrote the file and the commit it ran at. |

The table is generated once, on the Zenbook in release mode with `just equity-table` (`cargo run --release -p validate -- equity-table --out validation/fixtures/equity/preflop-169.json`), because the enumeration is about 1.6e11 evaluator calls; continuous integration never regenerates it and only runs the tests against the committed file. `equity/PROVENANCE.md` records the method, the evaluator, the commit, the machine, the elapsed time and the spot-check values of that run. The tests in `tools/validate/tests/equity_table.rs` check that the table is symmetric (`equity[i][j]` plus `equity[j][i]` is 1 within 1e-12, the diagonal is 0.5, `pairs` is symmetric and agrees with the 6, 4 and 12 combos of a pair, a suited and an offsuit class), that three class pairs regenerated through the library match the committed entries exactly, and that spot values hold: AA against KK in [0.81, 0.83], 22 against AKs in [0.49, 0.52], QQ against AKo in [0.56, 0.58], plus AsAh against KdKc enumerated by a plain loop. S16 reads `equity` and `pairs`.

## Later fixtures, names reserved by O-87

O-87 fixed two more fixture names so `validation/reports/README.md` could point at them early. S17 wrote `g4-spots.json` (the layout table above); the other does not exist yet.

| Path | What it will be | Session |
|---|---|---|
| `PROVENANCE-g6a.md` | The provenance note of the G6a heads-up push/fold solution: the chart source, the engine parameters and the run that produced the end-to-end fixture library (O-30, O-63, R2.19) | S19 |

A later fixture follows the same two rules as the files above: it carries a `schema_version`, and every number names its source.

## Ownership

S05 wrote this directory and the loader. S13 consumes it, turned the pending gate tests green, writes the G1 to G3 reports under `validation/reports/`, added `equity/` and corrected the curve's generator metadata (O-128). S12 owns the two `gto-model` vectors named above. S17 added `g4-spots.json`, `g4-spots-raked.json` and `g4/` with their loader `tools/validate/src/fixtures/g4_spots.rs`.
