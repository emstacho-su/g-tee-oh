//! The memory a heads-up postflop solve will hold, estimated before anything is allocated
//! (R2.10, O-139).
//!
//! Mechanism: the estimate builds only the card-free betting skeleton of `gto-tree`, never
//! the engine game. The engine's tree has one copy of each street's betting per runout, so
//! a count on a street dealt `k` cards after the root takes the multiplier `n (n - 1) ...`
//! over `k` factors, where `n` is the number of unseen cards at the root (49 on a flop):
//! that gives `N`, the engine's node count. The solver's storage holds one entry per action
//! per live combo of the acting player at every decision node, `E` in all; a combo is live
//! on every runout that misses its two cards, which is `(n - 2) (n - 3) ...` of them, so
//! `E` is exact without enumerating runouts. The engine stores 16-bit entries as `2 (2E +
//! 4N)` bytes (an `i16` per entry and an `f32` scale per node, in two arrays) and 32-bit
//! entries as `8E` bytes; the estimate reproduces both exactly.
//!
//! On top of storage the estimate models the rest of the engine's heap from its layout
//! (`layout`): the tree arena, the action lists and chance child tables, the per-node
//! tables of the game and the solver, chance and terminal data, the distinct boards with
//! their live hand lists, the shared chance maps, the traversal scratch and a fixed
//! allowance for parsing. The peak is the larger of the steady state during the solve and
//! the moment the tree arena last doubles, when its old and new buffers coexist.

use gto_model::{ComboId, Street};
use gto_tree::{ActionTree, DecisionNode};

use super::error::SolveError;
use super::layout::{
    ACTION, BOARD_CARDS, BOARD_DATA, CARD_MAP, CHANCE_CHILDREN, CHANCE_DATA, DECK, HAND, MAP_ENTRY,
    NODE, NODE_INFO, OUTCOME, TERM_DATA, WORD, hash_table_bytes, vec_capacity,
};
use super::problem::PostflopProblem;
use super::runouts::{LiveCounts, Runouts};
use super::solve::StorageBits;

/// A fixed allowance for the engine's parsing and set-up buffers (range expansion, the
/// board id table) and the adapter's own small structures.
const FIXED_BYTES: u64 = 128 * 1024;
/// Bytes per `f32` working value.
const FLOAT: u64 = 4;
/// Traversal levels beyond the longest line: up to two chance nodes and the terminal.
const EXTRA_LEVELS: u64 = 3;

/// The estimate, part by part, in bytes unless named otherwise.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MemoryEstimate {
    /// The storage the estimate is for.
    pub storage: StorageBits,
    /// Engine tree nodes of every kind, `N`.
    pub nodes: u64,
    /// Storage entries, `E`: actions times the actor's live combos, over every decision.
    pub storage_entries: u64,
    /// The solver's regret and strategy arrays, exactly as the engine accounts them.
    pub storage_bytes: u64,
    /// The shared chance maps' payload, exactly as the engine accounts it.
    pub chance_map_bytes: u64,
    /// The tree arena, the action lists and the chance child tables.
    pub tree_bytes: u64,
    /// The game and solver side tables, boards, chance and terminal data, and the spare
    /// capacity of the chance maps.
    pub table_bytes: u64,
    /// Traversal scratch for every worker thread plus the fixed allowance.
    pub working_bytes: u64,
    /// The modeled peak: the parts above, or the arena doubling if that is larger.
    pub total_bytes: u64,
}

/// The estimated peak bytes of a solve with 16-bit storage, the default.
///
/// # Errors
///
/// The errors of `estimate_memory`.
pub fn estimate_bytes(problem: &PostflopProblem) -> Result<u64, SolveError> {
    estimate_bytes_with(problem, StorageBits::Sixteen)
}

/// The estimated peak bytes of a solve with the given storage.
///
/// # Errors
///
/// The errors of `estimate_memory`.
pub fn estimate_bytes_with(
    problem: &PostflopProblem,
    storage: StorageBits,
) -> Result<u64, SolveError> {
    estimate_memory(problem, storage).map(|estimate| estimate.total_bytes)
}

