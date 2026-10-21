# Provenance of preflop-169.json

The 169 by 169 preflop equity table (R2.20, O-32, O-126). S16 reads `equity` and `pairs`
from it. It is generated once on the owner's laptop and committed; continuous integration
(CI) never regenerates it.

## Method

Each entry `equity[i][j]` is the share of the pot that hero class `i` wins against villain
class `j`, counted exactly and with no sampling:

1. Every ordered pair of one hero combo from class `i` and one villain combo from class `j`
   that share no card is a matchup. `pairs[i][j]` is the number of such matchups, so a
   range can be weighted by combo counts exactly.
2. A matchup is scored on every one of the C(48, 5) = 1,712,304 boards the four hole cards
   leave. Each board compares the two seven-card values from the evaluator: a higher value
   is a win, an equal value a tie.
3. Relabelling the four suits changes no showdown, so the matchups of one class pair are
   grouped into orbits under the 24 suit permutations. One representative per orbit (the
   smallest relabelled card tuple) is scored and its counts are multiplied by the orbit
   size. The unit tests in `crates/gto-solve/src/equity.rs` check that the orbits cover
   every matchup once, and `r2_20_equity_table_spot_checks` checks that the AA versus KK
   entry equals the plain sum over its 36 matchups.
4. `equity = (wins + ties / 2) / total`, with `total = pairs * 1,712,304`.
5. Each unordered class pair is scored once; the reverse entry reuses the same counts with
   hero losses as villain wins. So `equity[i][j] + equity[j][i]` is 1 up to rounding and
   the diagonal is exactly 0.5.

The work is split across cores with rayon, by class pair and by the first board card.
Integer counts are summed, so the result does not depend on thread scheduling.

## Evaluator

`postflop_engine::evaluator::eval7` from the vendored engine in
`crates/vendor/postflop-engine` (pinned commit in `crates/vendor/UPSTREAM-postflop-engine.md`).
Cards use the shared encoding `rank * 4 + suit`, suits c, d, h, s as 0 to 3, pinned by
`r2_4_card_encoding_matches_gto_model`.

## Run

Command, from the repository root:

    cargo run --release -p validate -- equity-table \
        --out validation/fixtures/equity/preflop-169.json

| Field | Value |
|---|---|
| Commit | 48e1cb7bfdfd61dd7207f1e11f03f5d7b21df137 (the generator is committed there) |
| Generated at | 2026-10-21T00:38:36Z |
| Machine | zenbook: AMD Ryzen AI 9 465, 20 logical cores, 31.2 GiB memory, Windows 11 Home |
| Toolchain | rustc 1.99.1 (58cf8f9c3 2026-10-13), release profile |
| Elapsed | 179.1 s to build the table on a quiet machine (earlier runs: 188 s to 249 s) |
| File | 1,042,046 bytes, pretty-printed JSON, LF line endings |

The file was regenerated from a clean tree at the commit above, which holds the generator.
The release profile uses thin link-time optimization and one codegen unit. Earlier runs
overlapped on the machine, which explains their spread in elapsed time; the counts are
integers summed in any order, so every run gives the same `equity` and `pairs`.

After writing, the tool reads the file back and requires every number to equal the table
it wrote. That check needs serde_json's `float_roundtrip` feature, enabled in
`tools/validate/Cargo.toml`: without it, 1,264 of the 28,561 entries parse back one unit in
the last place off.

## Spot checks

| Hero | Villain | Equity | Pairs | Expected band |
|---|---|---|---|---|
| AA | KK | 0.8194605046767397 | 36 | 0.81 to 0.83 |
| 22 | AKs | 0.5010668374307365 | 24 | 0.49 to 0.52 |
| QQ | AKo | 0.5675766394285127 | 72 | 0.56 to 0.58 |

The tests in `tools/validate/tests/equity_table.rs` check symmetry, the pair counts, these
bands, and that three entries regenerate exactly through the library.
