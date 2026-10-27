//! Step 2 of a job (plan section C step 4): solve, check, extract and stage every line on
//! the calling thread, then the manifest. Runs on a blocking thread in the loop and
//! inline in a job-spec run (O-205).
//!
//! The job's flop is canonicalized once (`canonical_flop` gives the raw-to-canonical
//! permutation, which moves each line's ranges onto the canonical labels before the solve,
//! and its inverse relabels the solve back to the raw flop); the runouts are drawn once on
//! the canonical flop from the job's seed (O-192), so every line keeps the same runouts.
//! Per line the solver runs and hands its walk to the line's `StageWalk` (`walk`): both
//! seats' gains are checked against the target before anything is written (02 section
//! 3.2 step 4), then the root street becomes the flop file and each runout, as it is
//! walked, is extracted to library nodes on the raw flop (O-173), written into the staging
//! `FsStore` and dropped before the next runout is walked. Beside the solved game a line
//! therefore holds at most one runout, and the solved game is dropped before the next line
//! starts (memory, O-187).

use std::path::Path;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use gto_library::{
    FlopBuildMeta, FsStore, LineWritten, MANIFEST_FILE, ManifestConfig, RunoutSpec, builds_prefix,
    draw_runouts, write_flop_build_manifest,
};
use gto_model::{Board, ConfigId, Flop, GameConfig, SuitPermutation, canonical_flop};
use gto_solve::postflop::{PostflopProblem, ProgressSink, Range, StopReason};
use gto_tree::{PreflopLine, tree_hash_hex};

use super::{BuildInputs, ENGINE_VERSION, LineSummary, StagedBuild, utc_now_rfc3339};
use crate::error::BuilderError;
use crate::extract::{ExtractContext, permute_range};
use crate::notify::BuildProgress;
use crate::solve::{LineJob, LineSolver};

mod walk;

use self::walk::{LinePlace, StageWalk};

/// The least time between two progress reports of one line (A4 section 4: at most one
/// `build_progress` notify per 10 seconds).
pub const PROGRESS_INTERVAL: Duration = Duration::from_secs(10);

/// What every line of one build shares.
struct BuildFrame {
    /// The canonical flop the solves run on.
    canonical: Flop,
    /// The job's raw labels to the canonical labels, for the ranges.
    to_canonical: SuitPermutation,
    /// Canonical labels to the job's raw labels.
    to_raw: SuitPermutation,
    /// The runouts on the canonical flop.
    runouts: Vec<RunoutSpec>,
    /// The configuration id the keys carry.
    config_id: ConfigId,
    /// The build's prefix.
    prefix: String,
    /// The tree hash as hexadecimal.
    tree_hash: String,
}

/// Forwards a solve's progress, at most once per [`PROGRESS_INTERVAL`].
struct ForwardProgress<'a> {
    job_id: &'a str,
    line: &'a str,
    forward: &'a (dyn Fn(BuildProgress) + Sync),
    last_sent: Mutex<Option<Instant>>,
}

impl ProgressSink for ForwardProgress<'_> {
    fn report(&self, iteration: u32, exploitability_pct_pot: Option<[f32; 2]>) {
        let now = Instant::now();
        let due = {
            let mut last = self.last_sent.lock().unwrap_or_else(PoisonError::into_inner);
            let due = last.is_none_or(|sent| now.duration_since(sent) >= PROGRESS_INTERVAL);
            if due {
                *last = Some(now);
            }
            due
        };
        if due {
            (self.forward)(BuildProgress {
                job_id: self.job_id.to_owned(),
                line: self.line.to_owned(),
                iteration,
                exploitability: exploitability_pct_pot,
            });
        }
    }
}

/// The manifest's configuration block of `config`.
#[must_use]
pub fn manifest_config(config: &GameConfig) -> ManifestConfig {
    ManifestConfig {
        format: config.format,
        table_size: config.table_size,
        stake: config.stake.label.clone(),
        depth_cbb: config.depth_cbb,
        straddle: config.straddle,
        ante_cbb: config.ante_cbb,
    }
}

