//! The two measured runs of the spike (R2.21): push/fold over the G6a depths, and the
//! minimal heads-up 100bb P2 solve (O-227).
//!
//! Mechanism. A run resets the peak readings ([`memory::start`]), starts a wall clock,
//! does all of its work (build each tree, solve, certify; the equity table arrives
//! already parsed), stops the clock and reads the peaks ([`memory::finish`]). Push/fold builds the push/fold tree and its vector game per
//! depth, runs `solve_push_fold` and then recomputes the best-response certificate from
//! scratch with `best_response_gains`, so the gain the report judges is measured, not
//! copied from the solver. The 100bb run builds the `BB-BTN` pair tree from the online
//! seed sizing spec (O-136) at `push_fold_config(100)`, values flop lines with
//! `FlopPayout::PLACEHOLDER` and runs CFR+ to `HU100_TARGET_PCT_POT`; its gain is the
//! larger seat gain in percent of the starting pot.

use std::path::Path;
use std::time::Instant;

use gto_model::{Position, PositionPair};
use gto_solve::equity::EquityTable;
use gto_solve::preflop::{
    CfrOptions, FlopPayout, PreflopGame, best_response_gains, push_fold_config, solve,
    solve_push_fold,
};
use gto_tree::{PreflopTree, SizingConventionSpec};

use super::{HU100_TARGET_PCT_POT, SpikeError, SpikeRun, memory};

/// The online seed sizing spec the 100bb tree is built from, relative to the repository
/// root (O-136, O-227).
pub const SEED_ONLINE_SPEC_RELATIVE_TO_REPO_ROOT: &str =
    "packages/contracts/schemas/examples/sizing-convention/valid/seed-online.json";

/// The stack depth of the minimal P2 run in big blinds (O-49, O-227).
pub const HU100_DEPTH_BB: u32 = 100;

/// The iteration cap of the 100bb run: generous, so the target and not the cap stops a
/// healthy run; a run that hits the cap reports its gain and fails O-49 honestly.
pub const HU100_MAX_ITERATIONS: u32 = 200_000;

/// How often, in iterations, the 100bb run measures its gains against the target.
pub const HU100_CHECK_EVERY: u32 = 25;

/// Percent per unit fraction.
const PERCENT: f64 = 100.0;

/// Centi-big-blinds per big blind, as a float for the pot conversion.
const CBB_PER_BB: f64 = 100.0;

/// Runs the push/fold solves at `depths_bb` and measures them; see the module
/// documentation.
///
/// # Errors
///
/// `SpikeError` naming the depth whose configuration, tree, game, solve or certificate
/// failed, or when `depths_bb` is empty.
pub fn run_push_fold(equity: &EquityTable, depths_bb: &[u32]) -> Result<SpikeRun, SpikeError> {
    if depths_bb.is_empty() {
        return Err(SpikeError::new("the push/fold spike needs at least one depth"));
    }
    memory::start();
    let started = Instant::now();
    let depths: Vec<(u64, f64)> =
        depths_bb.iter().map(|&depth| push_fold_depth(equity, depth)).collect::<Result<_, _>>()?;
    let seconds = started.elapsed().as_secs_f64();
    let peak = memory::finish();
    let first = depths_bb.first().copied().unwrap_or_default();
    let last = depths_bb.last().copied().unwrap_or_default();
    Ok(SpikeRun {
        label: format!("push/fold, {} depths from {first} to {last} bb", depths_bb.len()),
        seconds,
        iterations: depths.iter().map(|(iterations, _)| iterations).sum(),
        gain: depths.iter().map(|(_, gain)| *gain).fold(0.0, larger_of),
        peak,
    })
}

/// One push/fold depth: the iterations it took and the larger recomputed seat gain in bb.
fn push_fold_depth(equity: &EquityTable, depth_bb: u32) -> Result<(u64, f64), SpikeError> {
    let at = |what: &str, error: &dyn std::fmt::Display| {
        SpikeError::new(format!("push/fold at {depth_bb} bb: {what}: {error}"))
    };
    let config = push_fold_config(depth_bb).map_err(|e| at("configuration", &e))?;
    let tree = PreflopTree::push_fold(&config).map_err(|e| at("tree", &e))?;
    let game = PreflopGame::new(&tree, &config, equity, None).map_err(|e| at("game", &e))?;
    let solved = solve_push_fold(&config, equity).map_err(|e| at("solve", &e))?;
    let gains = best_response_gains(&game, &solved).map_err(|e| at("certificate", &e))?;
    Ok((u64::from(solved.iterations), larger_of(gains[0], gains[1])))
}

