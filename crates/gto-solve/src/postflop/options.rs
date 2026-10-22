//! What a heads-up postflop solve is told and what it reports (R2.10, O-138, O-139): the
//! stop rule, the entry storage, the options, the progress sink and the report. The solve
//! itself is in `solve`.

use postflop_engine::cfr::StorageMode;

use super::error::SolveError;

/// The default memory cap: 5 GiB, Docker's `5g` limit that stands in for the 5 GB of the
/// target Mac (O-20, O-48).
pub const DEFAULT_MEMORY_CAP_BYTES: u64 = 5 * 1024 * 1024 * 1024;

/// Iterations between exploitability measurements by default (O-138).
pub const DEFAULT_MEASURE_EVERY: u32 = 10;

/// When to stop.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StopRule {
    /// Stop once both players' gain is at or below this percent of the starting pot.
    pub target_exploitability_pct_pot: f32,
    /// The most iterations to run. Zero builds the game and measures the uniform profile.
    pub max_iterations: u32,
    /// The most wall-clock seconds to iterate, checked after every iteration.
    pub max_seconds: u32,
}

impl StopRule {
    pub(crate) fn validate(self) -> Result<(), SolveError> {
        let target = self.target_exploitability_pct_pot;
        if !(target.is_finite() && target >= 0.0) {
            return Err(SolveError::Problem(format!(
                "the target {target} is not a finite percent at or above 0"
            )));
        }
        if self.max_seconds == 0 {
            return Err(SolveError::Problem("max_seconds must be at least 1".to_owned()));
        }
        Ok(())
    }
}

/// How the solver stores its regret and strategy entries. 32-bit is the default (O-194).
///
/// 16-bit storage has a floor: the engine re-quantizes each node region against its
/// growing maximum on every write, so once the DCFR sums have grown, an increment below
/// half a quantum is lost and the profile stops moving. Measured on the G4 turn spot
/// turn-01-dry-ace, the per-seat gains bottomed near 0.12 percent of the pot around
/// iteration 300 and climbed back to 0.37 by iteration 10,000, while 32-bit storage met
/// the 0.1 target at iteration 240 and reached 0.0002 at 10,000 (O-194). So `Sixteen` is
/// an explicit opt-in for memory: never pair it with a stop target under about 0.5
/// percent of the pot or with a long run, since past the floor more iterations make the
/// profile worse, not better.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum StorageBits {
    /// An `i16` per entry and an `f32` scale per node, about half the bytes of 32-bit;
    /// an opt-in with the floor stated above (O-194).
    Sixteen,
    /// An `f32` per entry: the default, and the only storage for a target under about
    /// 0.5 percent of the pot (O-194).
    #[default]
    ThirtyTwo,
}

impl StorageBits {
    pub(crate) fn mode(self) -> StorageMode {
        match self {
            StorageBits::Sixteen => StorageMode::I16,
            StorageBits::ThirtyTwo => StorageMode::F32,
        }
    }
}

/// Solve options beyond the stop rule. The default is 32-bit storage, the 5 GiB cap and a
/// measurement every 10 iterations. A caller that opts into 16-bit storage to halve the
/// storage term takes on the floor `StorageBits` states: a stop target no tighter than
/// about 0.5 percent of the pot and no long run (O-194).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SolveOptions {
    /// Entry storage, 32-bit by default (O-194).
    pub storage: StorageBits,
    /// The most bytes the estimate may come to before the solve is refused.
    pub memory_cap_bytes: u64,
    /// Iterations between exploitability measurements; at least 1.
    pub measure_every: u32,
}

impl Default for SolveOptions {
    fn default() -> Self {
        SolveOptions {
            storage: StorageBits::default(),
            memory_cap_bytes: DEFAULT_MEMORY_CAP_BYTES,
            measure_every: DEFAULT_MEASURE_EVERY,
        }
    }
}

/// Why a solve stopped.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum StopReason {
    /// Both gains reached the target.
    Target,
    /// The iteration cap.
    MaxIterations,
    /// The time cap.
    MaxSeconds,
}

/// What a solve did.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SolveReport {
    /// Iterations run.
    pub iterations: u32,
    /// Each player's gain as a percent of the starting pot, `[oop, ip]`, for the final
    /// profile.
    pub exploitability_pct_pot: [f32; 2],
    /// Accounted peak bytes (O-139).
    pub peak_bytes: u64,
    /// The estimate checked against the cap.
    pub estimate_bytes: u64,
    /// Wall-clock seconds from the start of the call to the final measurement.
    pub seconds: f32,
    /// Why the solve stopped.
    pub stop_reason: StopReason,
    /// The entry storage used.
    pub storage: StorageBits,
    /// `gto_tree::tree_hash` of the problem's tree configuration.
    pub tree_hash: [u8; 32],
}

/// Hears a solve's progress.
pub trait ProgressSink {
    /// Called after every iteration, with each player's gain as a percent of the starting
    /// pot on the iterations that measure it.
    fn report(&self, iteration: u32, exploitability_pct_pot: Option<[f32; 2]>);

    /// Called once with the final report.
    fn finished(&self, _report: &SolveReport) {}
}

/// A sink that ignores everything.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoProgress;

impl ProgressSink for NoProgress {
    fn report(&self, _iteration: u32, _exploitability_pct_pot: Option<[f32; 2]>) {}
}
