//! Step 2 of a job (plan section C step 4): solve, check, extract and stage every line on
//! the calling thread, then the manifest. Runs on a blocking thread in the loop and
//! inline in a job-spec run (O-205).
//!
//! The job's flop is canonicalized once (`canonical_flop` gives the raw-to-canonical
//! permutation, so its inverse relabels the solve back to the raw flop); the runouts are
//! drawn once on the canonical flop from the job's seed (O-192), so every line keeps the
//! same runouts. Per line the solver runs, both seats' gains are checked against the
//! target before anything is written (02 section 3.2 step 4), the walk is extracted to
//! library nodes on the raw flop (O-173), and the line's files are written into the
//! staging `FsStore`; the solved line is dropped before the next one starts (memory).

use std::path::Path;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use gto_library::{
    ChunkOptions, FlopBuildMeta, FsStore, LineWritten, MANIFEST_FILE, ManifestConfig, RunoutSpec,
    builds_prefix, draw_runouts, narrow_f32, write_flop_build_manifest, write_line_files,
};
use gto_model::{Board, ConfigId, Flop, GameConfig, SuitPermutation, canonical_flop};
use gto_solve::postflop::{PostflopProblem, ProgressSink, Range, StopReason};
use gto_tree::{PreflopLine, tree_hash_hex};

use super::{BuildInputs, ENGINE_VERSION, LineSummary, StagedBuild, utc_now_rfc3339};
use crate::error::BuilderError;
use crate::extract::{ExtractContext, extract_line};
use crate::notify::BuildProgress;
use crate::solve::{LineJob, LineSolver};

/// The least time between two progress reports of one line (A4 section 4: at most one
/// `build_progress` notify per 10 seconds).
pub const PROGRESS_INTERVAL: Duration = Duration::from_secs(10);

/// What every line of one build shares.
struct BuildFrame {
    /// The canonical flop the solves run on.
    canonical: Flop,
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

/// Solves, checks, extracts and writes one line.
fn stage_line(
    inputs: &BuildInputs,
    solver: &dyn LineSolver,
    store: &mut FsStore,
    frame: &BuildFrame,
    (line, ranges): (&PreflopLine, &[Range; 2]),
    progress: &(dyn Fn(BuildProgress) + Sync),
) -> Result<(LineWritten, LineSummary), BuilderError> {
    let text = line.text();
    let board = Board::new(frame.canonical, None, None)?;
    let problem = PostflopProblem::from_line(
        inputs.config.clone(),
        line.clone(),
        board,
        ranges.clone(),
        inputs.tree.clone(),
    )?;
    let line_job = LineJob {
        problem,
        line: text.clone(),
        stop: inputs.settings.stop_rule(inputs.attempt),
        options: inputs.settings.solve_options(),
        threads: inputs.threads,
        runouts: frame.runouts.clone(),
        seed: inputs.seed,
    };
    let sink = ForwardProgress {
        job_id: &inputs.job_id,
        line: &text,
        forward: progress,
        last_sent: Mutex::new(None),
    };
    let started = Instant::now();
    let walked = solver.solve_line(&line_job, &sink)?;
    let seconds = started.elapsed().as_secs_f64();
    let gains = walked.gains_pct_pot;
    check_target(&text, gains, inputs.settings.target_pct_pot)?;
    let context = ExtractContext {
        config_id: frame.config_id.clone(),
        pair: inputs.pair,
        preflop: line.actions.clone(),
        solved_flop: frame.canonical,
        to_raw: frame.to_raw,
        accuracy_pct_pot: Some(narrow_f32(gains[0].max(gains[1]))),
    };
    let built = extract_line(&context, &text, &frame.tree_hash, inputs.seed, &walked)?;
    let report = walked.report;
    drop(walked);
    let files =
        write_line_files(store, &frame.prefix, inputs.pair, &built, &ChunkOptions::default())?;
    let summary = LineSummary {
        line: text,
        seconds,
        iterations: report.iterations,
        gains_pct_pot: gains,
        stop_reason: stop_reason_text(report.stop_reason).to_owned(),
        estimate_bytes: report.estimate_bytes,
        flop_bytes: files.flop_bytes,
        runout_bytes: files.runout_bytes.clone(),
    };
    Ok((files, summary))
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::{ForwardProgress, check_target};
    use crate::error::BuilderError;
    use crate::notify::BuildProgress;
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
}
