//! The engine's discounted counterfactual regret minimization (DCFR) solver under a stop
//! rule. Owner: the G1 agent (R2.4).
//!
//! Mechanism. `Solver::new(game)` sizes the regret and strategy storage; each
//! `run(chunk, params, 0, |_, _, _| {})` advances the solve by one chunk with the engine's
//! own reporting off, so the engine never calls its `exploitability`, whose debug
//! assertion trips on Kuhn's negative player-0 value (O-102). After each chunk
//! `measure::measure` reads `solver.average()`; the loop stops when `NashConv` is below
//! the stop rule's target or the iteration count has reached its maximum, the last chunk
//! being cut short so the maximum is never exceeded; a chunk of 0 is read as 1. `curve`
//! is the same run measured at each checkpoint instead, with the rules `super::curve`
//! documents (a checkpoint of 0 is the uniform profile before any iteration). `solve`
//! hands back `measure::tables` of the average strategy. Leduc has 6 chance outcomes,
//! below the engine's `PAR_MIN_OUTCOMES` of 8, so every toy solve stays on the
//! sequential, bit-deterministic path.

use postflop_engine::cfr::{DcfrParams, Solver};
use postflop_engine::game::Game;

use super::{CurvePoint, Measurement, Solved, StopRule, measure};

/// Solve `game` by DCFR with `params` in chunks under `stop`, and hand back the measured
/// average strategy.
pub(crate) fn solve<G: Game + Sync>(game: G, params: &DcfrParams, stop: &StopRule) -> Solved {
    let mut solver = Solver::new(game);
    let chunk = stop.chunk.max(1);
    let measurement = loop {
        let remaining = stop.max_iterations.saturating_sub(solver.iterations());
        advance(&mut solver, chunk.min(remaining), params);
        let measurement = measure_average(&solver);
        let converged = measurement.exploitability.nash_conv_chips < stop.target_nash_conv_chips;
        if converged || solver.iterations() >= stop.max_iterations {
            break measurement;
        }
    };
    let tables = measure::tables(solver.game(), &solver.average());
    Solved { iterations: solver.iterations(), measurement, tables }
}

/// One continuous DCFR run with `params`, measured at each checkpoint.
pub(crate) fn curve<G: Game + Sync>(
    game: G,
    params: &DcfrParams,
    checkpoints: &[u64],
) -> Vec<CurvePoint> {
    let mut solver = Solver::new(game);
    checkpoints
        .iter()
        .map(|&checkpoint| {
            let remaining = checkpoint.saturating_sub(solver.iterations());
            advance(&mut solver, remaining, params);
            let measurement = measure_average(&solver);
            CurvePoint {
                iteration: solver.iterations(),
                exploitability: measurement.exploitability,
                value_chips: measurement.value_chips,
            }
        })
        .collect()
}

/// Run `iterations` more DCFR iterations with the engine's own reporting off.
fn advance<G: Game + Sync>(solver: &mut Solver<G>, iterations: u64, params: &DcfrParams) {
    solver.run(iterations, params, 0, |_, _, _| {});
}

/// Measure the solver's current average strategy.
fn measure_average<G: Game>(solver: &Solver<G>) -> Measurement {
    measure::measure(solver.game(), &solver.average())
}

#[cfg(test)]
mod tests {
    use postflop_engine::cfr::DcfrParams;
    use postflop_engine::games::kuhn::Kuhn;

    use super::super::StopRule;
    use super::{curve, solve};

    /// R2.4: a chunk of 0 is read as 1 and the maximum is never exceeded, so a rule of 3
    /// iterations with chunk 0 and an unreachable target runs exactly 3.
    #[test]
    fn r2_4_stop_rule_caps_iterations_and_reads_chunk_0_as_1() {
        let stop = StopRule { target_nash_conv_chips: 0.0, max_iterations: 3, chunk: 0 };
        let solved = solve(Kuhn::new(), &DcfrParams::default(), &stop);
        assert_eq!(solved.iterations, 3);
        assert_eq!(solved.tables.information_states, 12);
    }

    /// R2.4: with a chunk larger than the maximum the last chunk is cut, and a chunk that
    /// does not divide the maximum still lands on it exactly.
    #[test]
    fn r2_4_last_chunk_is_cut_to_the_maximum() {
        let params = DcfrParams::default();
        let big = StopRule { target_nash_conv_chips: 0.0, max_iterations: 5, chunk: 1_000 };
        assert_eq!(solve(Kuhn::new(), &params, &big).iterations, 5);
        let uneven = StopRule { target_nash_conv_chips: 0.0, max_iterations: 7, chunk: 3 };
        assert_eq!(solve(Kuhn::new(), &params, &uneven).iterations, 7);
        let none = StopRule { target_nash_conv_chips: 0.0, max_iterations: 0, chunk: 3 };
        assert_eq!(solve(Kuhn::new(), &params, &none).iterations, 0);
    }

    /// R2.4: the stop rule ends the run at the first chunk whose `NashConv` is below the
    /// target, so a loose target stops before the maximum.
    #[test]
    fn r2_4_loose_target_stops_before_the_maximum() {
        let stop = StopRule { target_nash_conv_chips: 0.5, max_iterations: 100_000, chunk: 10 };
        let solved = solve(Kuhn::new(), &DcfrParams::default(), &stop);
        assert!(solved.measurement.exploitability.nash_conv_chips < 0.5);
        assert!(solved.iterations < 100_000, "{} iterations", solved.iterations);
        assert_eq!(solved.iterations % 10, 0, "whole chunks until the target");
    }

    /// R2.4: checkpoint 0 is the uniform profile before any iteration, checkpoints are
    /// visited in order, and a checkpoint at or below the current count does not advance.
    #[test]
    fn r2_4_curve_visits_checkpoints_in_order_without_rewinding() {
        let points = curve(Kuhn::new(), &DcfrParams::default(), &[0, 50, 20, 100]);
        let iterations: Vec<u64> = points.iter().map(|point| point.iteration).collect();
        assert_eq!(iterations, [0, 50, 50, 100]);
        assert_eq!(points[1].exploitability, points[2].exploitability, "no rewind");
        let first = points[0].exploitability.nash_conv_chips;
        let last = points[3].exploitability.nash_conv_chips;
        assert!(last < first, "exploitability fell from {first} to {last}");
    }
}
