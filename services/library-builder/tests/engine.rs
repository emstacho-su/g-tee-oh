//! Real solves through the vendored engine (R2.12, R2.17, O-178): ignored in continuous
//! integration and run once at the gate in release, where the ten-combo spot solves in
//! seconds:
//!
//! ```text
//! cargo test --release -p library-builder --test engine -- --ignored
//! ```

mod common;

use std::sync::{Arc, Mutex};

use common::fixture;
use gto_library::{RunoutSpec, draw_runouts, permute_node};
use gto_model::{Board, SuitPermutation, canonical_flop, is_canonical_flop};
use gto_solve::postflop::{NoProgress, NodeStrategy, PostflopProblem, ProgressSink, StopRule};
use library_builder::error::BuilderError;
use library_builder::extract::{ExtractContext, extract_nodes, permute_range, permute_runout};
use library_builder::job::{BuildInputs, stage_build};
use library_builder::solve::{
    CollectWalk, EngineSolver, LineJob, LineSolver, LineWalk, SolvedLine,
};
use library_builder::spec::{inputs, load, run_spec};
use library_builder::store::LibraryTarget;

/// Closeness of two solves that differ only by suit labels. Relabelling reorders the combos,
/// so the floating-point sums run in another order and the two solves drift apart as the
/// iterations grow (S18 measured 1.7e-4 in frequency and 6e-3 bb in EV at 5 iterations,
/// 0.1 and 5 bb at 20). The test therefore compares at 5 iterations, early enough to be
/// tight and late enough that strategies are no longer uniform, so a mislabelled combo or
/// card shows.
const FREQUENCY_CLOSE: f64 = 1e-3;
const EV_CLOSE_BB: f64 = 1e-2;

/// The iterations of each symmetry solve (see the tolerances above).
const SYMMETRY_ITERATIONS: u32 = 5;

fn tiny_inputs() -> BuildInputs {
    inputs(&load(&fixture("tiny-bb-btn-srp.spec.json")).expect("the spec"), 4).expect("inputs")
}

/// One real solve of `job`, its walk collected.
fn solve(job: &LineJob) -> (SolvedLine, Vec<(RunoutSpec, Vec<NodeStrategy>)>) {
    let mut walk = CollectWalk::default();
    EngineSolver.solve_line(job, &NoProgress, &mut walk).expect("the solve");
    (walk.head.expect("the root was walked"), walk.runouts)
}

fn line_job(inputs: &BuildInputs, perm: SuitPermutation, runouts: &[RunoutSpec]) -> LineJob {
    let (line, ranges) = inputs.lines[0].clone();
    let permuted_ranges = ranges.map(|range| permute_range(&range, perm).expect("a range"));
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
            max_iterations: SYMMETRY_ITERATIONS,
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
    let (base, base_runouts) = solve(&line_job(&inputs, SuitPermutation::IDENTITY, &runouts));
    let (moved, moved_runouts) = solve(&line_job(&inputs, perm, &runouts));
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
    assert_eq!(moved_runouts.len(), base_runouts.len());
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
    assert_eq!(summary.memory.judged_peak_bytes.is_some(), cfg!(target_os = "linux"));
    let build_id = summary.build_id.expect("a build id");
    let raw = loaded.spec.flop.clone();
    let prefix = format!("builds/cfg_6_online_100/BB-BTN/{raw}/{build_id}");
    target.verify_build(&prefix).await.expect("every file checks");
}

/// A solver that runs the engine and keeps a copy of every walk it hands on, so a test can
/// compare what two jobs solved.
#[derive(Default)]
struct Recording {
    walks: Mutex<Vec<CollectWalk>>,
}

/// A walk that passes every piece on and keeps a copy.
struct Tee<'a> {
    inner: &'a mut dyn LineWalk,
    copy: CollectWalk,
}

impl LineWalk for Tee<'_> {
    fn root(&mut self, solved: SolvedLine) -> Result<(), BuilderError> {
        self.copy.root(solved.clone())?;
        self.inner.root(solved)
    }

    fn runout(&mut self, runout: RunoutSpec, nodes: Vec<NodeStrategy>) -> Result<(), BuilderError> {
        self.copy.runout(runout, nodes.clone())?;
        self.inner.runout(runout, nodes)
    }
}

impl LineSolver for Recording {
    fn solve_line(
        &self,
        job: &LineJob,
        sink: &dyn ProgressSink,
        walk: &mut dyn LineWalk,
    ) -> Result<(), BuilderError> {
        let mut tee = Tee { inner: walk, copy: CollectWalk::default() };
        EngineSolver.solve_line(job, sink, &mut tee)?;
        self.walks.lock().expect("the walks").push(tee.copy);
        Ok(())
    }
}

/// R2.12: a job on a non-canonical raw flop with the tiny spec's suit-specific ranges
/// solves exactly the problem of the same spot named on the canonical flop: both jobs map
/// their ranges onto the canonical labels, so the two real solves walk equal trees.
#[test]
#[ignore = "R2.12: two real flop solves; run once in release at the gate (O-178)"]
fn r2_12_a_raw_flop_job_solves_the_canonical_problem_through_the_engine() {
    let base = tiny_inputs();
    let (canonical, to_canonical) = canonical_flop(base.raw_flop);
    let perm = SuitPermutation::all()
        .into_iter()
        .find(|perm| !is_canonical_flop(perm.apply_flop(canonical)))
        .expect("a permutation that leaves the canonical flop");
    let relabel = |inputs: &BuildInputs, flop, perm| BuildInputs {
        raw_flop: flop,
        lines: inputs
            .lines
            .iter()
            .map(|(line, ranges)| {
                (line.clone(), ranges.clone().map(|r| permute_range(&r, perm).expect("a range")))
            })
            .collect(),
        ..inputs.clone()
    };
    let canonical_job = relabel(&base, canonical, to_canonical);
    let raw_job = relabel(&canonical_job, perm.apply_flop(canonical), perm);
    let dir = tempfile::tempdir().expect("a scratch directory");
    let solver = Recording::default();
    for (name, job) in [("canonical", &canonical_job), ("raw", &raw_job)] {
        stage_build(job, &solver, &dir.path().join(name), &|_| {}).expect("the build stages");
    }
    let walks = solver.walks.into_inner().expect("the walks");
    assert_eq!(walks.len(), 2);
    let heads = walks.iter().map(|walk| walk.head.as_ref().expect("a head")).collect::<Vec<_>>();
    assert_eq!(heads[0].root_nodes, heads[1].root_nodes, "the root street differs");
    assert_eq!(walks[0].runouts, walks[1].runouts, "a runout differs");
}
