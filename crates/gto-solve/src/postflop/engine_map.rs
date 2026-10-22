//! The mapping from a `PostflopProblem` to the vendored engine's `SolveConfig`, and from
//! an engine configuration back to a `TreeConfig` (R2.10, ADR 0023). Crate-private, so no
//! engine type reaches a public signature.
//!
//! Mechanism, field by field:
//!
//! - Chips: the engine counts f64 big blinds (bb) on a 0.01 grid and the model counts
//!   integer centi-big-blinds (cbb), so one engine grid step is one cbb and `cbb / 100`
//!   is the engine amount: `starting_pot = pot / 100`, `effective_stack = min(stacks) /
//!   100`.
//! - Sizes: a size of `bp` basis points of the pot is the engine percent `bp / 100`, the
//!   all-in flags carry over, the raise cap carries over and the all-in threshold is
//!   `allin_threshold_bp / 100` percent of the stack behind.
//! - Rake: `percent = percent_bp / 100` and `cap = rake_cap_cbb / 100`. The engine reads a
//!   cap of 0 as no cap, so a model cap of 0 cbb (no rake can be taken) maps to a percent
//!   of 0. The engine's rake is continuous where the model rounds to the cbb (R2.2); the
//!   two differ by under 0.5 cbb per terminal.
//! - Cards and combos: both crates encode a card as `rank * 4 + suit` and order combos by
//!   lower card then higher card, so a board is written card by card and a range as
//!   explicit combos (`Range::to_engine_notation`).
//! - Solve settings: exact chance (`turn_chance_sampling = false`, every turn and river
//!   card, ADR 0023), no regret floor, and the Discounted CFR (DCFR) schedule 1.5 / 0 / 2,
//!   written explicitly rather than left to the engine's defaults; the solve reads the
//!   schedule back off this configuration, so the two cannot drift apart. The adapter
//!   runs its own stop rule, so the engine's own target and iteration fields are set to
//!   values its validation accepts and are never read.

use gto_model::{Board, Cbb, GameConfig};
use gto_tree::{Player, PlayerSizes, SizeTable, StreetSizes, TreeConfig};
use postflop_engine::config::{
    BetSizings, PlayerSizings, Rake, Sizings, SolveConfig, StreetSizings,
};

use super::error::SolveError;
use super::problem::PostflopProblem;

/// Centi-big-blinds per big blind, and basis points per percent.
const HUNDRED: f64 = 100.0;

/// How far an engine amount may sit off the 0.01 grid and still map to an exact cbb or bp.
const GRID_TOLERANCE: f64 = 1e-6;

/// The engine's own target and iteration ceiling, which the adapter never reads.
const UNUSED_ENGINE_TARGET: f64 = 0.0;
const UNUSED_ENGINE_ITERATIONS: u64 = 1;

/// The DCFR schedule 1.5 / 0 / 2 with no regret floor (the DCFR paper's recommendation).
const DCFR_ALPHA: f64 = 1.5;
const DCFR_BETA: f64 = 0.0;
const DCFR_GAMMA: f64 = 2.0;
const DCFR_REGRET_FLOOR: bool = false;

/// Engine chips for an amount in cbb.
pub(crate) fn chips(amount: Cbb) -> f64 {
    f64::from(amount.get()) / HUNDRED
}

/// The cbb amount for engine chips on the 0.01 grid. The root-street walk of `nodes` reads
/// the engine's pots, stacks and bet totals back through it (R2.11); the parity and
/// mapping tests read engine amounts back too.
pub(crate) fn cbb_of_chips(chips: f64) -> Result<Cbb, SolveError> {
    on_grid(chips * HUNDRED, "chip amount").map(Cbb::new)
}

/// The integer a scaled engine value stands for, when it sits on the integer grid.
fn on_grid(scaled: f64, what: &str) -> Result<u32, SolveError> {
    let rounded = scaled.round();
    let fits = rounded >= 0.0 && rounded <= f64::from(u32::MAX);
    if !fits || (scaled - rounded).abs() > GRID_TOLERANCE {
        return Err(SolveError::Engine(format!("{what} {scaled} is off the integer grid")));
    }
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "checked just above: a whole number inside the u32 range"
    )]
    let value = rounded as u32;
    Ok(value)
}