/// Solves, extracts and stages every line, then the manifest (step 2).
///
/// # Errors
///
/// `BuilderError::OverMemoryCap`, `BuilderError::AboveTarget`, and the solve, extract and
/// library errors.
pub fn stage_build(
    inputs: &BuildInputs,
    solver: &dyn LineSolver,
    staging_root: &Path,
    progress: &(dyn Fn(BuildProgress) + Sync),
) -> Result<StagedBuild, BuilderError> {
    let (canonical, raw_to_canonical) = canonical_flop(inputs.raw_flop);
    let config_id = inputs.config.config_id();
    let frame = BuildFrame {
        canonical,
        to_canonical: raw_to_canonical,
        to_raw: raw_to_canonical.inverse(),
        runouts: draw_runouts(canonical, inputs.k_runouts, inputs.seed)?,
        prefix: builds_prefix(&config_id, inputs.pair, inputs.raw_flop, &inputs.build_id),
        config_id,
        tree_hash: tree_hash_hex(&inputs.tree),
    };
    std::fs::create_dir_all(staging_root).map_err(|err| BuilderError::io(staging_root, err))?;
    let mut store = FsStore::new(staging_root)?;
    let mut written = Vec::with_capacity(inputs.lines.len());
    let mut lines = Vec::with_capacity(inputs.lines.len());
    for (line, ranges) in &inputs.lines {
        let (files, summary) =
            stage_line(inputs, solver, &mut store, &frame, (line, ranges), progress)?;
        written.push(files);
        lines.push(summary);
    }
    let meta = FlopBuildMeta {
        id: inputs.build_id.clone(),
        engine_version: ENGINE_VERSION.to_owned(),
        config: manifest_config(&inputs.config),
        config_id: frame.config_id.clone(),
        pair: inputs.pair,
        flop: inputs.raw_flop,
        tree_hash: frame.tree_hash.clone(),
        seed: inputs.seed,
        synthetic: inputs.synthetic,
        created_at: utc_now_rfc3339(),
    };
    let manifest = write_flop_build_manifest(&mut store, &frame.prefix, &meta, &written)?;
    let manifest_file = staging_root.join(&frame.prefix).join(MANIFEST_FILE);
    let manifest_bytes = std::fs::metadata(&manifest_file)
        .map_err(|err| BuilderError::io(&manifest_file, err))?
        .len();
    Ok(StagedBuild {
        prefix: frame.prefix,
        manifest,
        bytes: lines.iter().map(line_bytes).fold(manifest_bytes, u64::saturating_add),
        max_gains_pct_pot: max_gains(&lines),
        lines,
    })
}

/// The bytes a line's files take.
fn line_bytes(line: &LineSummary) -> u64 {
    line.runout_bytes.iter().fold(line.flop_bytes, |sum, bytes| sum.saturating_add(*bytes))
}

/// Per seat, the largest gain over the lines.
fn max_gains(lines: &[LineSummary]) -> [f64; 2] {
    lines.iter().fold([0.0, 0.0], |max, line| {
        [max[0].max(line.gains_pct_pot[0]), max[1].max(line.gains_pct_pot[1])]
    })
}

/// Fails with `AboveTarget` when either seat's gain is above the target (or not a number).
fn check_target(line: &str, gains: [f64; 2], target_pct_pot: f32) -> Result<(), BuilderError> {
    let target = f64::from(target_pct_pot);
    if gains.iter().any(|gain| gain.is_nan() || *gain > target) {
        return Err(BuilderError::AboveTarget {
            line: line.to_owned(),
            gains_pct_pot: gains,
            target_pct_pot,
        });
    }
    Ok(())
}

/// The stop reason as the summary writes it.
fn stop_reason_text(reason: StopReason) -> &'static str {
    match reason {
        StopReason::Target => "target",
        StopReason::MaxIterations => "max_iterations",
        StopReason::MaxSeconds => "max_seconds",
    }
}

