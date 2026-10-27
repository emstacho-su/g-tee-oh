//! Where the spike runs (O-228): the repository root it reads its inputs from, the run
//! context when no git checkout is present, the caller's notes (the container line and
//! the concurrent heavy work), and the labeled 100bb extrapolation.
//!
//! Mechanism. `validate::repo_root` is compiled from the crate's manifest directory, a
//! path that exists only on the machine that built the binary. The spike image therefore
//! sets [`REPO_ROOT_ENV`] to the directory where it placed the two inputs (the equity
//! fixture and the online seed sizing spec), and [`repo_root`] prefers that variable. The
//! image also has no git and no checkout, so the usual commit resolution, which runs
//! `git status`, cannot work there; [`context_without_git`] builds the context from a
//! commit given with `--commit` instead, and records the tree as dirty only when
//! `--allow-dirty` says the build may hold uncommitted changes.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use super::{Hu100, SpikeError, SpikeRun};
use crate::machine::{self, MACHINE_ENV};
use crate::report::{self, Context};

/// The environment variable that overrides the compiled repository root, set by
/// `infra/docker/spike-preflop.Dockerfile` to the directory holding the spike's inputs.
pub const REPO_ROOT_ENV: &str = "VALIDATE_REPO_ROOT";

/// How many times the push/fold figures the extrapolated 100bb figures are: an assumed
/// bound, not a measurement. The minimal 100bb tree has a few dozen decision nodes
/// against push/fold's two per depth and needs more iterations, so its memory and time
/// are taken as one hundred times the whole push/fold run's.
pub const HU100_EXTRAPOLATION_FACTOR: u32 = 100;

/// The environment variable holding the docker run line of the measurement, recorded in
/// the notes (O-228).
pub const CONTAINER_ENV: &str = "SPIKE_CONTAINER";

/// The environment variable saying what other heavy work ran during the measurement
/// (the benchmark lock rule), recorded in the notes.
pub const CONCURRENT_ENV: &str = "SPIKE_CONCURRENT";

/// The docker run flag of the 5 GB container cap (O-48) the run line must carry.
pub const CONTAINER_LIMIT_FLAG: &str = "--memory 5g";

/// True when the recorded run line carries [`CONTAINER_LIMIT_FLAG`].
#[must_use]
pub fn records_container_limit(container: Option<&str>) -> bool {
    container.is_some_and(|line| line.contains(CONTAINER_LIMIT_FLAG))
}

/// The caller's notes of a spike report: the container line, then the concurrent heavy
/// work, each saying "not recorded" when its variable is unset or blank. The second label
/// carries the word "concurrent" whatever the variable holds, since the R2.21 report test
/// looks for it.
#[must_use]
pub fn caller_notes(container: Option<&str>, concurrent: Option<&str>) -> String {
    fn given(value: Option<&str>) -> Option<&str> {
        value.map(str::trim).filter(|v| !v.is_empty())
    }
    let container_line = given(container).map_or_else(
        || format!("Container: not recorded ({CONTAINER_ENV} unset, so no limit is on record)."),
        |line| format!("Container: {line}"),
    );
    let concurrent_line = given(concurrent).map_or_else(
        || format!("Heavy work running concurrently: not recorded ({CONCURRENT_ENV} unset)."),
        |work| format!("Heavy work running concurrently: {work}"),
    );
    format!("{container_line}\n{concurrent_line}")
}

/// The directory the spike reads its inputs from: [`REPO_ROOT_ENV`] when set and not
/// empty, otherwise `validate::repo_root()`.
#[must_use]
pub fn repo_root() -> PathBuf {
    std::env::var_os(REPO_ROOT_ENV)
        .filter(|value| !value.is_empty())
        .map_or_else(crate::repo_root, PathBuf::from)
}

/// True when `root` is a git checkout (a `.git` directory, or the `.git` file of a
/// worktree), so the usual commit resolution applies.
#[must_use]
pub fn is_git_checkout(root: &Path) -> bool {
    root.join(".git").exists()
}