/// The estimate part by part. Builds the betting skeleton only.
///
/// # Errors
///
/// `SolveError::Problem` from `PostflopProblem::validate` and `SolveError::Tree` when the
/// skeleton cannot be built.
pub fn estimate_memory(
    problem: &PostflopProblem,
    storage: StorageBits,
) -> Result<MemoryEstimate, SolveError> {
    problem.validate()?;
    let skeleton = ActionTree::build(&problem.tree, problem.root())?;
    Ok(memory_of(&skeleton, problem, storage, worker_threads()))
}

/// Worker threads the engine's parallel traversal may run on, read without starting the
/// thread pool so that a refused problem allocates nothing for it.
pub(crate) fn worker_threads() -> u64 {
    std::thread::available_parallelism().map_or(1, |threads| threads.get() as u64)
}

/// Engine node counts after the runout multipliers.
#[derive(Clone, Copy, Debug, Default)]
struct EngineCounts {
    nodes: u64,
    chance: u64,
    terminals: u64,
    entries: u64,
    action_list_bytes: u64,
    outcome_list_bytes: u64,
}

/// The estimate for a skeleton already built from `problem`.
pub(crate) fn memory_of(
    skeleton: &ActionTree,
    problem: &PostflopProblem,
    storage: StorageBits,
    threads: u64,
) -> MemoryEstimate {
    let board = problem.board.cards();
    let live = [problem.ranges[0].live_combos(&board), problem.ranges[1].live_combos(&board)];
    let runouts = Runouts::new(problem.street(), board.len());
    let counts = engine_counts(skeleton, &runouts, [live[0].len(), live[1].len()]);
    let live_counts = LiveCounts::new(&board, &live);
    let (map_payload, map_bytes) = chance_map_bytes(skeleton, &runouts, &live_counts);
    let storage_bytes = storage_bytes(storage, counts.entries, counts.nodes);
    let arena = vec_capacity(counts.nodes) * NODE;
    let tree_bytes = arena + counts.action_list_bytes + counts.chance * CHANCE_CHILDREN;
    let table_bytes = node_table_bytes(&counts)
        + board_bytes(skeleton, &runouts, &live_counts)
        + (map_bytes - map_payload)
        + text_bytes(problem);
    let working_bytes = working_bytes(skeleton, &live, &runouts, threads);
    let steady = storage_bytes + map_payload + tree_bytes + table_bytes + working_bytes;
    let doubling = tree_bytes + arena / 2 + FIXED_BYTES;
    MemoryEstimate {
        storage,
        nodes: counts.nodes,
        storage_entries: counts.entries,
        storage_bytes,
        chance_map_bytes: map_payload,
        tree_bytes,
        table_bytes,
        working_bytes,
        total_bytes: steady.max(doubling),
    }
}

/// The engine's storage accounting: `Solver::storage_bytes`.
pub(crate) fn storage_bytes(storage: StorageBits, entries: u64, nodes: u64) -> u64 {
    match storage {
        StorageBits::Sixteen => 2 * (2 * entries + WORD * nodes),
        StorageBits::ThirtyTwo => 2 * FLOAT * entries,
    }
}

/// Node, entry and list counts of the engine tree.
fn engine_counts(skeleton: &ActionTree, runouts: &Runouts, live: [usize; 2]) -> EngineCounts {
    let mut counts = EngineCounts::default();
    let skeleton_counts = skeleton.counts();
    for street in [Street::Flop, Street::Turn, Street::River] {
        let Some(on_street) = skeleton_counts.street(street) else { continue };
        let copies = runouts.copies(street);
        counts.nodes += on_street.nodes() * copies;
        counts.chance += on_street.chance * copies;
        counts.terminals += (on_street.fold + on_street.showdown) * copies;
        let outcomes = runouts.outcomes_after(street);
        counts.outcome_list_bytes += on_street.chance * copies * vec_capacity(outcomes) * OUTCOME;
    }
    for node in skeleton.decision_nodes() {
        counts.entries += node_entries(node, runouts, live);
        let actions = node.actions.len() as u64;
        counts.action_list_bytes += vec_capacity(actions) * ACTION * runouts.copies(node.street);
    }
    counts
}

