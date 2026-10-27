//! The tree [`super::FakeSolver`] returns: a small, well-formed walk on the job's flop with
//! no engine behind it (R2.17 loop tests, R2.12 extraction tests).
//!
//! Mechanism: the root is an out-of-position decision with a check and one bet of half
//! the root pot (at least 1 cbb, at most the smaller stack), over the out-of-position
//! live combos of the job's ranges (positive weight, no card on the board). Each runout
//! adds one turn node after check-check (`dealt [turn]`, street lines `[[x, x], []]`) and
//! one river node after check-check on the turn (`dealt [turn, river]`, street lines
//! `[[x, x], [x, x], []]`), each over the combos live on its board. Checks move no chips,
//! so every node has the root pot and stacks. Frequencies and values are fixed functions
//! of the combo index, so two calls with one job return equal trees.

use gto_library::RunoutSpec;
use gto_model::{ActionToken, Card, Cbb, ComboId};
use gto_solve::postflop::{HandStrategy, NodeStrategy, SolveError, SolveReport, StopReason};
use gto_tree::Player;

use super::{LineJob, SolvedLine};
use crate::error::BuilderError;

/// The iterations the fake reports.
const FAKE_ITERATIONS: u32 = 100;
/// Frequency steps a combo's check frequency cycles through.
const FREQUENCY_STEPS: u16 = 10;
/// Centi-big-blinds in a big blind.
const CBB_PER_BB: f64 = 100.0;

/// The fake's solved line for `job`.
pub(super) fn solved_line(
    job: &LineJob,
    gains_pct_pot: [f64; 2],
    estimate_bytes: u64,
) -> Result<SolvedLine, BuilderError> {
    let board = job.problem.board.cards();
    let shape = Shape::of(job);
    let root_nodes = vec![shape.node(job, &board, Vec::new(), vec![Vec::new()])];
    let runout_nodes = job
        .runouts
        .iter()
        .map(|runout| Ok((*runout, shape.runout_nodes(job, &board, *runout)?)))
        .collect::<Result<Vec<_>, BuilderError>>()?;
    let report = SolveReport {
        iterations: FAKE_ITERATIONS,
        exploitability_pct_pot: gains_pct_pot.map(narrow),
        peak_bytes: estimate_bytes,
        estimate_bytes,
        seconds: 0.0,
        stop_reason: StopReason::Target,
        storage: job.options.storage,
        tree_hash: gto_tree::tree_hash(&job.problem.tree),
    };
    Ok(SolvedLine { report, gains_pct_pot, root_nodes, runout_nodes })
}

/// A gain as the report's `f32`; gains are small percentages, well inside its range.
#[allow(clippy::cast_possible_truncation, reason = "a percent of the pot fits an f32")]
fn narrow(value: f64) -> f32 {
    value as f32
}

/// The pot, stacks and actions every fake node shares.
struct Shape {
    pot: Cbb,
    stacks: [Cbb; 2],
    actions: Vec<ActionToken>,
}

impl Shape {
    fn of(job: &LineJob) -> Shape {
        let pot = job.problem.pot;
        let stacks = job.problem.stacks;
        let behind = stacks[0].get().min(stacks[1].get());
        let size = (pot.get() / 2).max(1).min(behind.max(1));
        Shape { pot, stacks, actions: vec![ActionToken::Check, ActionToken::Bet(Cbb(size))] }
    }

    /// The turn and river node of `runout`, refused like the engine when a card is on the
    /// board or dealt twice.
    fn runout_nodes(
        &self,
        job: &LineJob,
        board: &[Card],
        runout: RunoutSpec,
    ) -> Result<Vec<NodeStrategy>, BuilderError> {
        let (turn, river) = (runout.turn, runout.river);
        if turn == river || board.contains(&turn) || board.contains(&river) {
            return Err(BuilderError::Solve(SolveError::Problem(format!(
                "the runout {runout} cannot be dealt on this board"
            ))));
        }
        let x = ActionToken::Check;
        let turn_board = [board, &[turn]].concat();
        let river_board = [board, &[turn, river]].concat();
        Ok(vec![
            self.node(job, &turn_board, vec![turn], vec![vec![x, x], Vec::new()]),
            self.node(
                job,
                &river_board,
                vec![turn, river],
                vec![vec![x, x], vec![x, x], Vec::new()],
            ),
        ])
    }

    /// An out-of-position node on `board` reached along `street_lines` after `dealt`.
    fn node(
        &self,
        job: &LineJob,
        board: &[Card],
        dealt: Vec<Card>,
        street_lines: Vec<Vec<ActionToken>>,
    ) -> NodeStrategy {
        let hero = job.problem.ranges[Player::Oop.index()].live_combos(board);
        let villain = job.problem.ranges[Player::Ip.index()].live_combos(board);
        let half_pot_bb = f64::from(self.pot.get()) / CBB_PER_BB / 2.0;
        let hands = hero
            .iter()
            .map(|combo| {
                hand(*combo, share(hero.len()), villain_reach(&villain, *combo), half_pot_bb)
            })
            .collect();
        NodeStrategy {
            line: street_lines.concat(),
            street_lines,
            dealt,
            player: Player::Oop,
            pot: self.pot,
            stacks: self.stacks,
            actions: self.actions.clone(),
            hands,
        }
    }
}

/// One hand of the fake: a check frequency cycling with the combo index, the rest bet.
fn hand(combo: ComboId, actor_reach: f64, opponent_reach: f64, half_pot_bb: f64) -> HandStrategy {
    let step = u16::from(combo) % FREQUENCY_STEPS;
    let check = f32::from(step) / f32::from(FREQUENCY_STEPS);
    let tilt = f64::from(step) / f64::from(FREQUENCY_STEPS);
    HandStrategy {
        combo,
        reach: [actor_reach, opponent_reach],
        frequencies: vec![check, 1.0 - check],
        ev_bb: vec![half_pot_bb + tilt, half_pot_bb - tilt],
    }
}

/// An even share of `count` hands, zero for none.
fn share(count: usize) -> f64 {
    u32::try_from(count).map_or(0.0, |count| if count == 0 { 0.0 } else { 1.0 / f64::from(count) })
}

/// The opponent's normalised reach of `combo`: an even share when it is in the opponent's
/// live list, zero otherwise.
fn villain_reach(villain: &[ComboId], combo: ComboId) -> f64 {
    if villain.contains(&combo) { share(villain.len()) } else { 0.0 }
}
