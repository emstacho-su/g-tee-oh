//! R2.9 and R2.10 joining test: one seed sizing convention goes through every layer, from
//! the shared schema example to a solved flop whose tree hash the engine confirms.
//!
//! Mechanism: the online placeholder of `cfg_6_online_100` is read from the contracts
//! package's shared example file, which the contracts test (R1.6) holds equal to the row the
//! seed migration writes, so this test starts from the catalog of record without a second
//! copy of the seed scanner of `gto-tree`'s R1.6 test. `gto-tree` parses the spec, builds
//! the preflop tree of the big blind against the button and picks its `r250.c` flop line,
//! and turns the same spec into the postflop `TreeConfig`. `gto-solve` solves that line on
//! the dry test flop and reports the canonical tree hash, which must equal
//! `gto_tree::tree_hash` of the configuration and the hash mapped back from the engine's
//! own sizing tables; the configuration must also equal the hand-made tree of the R2.10
//! fixtures, so every R2.10 figure was measured on the seed convention.

#[path = "r2_10_support/mod.rs"]
mod common;

use std::fs;
use std::path::Path;

use gto_model::{Position, PositionPair, v1_configs};
use gto_solve::postflop::{NoProgress, PostflopProblem, StopReason, StopRule, solve_postflop};
use gto_tree::{LineKind, PreflopTree, SizingConventionSpec, TreeConfig, tree_hash};

/// The seed row of `cfg_6_online_100` as the contracts package shares it, relative to this
/// crate's manifest directory.
const SEED_EXAMPLE_RELATIVE_PATH: &str =
    "../../packages/contracts/schemas/examples/sizing-convention/valid/seed-online.json";

/// The configuration the example stands in for.
const CONFIG_ID: &str = "cfg_6_online_100";

/// The flop line the solve starts from: a 2.5 big blind open, called.
const LINE_TEXT: &str = "r250.c";

/// Enough iterations to run the solve through the engine. The target solve of
/// `r2_10_solve` proves convergence; this test proves the join.
const STOP: StopRule =
    StopRule { target_exploitability_pct_pot: 0.3, max_iterations: 20, max_seconds: 300 };

/// The seed spec, parsed from the shared example and checked to name `CONFIG_ID`.
fn seed_spec() -> SizingConventionSpec {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(SEED_EXAMPLE_RELATIVE_PATH);
    let text = fs::read_to_string(&path)
        .unwrap_or_else(|err| panic!("cannot read {}: {err}", path.display()));
    let spec = SizingConventionSpec::from_json(&text)
        .unwrap_or_else(|err| panic!("{}: {err}", path.display()));
    assert_eq!(spec.placeholder_for.as_deref(), Some(CONFIG_ID));
    spec
}

/// R2.9, R2.10: the seed spec's `r250.c` line between the big blind and the button solves
/// on the flop, and the report's tree hash equals the hash of the configuration built from
/// the spec and the hash the engine's tables map back to.
#[test]
fn r2_9_r2_10_seed_spec_tree_solves_and_hash_matches() {
    let spec = seed_spec();
    let config = v1_configs()
        .into_iter()
        .find(|config| config.config_id().as_str() == CONFIG_ID)
        .expect("the online 100 bb configuration is in the v1 catalog");
    let pair = PositionPair::new(Position::Bb, Position::Btn).expect("two seats");
    let preflop = PreflopTree::build(&spec, &config, pair).expect("the preflop tree builds");
    let line = preflop
        .flop_lines()
        .into_iter()
        .find(|line| line.text() == LINE_TEXT)
        .unwrap_or_else(|| panic!("no flop line {LINE_TEXT} for {pair}"));
    assert_eq!(line, common::opened_line(common::FLOP_POT, common::FLOP_STACK));
    assert_eq!(line.kind, LineKind::SingleRaised);
    let root = line.flop_root();

    let tree = TreeConfig::from_spec(&spec).expect("the postflop configuration builds");
    assert_eq!(tree, common::small_tree(), "the seed convention is the R2.10 fixture tree");
    let expected_hash = tree_hash(&tree);

    let problem = PostflopProblem::from_line(
        config,
        line,
        common::flop_board(common::DRY_FLOP),
        [common::range(common::OOP_RANGE), common::range(common::IP_RANGE)],
        tree,
    )
    .expect("a valid problem");
    assert_eq!(problem.root(), root);

    let (solved, report) = solve_postflop(&problem, STOP, 0, &NoProgress).expect("solves");
    println!("R2.9 R2.10 join: {report:?}");
    assert!(report.iterations >= 1, "{report:?}");
    assert_ne!(report.stop_reason, StopReason::MaxSeconds, "{report:?}");
    assert_eq!(report.tree_hash, expected_hash);
    assert_eq!(solved.tree_hash(), expected_hash);
    assert_eq!(solved.engine_tree_hash().expect("the engine tables map back"), expected_hash);
}
