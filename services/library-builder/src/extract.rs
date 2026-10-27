//! Runout extraction E6b, the glue between a solve and the library (R2.12, O-17, O-101,
//! O-173): walked nodes (`gto-solve`'s `NodeStrategy`, labelled with the canonical flop
//! the solve ran on) become the library's `SolvedNode`s, relabelled to the raw flop the
//! job names.
//!
//! Mechanism: [`to_solved_node`] builds the node key from the job's preflop line, the
//! canonical flop and the node's street lines and dealt cards (`NodeKey::with_flop`,
//! `with_turn`, `with_river`); maps the actor through the pair to a position; gives each
//! action its total wager in cbb from its token; and keeps every hand's combo index,
//! reach, frequencies and per-action EV (O-175, O-202) in the 1,326-combo space. Then
//! `gto_library::permute_node` applies the canonical-to-raw suit permutation to the key's
//! cards and to every per-combo array (A2 section 3). [`extract_line`] does this for the
//! root street (the flop file) and for each runout (the runout files) and relabels the
//! runout cards the same way. The property `extract(permute(input)) ==
//! permute(extract(input))` is tested over [`permute_strategies`].

use gto_library::{LineBuild, RunoutSpec, SolvedNode};
use gto_model::{ActionToken, ConfigId, Flop, PositionPair, SuitPermutation};
use gto_solve::postflop::NodeStrategy;

use crate::error::BuilderError;
use crate::solve::SolvedLine;

/// What every node of one line shares.
#[derive(Clone, Debug, PartialEq)]
pub struct ExtractContext {
    /// The configuration in the keys.
    pub config_id: ConfigId,
    /// The pair in the keys.
    pub pair: PositionPair,
    /// The preflop actions of the line.
    pub preflop: Vec<ActionToken>,
    /// The flop the solve ran on (canonical for a planner job).
    pub solved_flop: Flop,
    /// The permutation from the solved flop's labels to the job's raw labels.
    pub to_raw: SuitPermutation,
    /// The accuracy every node records, percent of the pot (O-22, O-130).
    pub accuracy_pct_pot: Option<f32>,
}

/// One walked node as a library node in the solved flop's labels (no permutation).
///
/// # Errors
///
/// `BuilderError::Model` when the key cannot be built; `BuilderError::Malformed` when the
/// node's street lines and dealt cards disagree.
pub fn to_solved_node(
    ctx: &ExtractContext,
    node: &NodeStrategy,
) -> Result<SolvedNode, BuilderError> {
    let _ = (ctx, node);
    Err(BuilderError::NotImplemented("to_solved_node"))
}

/// Walked nodes as library nodes, relabelled by `ctx.to_raw`.
///
/// # Errors
///
/// As [`to_solved_node`] and `permute_node`.
pub fn extract_nodes(
    ctx: &ExtractContext,
    nodes: &[NodeStrategy],
) -> Result<Vec<SolvedNode>, BuilderError> {
    let _ = (ctx, nodes);
    Err(BuilderError::NotImplemented("extract_nodes"))
}

/// A solved line as the library's `LineBuild` on the raw flop: the flop nodes, and per
/// runout (relabelled) its turn and river nodes.
///
/// # Errors
///
/// As [`extract_nodes`].
pub fn extract_line(
    ctx: &ExtractContext,
    line: &str,
    tree_hash: &str,
    seed: u64,
    solved: &SolvedLine,
) -> Result<LineBuild, BuilderError> {
    let _ = (ctx, line, tree_hash, seed, solved);
    Err(BuilderError::NotImplemented("extract_line"))
}

/// Walked nodes relabelled by `perm`: dealt cards and every hand's combo, hands re-sorted
/// by combo index. The test-side half of the R2.12 property.
///
/// # Errors
///
/// `BuilderError::Model` when a combo cannot be rebuilt.
pub fn permute_strategies(
    nodes: &[NodeStrategy],
    perm: SuitPermutation,
) -> Result<Vec<NodeStrategy>, BuilderError> {
    let _ = (nodes, perm);
    Err(BuilderError::NotImplemented("permute_strategies"))
}

/// A runout relabelled by `perm`.
#[must_use]
pub fn permute_runout(runout: RunoutSpec, perm: SuitPermutation) -> RunoutSpec {
    RunoutSpec { turn: perm.apply(runout.turn), river: perm.apply(runout.river) }
}
