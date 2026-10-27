//! The preflop spike (R2.21, O-48, O-49, O-80, O-227, O-228): seconds and peak bytes of
//! the push/fold solves and of a minimal heads-up 100bb P2 run, judged against the O-80
//! rule (push/fold peak under 5 GiB with the G6a certificate holding) and the O-49 rule
//! (100bb peak under 4 GiB and the in-abstraction target in under 12 hours).
//!
//! Peak bytes are read three ways and all recorded (O-228): the allocator's accounted
//! peak, the process `VmHWM` from `/proc/self/status`, and the container's cgroup
//! memory.peak; the judged figure is the largest that is available, and a run with no
//! reading at all fails its peak judge rather than counting as 0 bytes. The report id is
//! `spike-preflop-<machine>`, so the Zenbook writes spike-preflop-zenbook (O-87) and S20
//! writes spike-preflop-mac.
//!
//! The work is split by concern: `memory` holds the global allocator and the three
//! readings, `runs` the two measured runs, `judge` the report and its verdicts, and
//! `host` what the container needs (the repository root override, the run context
//! without git, the caller's notes, and the labeled 100bb extrapolation). The accounting
//! allocator is behind the crate's `peak-alloc` feature, off by default so the gates run
//! on the system allocator; the spike image builds with it, and so does the test run of
//! `tests/spike.rs` that needs the reading, since off Linux the accounted figure is the
//! only one. The allocator lives in this library rather than in `main.rs`, so the crate's
//! test binaries built with the feature account their peak too.

use std::fmt;
use std::path::Path;

use gto_solve::equity::EquityTable;

mod host;
mod judge;
mod memory;
mod runs;

pub use host::{
    CONCURRENT_ENV, CONTAINER_ENV, CONTAINER_LIMIT_FLAG, HU100_EXTRAPOLATION_FACTOR, REPO_ROOT_ENV,
    caller_notes, context_without_git, extrapolate_hu100, is_git_checkout, records_container_limit,
    repo_root,
};
pub use judge::report;
pub use runs::{
    HU100_CHECK_EVERY, HU100_DEPTH_BB, HU100_MAX_ITERATIONS,
    SEED_ONLINE_SPEC_RELATIVE_TO_REPO_ROOT, run_hu100_at, run_push_fold,
};

/// The report id prefix; the machine name follows it.
pub const REPORT_PREFIX: &str = "spike-preflop";

/// The requirement this report closes.
pub const R_ID: &str = "R2.21";

/// The Docker memory limit the spike runs under, in bytes (5 GiB, `--memory 5g`, O-48).
pub const CONTAINER_LIMIT_BYTES: u64 = 5 * 1024 * 1024 * 1024;

/// O-80: push/fold peak bytes must stay under this.
pub const PUSH_FOLD_LIMIT_BYTES: u64 = CONTAINER_LIMIT_BYTES;

/// O-49: the 100bb run's peak bytes must stay under this (4 GiB).
pub const HU100_LIMIT_BYTES: u64 = 4 * 1024 * 1024 * 1024;

/// O-49: the 100bb run must reach its target in under this many seconds (12 hours).
pub const HU100_LIMIT_SECONDS: f64 = 12.0 * 3600.0;

/// O-227: the 100bb run's target, each seat's gain in percent of the starting pot.
pub const HU100_TARGET_PCT_POT: f64 = 0.3;

/// Measurement ids of the report, fixed so the R2.21 schema test and S20 read them.
pub mod ids {
    /// Push/fold wall seconds over all depths (informational, O-80).
    pub const PUSH_FOLD_SECONDS: &str = "push-fold/seconds";
    /// Push/fold judged peak bytes (O-80).
    pub const PUSH_FOLD_PEAK_BYTES: &str = "push-fold/peak-bytes";
    /// The largest certificate gain over the depths, in big blinds (O-80, O-223).
    pub const PUSH_FOLD_CERTIFICATE: &str = "push-fold/certificate-gain";
    /// The 100bb run's judged peak bytes (O-49).
    pub const HU100_PEAK_BYTES: &str = "hu100/peak-bytes";
    /// The 100bb run's seconds to target (O-49).
    pub const HU100_SECONDS: &str = "hu100/seconds";
    /// The 100bb run's larger seat gain at the stop, in percent of the starting pot.
    pub const HU100_GAIN: &str = "hu100/gain-pct-pot";
    /// Present only when the 100bb run errored: 0 runs measured, judged against at least
    /// 1, so the report fails (O-49).
    pub const HU100_MEASURED: &str = "hu100/measured";
}

/// True when this build accounts its heap peak: validate built with the `peak-alloc`
/// feature, as the spike image and `just spike-preflop` build it (O-228).
pub const ACCOUNTED_PEAK_AVAILABLE: bool = cfg!(feature = "peak-alloc");

/// The three peak readings in bytes; an absent reading is `None`, never 0.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PeakBytes {
    /// The allocator's accounted peak, when validate is built with `peak-alloc`.
    pub accounted: Option<u64>,
    /// `VmHWM` from `/proc/self/status`, when readable (Linux).
    pub vm_hwm: Option<u64>,
    /// The cgroup's memory.peak, when readable (inside a container).
    pub cgroup_peak: Option<u64>,
}

impl PeakBytes {
    /// The judged figure: the largest available reading, `None` when there is none. A
    /// judge fails a run with no reading instead of reading it as 0 bytes.
    #[must_use]
    pub fn judged(&self) -> Option<u64> {
        [self.accounted, self.vm_hwm, self.cgroup_peak].into_iter().flatten().max()
    }
}

/// One measured run.
#[derive(Debug, Clone, PartialEq)]
pub struct SpikeRun {
    /// What ran.
    pub label: String,
    /// Wall seconds.
    pub seconds: f64,
    /// Iterations run (summed over depths for push/fold).
    pub iterations: u64,
    /// The larger seat gain at the stop: big blinds for push/fold, percent of the pot
    /// for 100bb.
    pub gain: f64,
    /// Peak bytes.
    pub peak: PeakBytes,
}

/// The 100bb part: measured, or not measured with a labeled extrapolation (O-49).
#[derive(Debug, Clone, PartialEq)]
pub enum Hu100 {
    /// The minimal P2 run was measured.
    Measured(SpikeRun),
    /// The run errored, so nothing was measured and the report fails; the figures are
    /// extrapolated from push/fold and recorded as informational only.
    NotMeasured {
        /// Why it was not measured: the run's error.
        reason: String,
        /// The extrapolated peak bytes, `None` when push/fold had no peak reading.
        peak_bytes: Option<u64>,
        /// The extrapolated seconds.
        seconds: f64,
    },
}

/// Why the spike could not run.
#[derive(Debug)]
pub struct SpikeError {
    message: String,
}

impl SpikeError {
    /// An error with `message`.
    #[must_use]
    pub fn new(message: impl Into<String>) -> Self {
        SpikeError { message: message.into() }
    }
}

impl fmt::Display for SpikeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for SpikeError {}

/// The 100bb part of the report, reading the sizing spec under `repo_root`: the measured
/// run, or, when the run errors, [`Hu100::NotMeasured`] carrying the error and the
/// labeled extrapolation from `push_fold`. A not-measured part fails the report (O-49);
/// the extrapolation is never a pass.
#[must_use]
pub fn measure_hu100(equity: &EquityTable, repo_root: &Path, push_fold: &SpikeRun) -> Hu100 {
    run_hu100_at(equity, repo_root).map_or_else(
        |error| extrapolate_hu100(push_fold, &format!("the 100bb run failed: {error}")),
        Hu100::Measured,
    )
}
