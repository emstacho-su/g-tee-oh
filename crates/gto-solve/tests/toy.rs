//! Red tests for the toy module (R2.4, R2.5, R2.6): the S13 plan section B numbers,
//! written before the module is filled so each gate agent has a fixed target. The
//! gate tests in `tools/validate/tests/gates.rs` judge the fixtures; these pin the
//! adapter itself: the Leduc model before any solver runs, the DCFR stop rule on Kuhn,
//! the polar river game, and the plain CFR (counterfactual regret minimization)
//! reference traversal. Units are chips with the ante as the unit.

use gto_solve::toy::{SolverMode, StopRule, ToyGame, curve, solve_dcfr};

/// Kuhn's game value to player 0, minus 1/18 chips (Kuhn 1950).
const KUHN_VALUE_PLAYER_0: f64 = -1.0 / 18.0;
/// Gate G1's two tolerances, in chips: on the value and on `NashConv`.
const G1_VALUE_ABS: f64 = 0.001;
const G1_NASH_CONV_FLOOR: f64 = 0.001;
/// Gate G1's stop rule: chunks of 1,000 until `NashConv` is below 1e-4 or 200,000.
const G1_STOP: StopRule =
    StopRule { target_nash_conv_chips: 1e-4, max_iterations: 200_000, chunk: 1_000 };
/// Gate G2's stop rule: chunks of 1,000 until `NashConv` is below 1e-5 or 1,000,000.
const G2_STOP: StopRule =
    StopRule { target_nash_conv_chips: 1e-5, max_iterations: 1_000_000, chunk: 1_000 };
/// Gate G2's tolerance, 0.5 percentage points in frequency units.
const G2_FREQUENCY_TOLERANCE: f64 = 0.005;
/// One iteration, enough to read the tables of a game.
const ONE_ITERATION: StopRule =
    StopRule { target_nash_conv_chips: 0.0, max_iterations: 1, chunk: 1 };
/// The first row of `validation/fixtures/openspiel/leduc_exploitability.json`: the mean
/// gain of the uniform profile, which is `OpenSpiel`'s average policy after one iteration.
const OPENSPIEL_UNIFORM_MEAN_GAIN: f64 = 2.373_611_111_111_111;
const UNIFORM_TOLERANCE: f64 = 1e-6;
/// The information state count `OpenSpiel` reports for `leduc_poker`.
const LEDUC_INFORMATION_STATES: u64 = 936;
/// Plain CFR on Kuhn: `NashConv` below 0.01 chips after 10,000 iterations.
const PLAIN_CFR_KUHN_ITERATIONS: u64 = 10_000;
const PLAIN_CFR_KUHN_NASH_CONV: f64 = 0.01;

fn assert_close(actual: f64, expected: f64, tolerance: f64, what: &str) {
    let error = (actual - expected).abs();
    assert!(
        error <= tolerance,
        "{what}: {actual} is {error} from {expected}, tolerance {tolerance}"
    );
}

/// R2.6: before any solver runs, the mean best-response gain of the uniform profile on
/// the Leduc model is the first row of the committed curve within 1e-6 chips, which pins
/// the model (tree, chance weights, payoffs, normalizer) against `OpenSpiel`.
#[test]
fn r2_6_leduc_uniform_profile_matches_openspiel_iteration_1() {
    let points = curve(ToyGame::Leduc, SolverMode::PlainCfr, &[0]);
    assert_eq!(points.len(), 1, "one point per checkpoint");
    let point = points[0];
    assert_eq!(point.iteration, 0, "checkpoint 0 is the profile before any iteration");
    let exploitability = point.exploitability;
    assert_close(
        exploitability.mean_chips,
        OPENSPIEL_UNIFORM_MEAN_GAIN,
        UNIFORM_TOLERANCE,
        "uniform profile mean gain",
    );
    assert_close(
        exploitability.nash_conv_chips,
        2.0 * exploitability.mean_chips,
        1e-12,
        "NashConv is twice the mean gain",
    );
    assert_close(
        exploitability.gain_chips[0] + exploitability.gain_chips[1],
        exploitability.nash_conv_chips,
        1e-12,
        "NashConv is the sum of the gains",
    );
}

/// R2.6: the Leduc model has 936 information states, the acting player's live combos
/// summed over the decision nodes, with round-2 nodes one per public card.
#[test]
fn r2_6_leduc_has_936_information_states() {
    let solution = solve_dcfr(ToyGame::Leduc, &ONE_ITERATION);
    assert_eq!(solution.information_states(), LEDUC_INFORMATION_STATES);
    assert_eq!(solution.iterations, 1, "the stop rule caps the run at one iteration");
    assert_eq!(solution.game, ToyGame::Leduc);
    assert_eq!(solution.mode, SolverMode::dcfr_default());
}

