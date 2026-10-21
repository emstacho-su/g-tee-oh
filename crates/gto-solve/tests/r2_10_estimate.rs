//! R2.10 estimate tests (O-139): the storage part of `estimate_memory` equals the bytes
//! the engine's solver holds, in 16-bit and 32-bit storage and from every root street, and
//! the node count and chance map payload match the engine's game exactly. The allocator
//! bound has its own binary, `r2_10_estimate_peak`, so no other test shares its heap.

#[path = "r2_10_support/mod.rs"]
mod common;

use common::{IP_RANGE, flop_board, narrow_tree, problem_with, range, small_problem};
use gto_model::Board;
use gto_solve::postflop::{
    NoProgress, PostflopProblem, SolveOptions, StopRule, StorageBits, estimate_bytes,
    estimate_bytes_with, estimate_memory, solve_postflop_with,
};

/// Builds the game and the solver and runs no iteration.
const BUILD_ONLY: StopRule =
    StopRule { target_exploitability_pct_pot: 0.0, max_iterations: 0, max_seconds: 60 };

fn turn_board() -> Board {
    flop_board(common::DRY_FLOP).with_turn("9h".parse().expect("a card")).expect("a turn")
}

fn river_board() -> Board {
    turn_board().with_river("4s".parse().expect("a card")).expect("a river")
}

fn assert_estimate_matches_engine(problem: &PostflopProblem, storage: StorageBits) {
    let estimate = estimate_memory(problem, storage).expect("the estimate builds");
    let options = SolveOptions { storage, ..SolveOptions::default() };
    let (solved, report) = solve_postflop_with(problem, BUILD_ONLY, 0, &NoProgress, &options)
        .expect("the game builds");
    assert_eq!(estimate.nodes, solved.nodes(), "{storage:?} nodes");
    assert_eq!(estimate.storage_bytes, solved.storage_bytes(), "{storage:?} storage");
    assert_eq!(estimate.chance_map_bytes, solved.chance_map_bytes(), "{storage:?} chance maps");
    assert_eq!(report.estimate_bytes, estimate.total_bytes);
    assert_eq!(report.peak_bytes, estimate.total_bytes, "storage and maps are exact");
    assert_eq!(solved.storage(), storage);
}

/// R2.10: on the flop test spot, the estimate's storage is the engine's storage, byte for
/// byte, in both storage modes, and 16-bit storage is the smaller.
#[test]
fn r2_10_estimate_storage_equals_engine_storage_bytes() {
    let problem = small_problem();
    for storage in [StorageBits::Sixteen, StorageBits::ThirtyTwo] {
        assert_estimate_matches_engine(&problem, storage);
    }
    let sixteen = estimate_memory(&problem, StorageBits::Sixteen).expect("estimate");
    let thirty_two = estimate_memory(&problem, StorageBits::ThirtyTwo).expect("estimate");
    assert!(sixteen.storage_bytes < thirty_two.storage_bytes);
    assert_eq!(sixteen.storage_entries, thirty_two.storage_entries);
}

/// R2.10: the same exactness from a turn root and a river root, with wide ranges.
#[test]
fn r2_10_estimate_is_exact_from_turn_and_river_roots() {
    for board in [turn_board(), river_board()] {
        let problem = problem_with(board, narrow_tree(), [common::full_range(), range(IP_RANGE)]);
        for storage in [StorageBits::Sixteen, StorageBits::ThirtyTwo] {
            assert_estimate_matches_engine(&problem, storage);
        }
    }
}

/// R2.10: a range whose every live combo holds one of the two cards a river deals, with
/// the pair of them live, removes more combos than it holds unless the pair is added back
/// before the subtraction; the estimate must survive it and stay exact against the engine.
#[test]
fn r2_10_estimate_survives_ranges_pinned_to_the_dealt_cards() {
    for oop in ["AhKh", "AhKh,AhQh,AhJh"] {
        let board = flop_board(common::DRY_FLOP);
        let problem = problem_with(board, narrow_tree(), [range(oop), range(IP_RANGE)]);
        assert_estimate_matches_engine(&problem, StorageBits::Sixteen);
    }
}

/// R2.10: `estimate_bytes` is the 16-bit estimate, and the 32-bit one is larger.
#[test]
fn r2_10_estimate_bytes_defaults_to_sixteen_bit() {
    let problem = small_problem();
    let default = estimate_bytes(&problem).expect("estimate");
    assert_eq!(default, estimate_bytes_with(&problem, StorageBits::Sixteen).expect("estimate"));
    assert!(default < estimate_bytes_with(&problem, StorageBits::ThirtyTwo).expect("estimate"));
    assert_eq!(StorageBits::default(), StorageBits::Sixteen);
    assert_eq!(SolveOptions::default().storage, StorageBits::Sixteen);
}