/// The engine configuration for a problem. The problem is validated by the caller.
pub(crate) fn solve_config(problem: &PostflopProblem) -> SolveConfig {
    let [oop, ip] = &problem.ranges;
    SolveConfig {
        board: board_text(problem.board),
        oop_range: oop.to_engine_notation(),
        ip_range: ip.to_engine_notation(),
        effective_stack: chips(problem.effective_stack()),
        starting_pot: chips(problem.pot),
        allin_threshold: f64::from(problem.tree.allin_threshold_bp()) / HUNDRED,
        raise_cap: u32::from(problem.tree.raise_cap()),
        target_exploitability: UNUSED_ENGINE_TARGET,
        max_iterations: UNUSED_ENGINE_ITERATIONS,
        alpha: DCFR_ALPHA,
        beta: DCFR_BETA,
        gamma: DCFR_GAMMA,
        turn_chance_sampling: false,
        regret_floor: DCFR_REGRET_FLOOR,
        rake: rake(&problem.config),
        sizings: sizings(&problem.tree),
        ..SolveConfig::default()
    }
}

/// The board as the engine reads it: cards separated by spaces.
pub(crate) fn board_text(board: Board) -> String {
    board.cards().iter().map(ToString::to_string).collect::<Vec<String>>().join(" ")
}

/// The engine rake for a configuration's stake.
pub(crate) fn rake(config: &GameConfig) -> Rake {
    let cap = config.stake.rake_cap_cbb();
    if cap == Cbb::ZERO {
        return Rake { percent: 0.0, cap: 0.0 };
    }
    Rake { percent: f64::from(config.stake.rake.percent_bp) / HUNDRED, cap: chips(cap) }
}

/// The engine sizing tables for a tree configuration.
pub(crate) fn sizings(tree: &TreeConfig) -> BetSizings {
    BetSizings {
        oop: player_sizings(tree.player(Player::Oop)),
        ip: player_sizings(tree.player(Player::Ip)),
    }
}

fn player_sizings(sizes: &PlayerSizes) -> PlayerSizings {
    PlayerSizings {
        flop: street_sizings(&sizes.flop),
        turn: street_sizings(&sizes.turn),
        river: street_sizings(&sizes.river),
    }
}

fn street_sizings(sizes: &StreetSizes) -> StreetSizings {
    StreetSizings {
        bet: table_sizings(&sizes.bet),
        raise: table_sizings(&sizes.raise),
        donk: table_sizings(&sizes.donk),
    }
}

fn table_sizings(table: &SizeTable) -> Sizings {
    let percents: Vec<f64> = table.sizes_bp().iter().map(|&bp| f64::from(bp) / HUNDRED).collect();
    Sizings::new(&percents, table.allin())
}

/// The tree configuration an engine configuration describes, for the tree hash
/// cross-check: the inverse of the size, raise cap and threshold mapping above.
pub(crate) fn tree_config_of(cfg: &SolveConfig) -> Result<TreeConfig, SolveError> {
    let raise_cap = u8::try_from(cfg.raise_cap).map_err(|_| {
        SolveError::Engine(format!("raise cap {} does not fit a u8", cfg.raise_cap))
    })?;
    let threshold_bp = on_grid(cfg.allin_threshold * HUNDRED, "all-in threshold")?;
    let oop = player_sizes(&cfg.sizings.oop)?;
    let ip = player_sizes(&cfg.sizings.ip)?;
    Ok(TreeConfig::new(oop, ip, raise_cap, threshold_bp)?)
}

fn player_sizes(sizings: &PlayerSizings) -> Result<PlayerSizes, SolveError> {
    Ok(PlayerSizes {
        flop: street_sizes(&sizings.flop)?,
        turn: street_sizes(&sizings.turn)?,
        river: street_sizes(&sizings.river)?,
    })
}

fn street_sizes(sizings: &StreetSizings) -> Result<StreetSizes, SolveError> {
    Ok(StreetSizes {
        bet: size_table(&sizings.bet)?,
        raise: size_table(&sizings.raise)?,
        donk: size_table(&sizings.donk)?,
    })
}

fn size_table(sizings: &Sizings) -> Result<SizeTable, SolveError> {
    let sizes_bp = sizings
        .percents
        .iter()
        .map(|&percent| on_grid(percent * HUNDRED, "sizing percent"))
        .collect::<Result<Vec<u32>, SolveError>>()?;
    Ok(SizeTable::new(&sizes_bp, sizings.allin)?)
}

#[cfg(test)]
mod tests {
    use gto_model::{Cbb, GameConfig, GameFormat, Stake, TableSize};
    use gto_tree::{PlayerSizes, SizeTable, StreetSizes, TreeConfig};

    use super::{cbb_of_chips, chips, rake, sizings, tree_config_of};
    use postflop_engine::config::{Sizings, SolveConfig};

