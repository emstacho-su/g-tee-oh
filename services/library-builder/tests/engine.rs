//! Real solves through the vendored engine (R2.12, R2.17, O-178): ignored in continuous
//! integration and run once at the gate in release, where the ten-combo spot solves in
//! seconds:
//!
//! ```text
//! cargo test --release -p library-builder --test engine -- --ignored
//! ```

mod common;

use std::sync::Arc;

use common::fixture;
use gto_library::{RunoutSpec, draw_runouts, permute_node};
use gto_model::{Board, SuitPermutation};
use gto_solve::postflop::{NoProgress, PostflopProblem, StopRule};
use library_builder::extract::{ExtractContext, extract_nodes, permute_runout};
use library_builder::job::BuildInputs;
use library_builder::solve::{EngineSolver, LineJob, LineSolver};
use library_builder::spec::{inputs, load, run_spec};
use library_builder::store::LibraryTarget;

/// Closeness of two solves' frequencies and EVs that differ only by suit labels: the same
/// iterations on a relabelled game, so only floating-point summation order differs.
const FREQUENCY_CLOSE: f64 = 1e-3;
const EV_CLOSE_BB: f64 = 1e-2;

fn tiny_inputs() -> BuildInputs {
    inputs(&load(&fixture("tiny-bb-btn-srp.spec.json")).expect("the spec"), 4).expect("inputs")
}

fn line_job(inputs: &BuildInputs, perm: SuitPermutation, runouts: &[RunoutSpec]) -> LineJob {
    let (line, ranges) = inputs.lines[0].clone();
    let permuted_ranges = ranges.map(|range| {
        let mut weights = vec![0.0_f32; range.weights().len()];
        for combo in gto_model::ComboId::all() {
            let (a, b) = combo.cards();
            let to = gto_model::ComboId::from_cards(perm.apply(a), perm.apply(b)).expect("combo");
            weights[usize::from(u16::from(to))] = range.weight(combo);
        }
        gto_solve::postflop::Range::from_weights(&weights).expect("a range")
    });
    let problem = PostflopProblem::from_line(
        inputs.config.clone(),
        line.clone(),
        Board::flop(perm.apply_flop(inputs.raw_flop)),
        permuted_ranges,
        inputs.tree.clone(),
    )
    .expect("a problem");
    LineJob {
        problem,
        line: line.text(),
        stop: StopRule {
            target_exploitability_pct_pot: 0.0,
            max_iterations: 200,
            max_seconds: 600,
        },
        options: inputs.settings.solve_options(),
        threads: 4,
        runouts: runouts.iter().map(|r| permute_runout(*r, perm)).collect(),
        seed: 7,
    }
}

#[test]
#[ignore = "R2.12: two real flop solves; run once in release at the gate (O-178)"]
fn r2_12_a_suit_permuted_solve_extracts_to_the_permuted_extraction() {
    let inputs = tiny_inputs();
    let runouts = draw_runouts(inputs.raw_flop, 2, 7).expect("two runouts");
    let perm = SuitPermutation::all()[9];
    let base = EngineSolver
        .solve_line(&line_job(&inputs, SuitPermutation::IDENTITY, &runouts), &NoProgress)
        .expect("the base solve");
    let moved = EngineSolver
        .solve_line(&line_job(&inputs, perm, &runouts), &NoProgress)
        .expect("the permuted solve");
    let ctx = |flop, to_raw| ExtractContext {
        config_id: inputs.config.config_id(),
        pair: inputs.pair,
        preflop: inputs.lines[0].0.actions.clone(),
        solved_flop: flop,
        to_raw,
        accuracy_pct_pot: None,
    };
    let expected: Vec<_> =
        extract_nodes(&ctx(inputs.raw_flop, SuitPermutation::IDENTITY), &base.root_nodes)
            .expect("extract")
            .iter()
            .map(|node| permute_node(node, perm).expect("permute"))
            .collect();
    let got = extract_nodes(
        &ctx(perm.apply_flop(inputs.raw_flop), SuitPermutation::IDENTITY),
        &moved.root_nodes,
    )
    .expect("extract");
    assert_eq!(got.len(), expected.len());
    for (a, b) in got.iter().zip(&expected) {
        assert_eq!(a.key, b.key);
        assert_eq!(a.hands.len(), b.hands.len(), "{}", a.key);
        for (x, y) in a.hands.iter().zip(&b.hands) {
            assert_eq!(x.hand, y.hand, "{}", a.key);
            for (f, g) in x.frequencies.iter().zip(&y.frequencies) {
                assert!(
                    (f - g).abs() < FREQUENCY_CLOSE,
                    "{} hand {}: {f} against {g}",
                    a.key,
                    x.hand
                );
            }
            for (e, d) in x.ev_bb.iter().zip(&y.ev_bb) {
                assert!((e - d).abs() < EV_CLOSE_BB, "{} hand {}: {e} against {d}", a.key, x.hand);
            }
        }
    }
    assert_eq!(moved.runout_nodes.len(), base.runout_nodes.len());
}

#[tokio::test]
#[ignore = "R2.17: a real flop solve; run once in release at the gate (O-178)"]
async fn r2_17_the_tiny_spec_stages_a_verified_build_through_the_engine() {
    let dir = tempfile::tempdir().expect("a scratch directory");
    let library = dir.path().join("library");
    let scratch = dir.path().join("scratch");
    std::fs::create_dir_all(&library).expect("library");
    std::fs::create_dir_all(&scratch).expect("scratch");
    let target = LibraryTarget::Fs { root: library };
    let loaded = load(&fixture("tiny-bb-btn-srp.spec.json")).expect("the spec");
    let solver: Arc<dyn LineSolver> = Arc::new(EngineSolver);
    let summary = run_spec(&loaded, &target, solver.as_ref(), &scratch, 4).await.expect("runs");
    assert_eq!(summary.outcome, "staged", "{summary:?}");
    let line = &summary.lines[0];
    assert!(line.gains_pct_pot.iter().all(|g| *g <= 0.3), "{line:?}");
    assert_eq!(line.runout_bytes.len(), 2);
    assert!(summary.peak_rss_bytes > 0);
    let build_id = summary.build_id.expect("a build id");
    let raw = loaded.spec.flop.clone();
    let prefix = format!("builds/cfg_6_online_100/BB-BTN/{raw}/{build_id}");
    target.verify_build(&prefix).await.expect("every file checks");
}