/// Storage entries for one skeleton decision node over all its runout copies.
fn node_entries(node: &DecisionNode, runouts: &Runouts, live: [usize; 2]) -> u64 {
    let actor_live = live[node.player.index()] as u64;
    node.actions.len() as u64 * actor_live * runouts.live_copies(node.street)
}

/// The per-node tables, the chance and terminal data and the root weights.
fn node_table_bytes(counts: &EngineCounts) -> u64 {
    let game_per_node = NODE_INFO + 2 * WORD;
    let solver_per_node = 2 * WORD;
    counts.nodes * (game_per_node + solver_per_node)
        + vec_capacity(counts.chance) * CHANCE_DATA
        + counts.outcome_list_bytes
        + vec_capacity(counts.terminals) * TERM_DATA
}

/// The distinct boards and their live hand lists, index lists and showdown rankings.
fn board_bytes(skeleton: &ActionTree, runouts: &Runouts, live: &LiveCounts) -> u64 {
    let deals = runouts.reached_deals(&skeleton.counts());
    let mut total = live.root_weight_bytes();
    live.for_each_board(deals, &mut |board| {
        let lists: u64 = board
            .live
            .iter()
            .map(|&combos| {
                let ranks = if board.complete { 2 * WORD * combos } else { 0 };
                vec_capacity(combos) * (HAND + WORD) + ranks
            })
            .sum();
        total += BOARD_DATA + BOARD_CARDS + lists;
    });
    total
}

/// The chance maps: their payload as the engine counts it, and the bytes they hold with
/// spare capacity, the per-board card tables and the table that keys them. A board gets
/// maps when the tree deals a card from it.
fn chance_map_bytes(skeleton: &ActionTree, runouts: &Runouts, live: &LiveCounts) -> (u64, u64) {
    let deals = runouts.reached_deals(&skeleton.counts());
    if deals == 0 {
        return (0, 0);
    }
    let mut payload = 0;
    let mut held = 0;
    let mut parents = 0;
    live.for_each_board(deals - 1, &mut |parent| {
        parents += 1;
        held += DECK * CARD_MAP;
        live.for_each_child(parent, &mut |child| {
            for &combos in &child.live {
                payload += combos * WORD;
                held += vec_capacity(combos) * WORD;
            }
        });
    });
    (payload, held + hash_table_bytes(parents, MAP_ENTRY))
}

/// The range texts the adapter writes and the engine keeps a copy of.
fn text_bytes(problem: &PostflopProblem) -> u64 {
    let text: usize = problem.ranges.iter().map(|range| range.to_engine_notation().len()).sum();
    2 * text as u64
}

/// Traversal scratch: per level of the deepest line, at most two action-by-combo vectors
/// and three combo vectors, with room to double, for each worker and the main thread,
/// plus the best-response walk and the per-card values of a parallel chance node.
fn working_bytes(
    skeleton: &ActionTree,
    live: &[Vec<ComboId>; 2],
    runouts: &Runouts,
    threads: u64,
) -> u64 {
    let nodes = skeleton.decision_nodes();
    let depth = nodes.iter().map(|node| node.line.len() as u64).max().unwrap_or(0) + EXTRA_LEVELS;
    let actions = nodes.iter().map(|node| node.actions.len() as u64).max().unwrap_or(0);
    let combos = live.iter().map(|combos| combos.len() as u64).max().unwrap_or(0);
    let per_level = (2 * actions * combos + 3 * combos) * FLOAT;
    let per_walk = 2 * depth * per_level;
    let codec = actions * combos * FLOAT;
    let fork = runouts.unseen() * combos * FLOAT;
    (threads + 1) * (per_walk + codec) + per_walk + fork + FIXED_BYTES
}