/// The line's job: the problem on the canonical flop, with the line's ranges moved from
/// the raw flop's labels to the canonical flop's (A2 section 3), so a suit-specific range
/// is solved on the cards it names.
fn line_job(
    inputs: &BuildInputs,
    frame: &BuildFrame,
    line: &PreflopLine,
    ranges: &[Range; 2],
) -> Result<LineJob, BuilderError> {
    let canonical_ranges = [
        permute_range(&ranges[0], frame.to_canonical)?,
        permute_range(&ranges[1], frame.to_canonical)?,
    ];
    let problem = PostflopProblem::from_line(
        inputs.config.clone(),
        line.clone(),
        Board::new(frame.canonical, None, None)?,
        canonical_ranges,
        inputs.tree.clone(),
    )?;
    Ok(LineJob {
        problem,
        line: line.text(),
        stop: inputs.settings.stop_rule(inputs.attempt),
        options: inputs.settings.solve_options(),
        threads: inputs.threads,
        runouts: frame.runouts.clone(),
        seed: inputs.seed,
    })
}

/// Solves one line and hands its walk to a [`StageWalk`], which checks the target and
/// writes the flop file and then each runout's file as it is walked.
fn stage_line(
    inputs: &BuildInputs,
    solver: &dyn LineSolver,
    store: &mut FsStore,
    frame: &BuildFrame,
    (line, ranges): (&PreflopLine, &[Range; 2]),
    progress: &(dyn Fn(BuildProgress) + Sync),
) -> Result<(LineWritten, LineSummary), BuilderError> {
    let line_job = line_job(inputs, frame, line, ranges)?;
    let text = line_job.line.clone();
    let sink = ForwardProgress {
        job_id: &inputs.job_id,
        line: &text,
        forward: progress,
        last_sent: Mutex::new(None),
    };
    let context = ExtractContext {
        config_id: frame.config_id.clone(),
        pair: inputs.pair,
        preflop: line.actions.clone(),
        solved_flop: frame.canonical,
        to_raw: frame.to_raw,
        accuracy_pct_pot: None,
    };
    let place = LinePlace {
        prefix: &frame.prefix,
        pair: inputs.pair,
        line: &text,
        tree_hash: &frame.tree_hash,
        seed: inputs.seed,
        target_pct_pot: inputs.settings.target_pct_pot,
        heartbeat: &sink,
    };
    let mut walk = StageWalk::new(store, place, context);
    let started = Instant::now();
    solver.solve_line(&line_job, &sink, &mut walk)?;
    let seconds = started.elapsed().as_secs_f64();
    let walked = walk.finish(frame.runouts.len())?;
    let summary = LineSummary {
        line: text.clone(),
        seconds,
        iterations: walked.report.iterations,
        gains_pct_pot: walked.gains_pct_pot,
        stop_reason: stop_reason_text(walked.report.stop_reason).to_owned(),
        estimate_bytes: walked.report.estimate_bytes,
        flop_bytes: walked.written.flop_bytes,
        runout_bytes: walked.written.runout_bytes.clone(),
    };
    Ok((walked.written, summary))
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use std::path::{Path, PathBuf};

    use gto_library::RunoutSpec;
    use gto_solve::postflop::NodeStrategy;

    use super::{BuildInputs, ForwardProgress, check_target, stage_build};
    use crate::error::BuilderError;
    use crate::notify::BuildProgress;
    use crate::solve::{FakeSolver, LineJob, LineSolver, LineWalk, SolvedLine};
    use crate::spec::{inputs, load};
    use gto_solve::postflop::ProgressSink;

    #[test]
    fn r2_17_progress_is_forwarded_at_most_once_per_interval() {
        let seen = Mutex::new(Vec::<BuildProgress>::new());
        let forward = |p: BuildProgress| seen.lock().expect("lock").push(p);
        let sink = ForwardProgress {
            job_id: "job",
            line: "r250.c",
            forward: &forward,
            last_sent: Mutex::new(None),
        };
        for iteration in 1..=100 {
            sink.report(iteration, Some([1.0, 2.0]));
        }
        let seen = seen.into_inner().expect("lock");
        assert_eq!(seen.len(), 1, "one report inside ten seconds");
        assert_eq!(seen[0].iteration, 1);
        assert_eq!(seen[0].job_id, "job");
    }

    #[test]
    fn r2_17_either_seat_above_the_target_fails_the_line() {
        assert!(check_target("l", [0.1, 0.3], 0.3).is_ok());
        let above = check_target("l", [0.1, 0.31], 0.3);
        assert!(matches!(above, Err(BuilderError::AboveTarget { .. })), "{above:?}");
        assert!(check_target("l", [f64::NAN, 0.0], 0.3).is_err(), "not a number fails");
    }

    /// The files under `dir` whose path runs through a `runouts` directory.
    fn runout_files(dir: &Path) -> usize {
        let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
        entries
            .flatten()
            .map(|entry| entry.path())
            .map(|path| {
                if path.is_dir() {
                    runout_files(&path)
                } else {
                    usize::from(path.components().any(|part| part.as_os_str() == "runouts"))
                }
            })
            .sum()
    }

    /// A walk that checks, at every runout handed over, that each earlier runout's file is
    /// already on disk, and that this runout's file is written before the solver goes on.
    struct Watch<'a> {
        inner: &'a mut dyn LineWalk,
        staging: &'a Path,
        handed: usize,
    }

    impl LineWalk for Watch<'_> {
        fn root(&mut self, solved: SolvedLine) -> Result<(), BuilderError> {
            self.inner.root(solved)
        }

        fn runout(
            &mut self,
            runout: RunoutSpec,
            nodes: Vec<NodeStrategy>,
        ) -> Result<(), BuilderError> {
            assert_eq!(runout_files(self.staging), self.handed, "earlier runouts are on disk");
            self.inner.runout(runout, nodes)?;
            self.handed += 1;
            assert_eq!(runout_files(self.staging), self.handed, "{runout} is written at once");
            Ok(())
        }
    }

    /// The fake solver behind a [`Watch`].
    struct Watching {
        staging: PathBuf,
    }

    impl LineSolver for Watching {
        fn solve_line(
            &self,
            job: &LineJob,
            sink: &dyn ProgressSink,
            walk: &mut dyn LineWalk,
        ) -> Result<(), BuilderError> {
            let mut watch = Watch { inner: walk, staging: &self.staging, handed: 0 };
            FakeSolver::converging([0.1, 0.2]).solve_line(job, sink, &mut watch)?;
            assert_eq!(watch.handed, job.runouts.len());
            Ok(())
        }
    }

    /// R2.17: each runout is extracted and written before the solver walks the next one,
    /// so a line never holds more than one walked runout.
    #[test]
    fn r2_17_each_runout_is_written_before_the_next_is_walked() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../validation/fixtures/builder/tiny-bb-btn-srp.spec.json");
        let spec = load(&fixture).expect("the tiny spec");
        let inputs = BuildInputs { k_runouts: 4, ..inputs(&spec, 1).expect("inputs") };
        let dir = tempfile::tempdir().expect("a scratch directory");
        let solver = Watching { staging: dir.path().to_path_buf() };
        let staged = stage_build(&inputs, &solver, dir.path(), &|_| {}).expect("stages");
        assert_eq!(staged.lines[0].runout_bytes.len(), 4);
        assert_eq!(runout_files(dir.path()), 4);
    }

    /// R2.17: a line whose gain is above the target writes nothing, not even its flop file.
    #[test]
    fn r2_17_a_line_above_the_target_writes_no_file() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../validation/fixtures/builder/tiny-bb-btn-srp.spec.json");
        let inputs = inputs(&load(&fixture).expect("the tiny spec"), 1).expect("inputs");
        let dir = tempfile::tempdir().expect("a scratch directory");
        let above = FakeSolver::converging([0.1, 5.0]);
        let result = stage_build(&inputs, &above, dir.path(), &|_| {});
        assert!(matches!(result, Err(BuilderError::AboveTarget { .. })), "{result:?}");
        let mut files = Vec::new();
        let mut stack = vec![dir.path().to_path_buf()];
        while let Some(next) = stack.pop() {
            for entry in std::fs::read_dir(&next).expect("a directory").flatten() {
                if entry.path().is_dir() {
                    stack.push(entry.path());
                } else {
                    files.push(entry.path());
                }
            }
        }
        assert!(files.is_empty(), "{files:?}");
    }
}
