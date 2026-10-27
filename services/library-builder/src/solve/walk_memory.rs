//! The memory the walk of one runout adds on top of the solve (O-187): the engine solver
//! refuses a line when the solve's estimate plus this overhead is above the job's cap.
//!
//! Mechanism: the builder walks, extracts and writes one runout at a time, so beside the
//! solved game it holds at most one runout's walked nodes, their extracted library copy,
//! the quantized records and the encoded file. One runout's walk visits every turn and
//! river decision node of the betting skeleton once, and each holds an entry per action
//! per live combo of its actor. The live combos on the flop bound those on any later
//! board, so the entry count below is an upper bound. Each entry is charged
//! [`WALK_BYTES_PER_ENTRY`] and each node [`WALK_BYTES_PER_NODE`].

use gto_model::Street;
use gto_solve::postflop::PostflopProblem;
use gto_tree::ActionTree;

use crate::error::BuilderError;

/// Bytes charged per entry (one action of one live combo at one node) while a runout is
/// walked, extracted and written. A walked hand holds its combo, two reach values, an
/// `f32` frequency and an `f64` value per action and two vector headers (at most 48 bytes
/// per entry at two or more actions); its library copy widens the frequencies to `f64`
/// (at most 56); the quantized record and the encoded file add less than either. 192
/// bytes covers all four with room to spare.
pub const WALK_BYTES_PER_ENTRY: u64 = 192;

/// Bytes charged per walked node besides its entries: its lines, dealt cards, actions,
/// key and the vector headers of its hands.
pub const WALK_BYTES_PER_NODE: u64 = 1024;

/// The bytes the walk of one runout of `problem` adds on top of the solve (module docs).
///
/// # Errors
///
/// `BuilderError::Tree` when the skeleton cannot be built.
pub fn runout_walk_bytes(problem: &PostflopProblem) -> Result<u64, BuilderError> {
    let skeleton = ActionTree::build(&problem.tree, problem.root())?;
    let board = problem.board.cards();
    let live = [problem.ranges[0].live_combos(&board), problem.ranges[1].live_combos(&board)]
        .map(|combos| combos.len() as u64);
    let later = skeleton
        .decision_nodes()
        .iter()
        .filter(|node| matches!(node.street, Street::Turn | Street::River));
    let (nodes, entries) = later.fold((0_u64, 0_u64), |(nodes, entries), node| {
        let node_entries = node.actions.len() as u64 * live[node.player.index()];
        (nodes + 1, entries.saturating_add(node_entries))
    });
    Ok(entries
        .saturating_mul(WALK_BYTES_PER_ENTRY)
        .saturating_add(nodes.saturating_mul(WALK_BYTES_PER_NODE)))
}