    fn table(sizes_bp: &[u32], allin: bool) -> SizeTable {
        SizeTable::new(sizes_bp, allin).expect("a valid table")
    }

    fn street(bet: SizeTable, raise: SizeTable) -> StreetSizes {
        StreetSizes { bet, raise, donk: SizeTable::default() }
    }

    fn sample_tree() -> TreeConfig {
        let oop = PlayerSizes {
            flop: street(table(&[3_300, 7_500], false), table(&[], true)),
            turn: StreetSizes {
                bet: table(&[7_500], false),
                raise: table(&[], true),
                donk: table(&[3_333], false),
            },
            river: street(table(&[7_500], true), table(&[], true)),
        };
        let ip = PlayerSizes {
            flop: street(table(&[2_500, 12_500], false), table(&[6_000], true)),
            turn: street(table(&[7_500], false), table(&[], true)),
            river: street(table(&[20_000], false), table(&[], false)),
        };
        TreeConfig::new(oop, ip, 2, 8_000).expect("a valid tree configuration")
    }

    /// R2.10: rake maps percent basis points to an engine percent and the cap in cbb to
    /// big blinds: online 5 percent capped at 3 bb, live 1/3 10 percent capped at 167 cbb
    /// (1.67 bb) and live 2/5 10 percent capped at 100 cbb (1 bb).
    #[test]
    fn r2_10_rake_maps_cap_in_bb() {
        let cases = [
            (Stake::online(), GameFormat::Online, 5.0, 3.0),
            (Stake::live_1_3(), GameFormat::Live, 10.0, 1.67),
            (Stake::live_2_5(), GameFormat::Live, 10.0, 1.0),
        ];
        for (stake, format, percent, cap) in cases {
            let label = stake.label.clone();
            let config = GameConfig::new(format, TableSize::SIX_MAX, stake, Cbb::from_bb(100));
            let mapped = rake(&config);
            assert!((mapped.percent - percent).abs() < 1e-12, "{label}: {mapped:?}");
            assert!((mapped.cap - cap).abs() < 1e-12, "{label}: {mapped:?}");
        }
    }

    /// R2.10: a model cap of 0 cbb means no rake, so the engine gets a percent of 0
    /// rather than its own reading of cap 0, which is no cap.
    #[test]
    fn r2_10_zero_rake_cap_maps_to_no_rake() {
        let mut stake = Stake::online();
        stake.rake.cap_cents = 0;
        let config = GameConfig::new(GameFormat::Online, TableSize::SIX_MAX, stake, Cbb(10_000));
        let mapped = rake(&config);
        assert_eq!((mapped.percent, mapped.cap), (0.0, 0.0));
    }

    /// R2.10: one engine grid step is one cbb, both ways.
    #[test]
    fn r2_10_chips_and_cbb_convert_exactly() {
        for amount in [1_u32, 33, 250, 550, 833, 9_750, 60_000] {
            let engine = chips(Cbb(amount));
            assert_eq!(cbb_of_chips(engine).expect("on the grid"), Cbb(amount));
        }
        assert!(cbb_of_chips(0.005).is_err(), "half a cbb is off the grid");
    }

    /// R2.10: a tree configuration survives the trip to the engine's sizing tables and
    /// back, so the hash of the configuration a solve ran on equals the one asked for.
    #[test]
    fn r2_10_tree_config_round_trips_through_engine() {
        let tree = sample_tree();
        let engine = SolveConfig {
            sizings: sizings(&tree),
            raise_cap: u32::from(tree.raise_cap()),
            allin_threshold: f64::from(tree.allin_threshold_bp()) / 100.0,
            ..SolveConfig::default()
        };
        assert_eq!(engine.sizings.oop.flop.bet, Sizings::new(&[33.0, 75.0], false));
        assert_eq!(engine.sizings.oop.turn.donk, Sizings::new(&[33.33], false));
        assert_eq!(engine.sizings.ip.flop.raise, Sizings::new(&[60.0], true));
        let back = tree_config_of(&engine).expect("the engine tables map back");
        assert_eq!(back, tree);
        assert_eq!(gto_tree::tree_hash(&back), gto_tree::tree_hash(&tree));
    }

    /// R2.10: an engine percent off the basis point grid is refused, not rounded.
    #[test]
    fn r2_10_off_grid_engine_percent_is_refused() {
        let mut engine = SolveConfig::default();
        engine.sizings.oop.flop.bet = Sizings::new(&[33.333_33], false);
        assert!(tree_config_of(&engine).is_err());
    }
}