/// The run context outside a git checkout: the machine named by `machine_flag`, the
/// `VALIDATE_MACHINE` variable or the host name, the given `commit`, the date and the
/// toolchain; the tree counts as dirty when `allow_dirty` is set.
///
/// # Errors
///
/// `SpikeError` when the machine name or the commit is malformed, or the machine probe or
/// the clock fails.
pub fn context_without_git(
    machine_flag: Option<&str>,
    commit: &str,
    allow_dirty: bool,
) -> Result<Context, SpikeError> {
    let error = |what: &str, cause: &dyn std::fmt::Display| {
        SpikeError::new(format!("run context without git: {what}: {cause}"))
    };
    let env = std::env::var(MACHINE_ENV).ok();
    let name = machine::machine_name(machine_flag, env.as_deref(), machine::host_name)
        .map_err(|e| error("machine name", &e))?;
    let machine = machine::detect(&name).map_err(|e| error("machine", &e))?;
    machine::check_commit(commit).map_err(|e| error("commit", &e))?;
    let date = report::iso_8601_utc(SystemTime::now()).map_err(|e| error("date", &e))?;
    Ok(Context {
        machine,
        commit: commit.to_owned(),
        date,
        toolchain: machine::rustc_version().to_owned(),
        tree_dirty: allow_dirty,
    })
}

/// The not-measured 100bb part with its labeled extrapolation from the push/fold run, used
/// when the 100bb run errored: peak bytes and seconds are the push/fold figures times
/// [`HU100_EXTRAPOLATION_FACTOR`], and `reason` says why nothing was measured. The report
/// fails on it and records the figures as informational only (O-49).
#[must_use]
pub fn extrapolate_hu100(push_fold: &SpikeRun, reason: &str) -> Hu100 {
    let factor = HU100_EXTRAPOLATION_FACTOR;
    Hu100::NotMeasured {
        reason: format!(
            "{reason}; the figures are the push/fold peak and seconds times {factor}, an \
             assumed bound and not a measurement"
        ),
        peak_bytes: push_fold.peak.judged().map(|bytes| bytes.saturating_mul(u64::from(factor))),
        seconds: push_fold.seconds * f64::from(factor),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        Hu100, caller_notes, context_without_git, extrapolate_hu100, is_git_checkout,
        records_container_limit,
    };
    use crate::spike::{PeakBytes, SpikeRun};

    #[test]
    fn r2_21_caller_notes_record_the_container_and_the_concurrent_work() {
        let line = "docker run --rm --memory 5g --memory-swap 5g g-tee-oh/spike-preflop:dev";
        let notes = caller_notes(Some(line), Some("none"));
        assert_eq!(notes, format!("Container: {line}\nHeavy work running concurrently: none"));
        assert!(records_container_limit(Some(line)));
        let unset = caller_notes(None, Some("  "));
        assert!(unset.contains("not recorded") && unset.contains("concurrent"), "{unset}");
        assert!(!unset.contains("--memory 5g"), "an unset line must not look like a 5g run");
        assert!(!records_container_limit(None));
        assert!(!records_container_limit(Some("docker run --memory 8g")));
    }

    #[test]
    fn r2_21_extrapolation_scales_and_labels_the_push_fold_figures() {
        let push_fold = SpikeRun {
            label: "push/fold".to_owned(),
            seconds: 2.0,
            iterations: 1,
            gain: 0.0,
            peak: PeakBytes { accounted: Some(5), vm_hwm: Some(7), cgroup_peak: None },
        };
        let Hu100::NotMeasured { reason, peak_bytes, seconds } =
            extrapolate_hu100(&push_fold, "the solve failed")
        else {
            panic!("an extrapolation");
        };
        assert_eq!(peak_bytes, Some(700));
        assert!((seconds - 200.0).abs() < f64::EPSILON);
        assert!(reason.starts_with("the solve failed") && reason.contains("not a measurement"));
    }

    #[test]
    fn r2_21_the_repository_is_a_checkout_and_a_bare_directory_is_not() {
        assert!(is_git_checkout(&crate::repo_root()));
        assert!(!is_git_checkout(std::path::Path::new("no-such-directory")));
    }

    #[test]
    fn r2_21_a_context_without_git_checks_the_commit() {
        assert!(context_without_git(Some("dryrun"), "not-a-sha", false).is_err());
        let commit = "0123456789abcdef0123456789abcdef01234567";
        let context = context_without_git(Some("dryrun"), commit, true).expect("a context");
        assert_eq!(context.commit, commit);
        assert!(context.tree_dirty);
        assert_eq!(context.machine.name, "dryrun");
    }
}