/// R2.4: the engine's DCFR on Kuhn under the G1 stop rule reaches the floor, lands the
/// value within tolerance of minus 1/18, and exposes the fixture vocabulary.
#[test]
fn r2_4_kuhn_dcfr_reaches_the_floor() {
    let solution = solve_dcfr(ToyGame::Kuhn, &G1_STOP);
    assert!(
        solution.exploitability.nash_conv_chips < G1_NASH_CONV_FLOOR,
        "NashConv {} is not below {G1_NASH_CONV_FLOOR} after {} iterations",
        solution.exploitability.nash_conv_chips,
        solution.iterations
    );
    assert!(solution.iterations <= G1_STOP.max_iterations, "{} iterations", solution.iterations);
    assert_close(solution.value_chips[0], KUHN_VALUE_PLAYER_0, G1_VALUE_ABS, "value to player 0");
    assert_close(solution.value_chips[0], -solution.value_chips[1], 1e-6, "zero sum");
    let bet_j = solution.frequency(0, "open", "J", "bet").expect("p0-open-bet-j resolves");
    assert!((-G2_FREQUENCY_TOLERANCE..=1.0 / 3.0 + G2_FREQUENCY_TOLERANCE).contains(&bet_j));
    assert_eq!(solution.root_weight(0, "J"), Some(1.0));
    assert_eq!(solution.frequency(0, "open", "J", "raise"), None, "not in the vocabulary");
    assert_eq!(solution.information_states(), 12);
}

/// R2.5: the polar river toy at a pot sized bet has the unique equilibrium 04 section 6
/// states: bet the nuts always, bet air half the time, call half the time, with equal
/// root weights so bluffs are one third of the bets.
#[test]
fn r2_5_polar_river_equilibrium_is_half_half() {
    let game = ToyGame::PolarRiver { pot: 1.0, bet: 1.0 };
    let solution = solve_dcfr(game, &G2_STOP);
    let frequency = |player: u8, node: &str, holding: &str, action: &str| {
        solution
            .frequency(player, node, holding, action)
            .unwrap_or_else(|| panic!("{holding} {action} at {node} resolves"))
    };
    let bet_nuts = frequency(1, "open", "nuts", "bet");
    let bet_air = frequency(1, "open", "air", "bet");
    let call = frequency(0, "facing_bet", "bluff_catcher", "call");
    assert_close(bet_nuts, 1.0, G2_FREQUENCY_TOLERANCE, "bet nuts");
    assert_close(bet_air, 0.5, G2_FREQUENCY_TOLERANCE, "bet air");
    assert_close(call, 0.5, G2_FREQUENCY_TOLERANCE, "call with the bluff catcher");
    let weight_nuts = solution.root_weight(1, "nuts").expect("nuts has a root weight");
    let weight_air = solution.root_weight(1, "air").expect("air has a root weight");
    assert_eq!(weight_nuts, weight_air, "equal root weights");
    let bluff_share = bet_air * weight_air / (bet_air * weight_air + bet_nuts * weight_nuts);
    assert_close(bluff_share, 1.0 / 3.0, G2_FREQUENCY_TOLERANCE, "bluff share of bets");
}

/// R2.6: the plain CFR reference traversal converges on Kuhn, so the G3 run on Leduc is
/// a solver and not a fixed point of the uniform profile.
#[test]
fn r2_6_plain_cfr_on_kuhn_converges() {
    let points = curve(ToyGame::Kuhn, SolverMode::PlainCfr, &[1, PLAIN_CFR_KUHN_ITERATIONS]);
    assert_eq!(points.len(), 2, "one point per checkpoint");
    assert_eq!(points[0].iteration, 1);
    assert_eq!(points[1].iteration, PLAIN_CFR_KUHN_ITERATIONS);
    let last = points[1].exploitability.nash_conv_chips;
    assert!(last < PLAIN_CFR_KUHN_NASH_CONV, "NashConv {last} after {PLAIN_CFR_KUHN_ITERATIONS}");
    assert!(last < points[0].exploitability.nash_conv_chips, "exploitability fell");
    assert_close(points[1].value_chips[0], KUHN_VALUE_PLAYER_0, 0.01, "value to player 0");
}