/// Runs the minimal heads-up 100bb P2 solve (O-227) and measures it, reading the sizing
/// spec under `repo_root`.
///
/// # Errors
///
/// `SpikeError` when the spec cannot be read or parsed, or the configuration, tree, game
/// or solve fails.
pub fn run_hu100_at(equity: &EquityTable, repo_root: &Path) -> Result<SpikeRun, SpikeError> {
    let spec = load_seed_spec(repo_root)?;
    memory::start();
    let started = Instant::now();
    let fail = |what: &str, error: &dyn std::fmt::Display| {
        SpikeError::new(format!("100bb run: {what}: {error}"))
    };
    let config = push_fold_config(HU100_DEPTH_BB).map_err(|e| fail("configuration", &e))?;
    let pair = PositionPair::new(Position::Bb, Position::Btn).map_err(|e| fail("pair", &e))?;
    let tree = PreflopTree::build(&spec, &config, pair).map_err(|e| fail("tree", &e))?;
    let game = PreflopGame::new(&tree, &config, equity, Some(FlopPayout::PLACEHOLDER))
        .map_err(|e| fail("game", &e))?;
    let options = CfrOptions {
        max_iterations: HU100_MAX_ITERATIONS,
        target_gain_pct_pot: HU100_TARGET_PCT_POT,
        check_every: HU100_CHECK_EVERY,
    };
    let solved = solve(&game, &options).map_err(|e| fail("solve", &e))?;
    let seconds = started.elapsed().as_secs_f64();
    let peak = memory::finish();
    let pot_bb = f64::from(solved.starting_pot.get()) / CBB_PER_BB;
    if pot_bb <= 0.0 {
        return Err(SpikeError::new("100bb run: the starting pot is empty"));
    }
    Ok(SpikeRun {
        label: format!(
            "100bb P2, {} decision nodes, {} flop lines",
            tree.nodes().len(),
            tree.flop_lines().len()
        ),
        seconds,
        iterations: u64::from(solved.iterations),
        gain: larger_of(solved.gains_bb[0], solved.gains_bb[1]) / pot_bb * PERCENT,
        peak,
    })
}

/// The online seed sizing spec under `repo_root`.
fn load_seed_spec(repo_root: &Path) -> Result<SizingConventionSpec, SpikeError> {
    let path = repo_root.join(SEED_ONLINE_SPEC_RELATIVE_TO_REPO_ROOT);
    let text = std::fs::read_to_string(&path)
        .map_err(|error| SpikeError::new(format!("cannot read {}: {error}", path.display())))?;
    SizingConventionSpec::from_json(&text)
        .map_err(|error| SpikeError::new(format!("{}: {error}", path.display())))
}

/// The larger of two gains; a NaN wins, so it fails the threshold it meets instead of
/// vanishing the way `f64::max` drops it.
fn larger_of(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { f64::NAN } else { a.max(b) }
}

#[cfg(test)]
mod tests {
    use gto_solve::equity::EquityTable;

    use super::larger_of;

    fn empty_table() -> EquityTable {
        EquityTable { classes: Vec::new(), equity: Vec::new(), pairs: Vec::new() }
    }

    #[test]
    fn r2_21_the_larger_gain_keeps_a_nan() {
        assert!((larger_of(1e-12, 3e-12) - 3e-12).abs() < f64::EPSILON);
        assert!(larger_of(f64::NAN, 0.0).is_nan());
        assert!(larger_of(0.0, f64::NAN).is_nan());
    }

    #[test]
    fn r2_21_an_empty_depth_list_is_an_error() {
        assert!(super::run_push_fold(&empty_table(), &[]).is_err());
    }

    #[test]
    fn r2_21_a_missing_seed_spec_is_an_error_naming_the_path() {
        let missing = std::path::Path::new("no-such-repo-root");
        let error = super::run_hu100_at(&empty_table(), missing).map(|_| ()).unwrap_err();
        assert!(error.to_string().contains("seed-online.json"), "{error}");
    }
}
