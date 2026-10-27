//! The builder's one error type. Every failure a job can meet is a variant, so the text
//! written to `build_job.error` names its cause (A5 section 4). No variant carries a
//! secret: the database and store errors are formatted from their sources, which never
//! include the password or the S3 secret key (`config` holds them redacted).

use gto_library::LibraryError;
use gto_planner::PlanError;
use gto_solve::postflop::SolveError;
use gto_tree::TreeError;

/// Why a builder operation failed.
#[derive(Debug, thiserror::Error)]
pub enum BuilderError {
    /// The command needs the database and `BUILDER_DB_PASSWORD` is unset.
    #[error("the database is unconfigured: set BUILDER_DB_PASSWORD")]
    DatabaseUnconfigured,
    /// The command needs the library target and neither `LIBRARY_ROOT` nor `S3_ENDPOINT`
    /// is set.
    #[error("the library target is unconfigured: set LIBRARY_ROOT or S3_ENDPOINT")]
    StoreUnconfigured,
    /// A database statement failed.
    #[error("database: {0}")]
    Database(#[from] sqlx::Error),
    /// The library bucket failed.
    #[error("library store {operation} {path}: {reason}")]
    Store {
        /// What was attempted: put, get, list or delete.
        operation: &'static str,
        /// The object path.
        path: String,
        /// The client's message.
        reason: String,
    },
    /// A local file operation failed (staging, fixtures, reports).
    #[error("{path}: {source}")]
    Io {
        /// The path.
        path: String,
        /// The error.
        source: std::io::Error,
    },
    /// The library format rejected a write or a read.
    #[error("library: {0}")]
    Library(#[from] LibraryError),
    /// The solve adapter failed.
    #[error("solve: {0}")]
    Solve(#[from] SolveError),
    /// The planner failed.
    #[error("plan: {0}")]
    Plan(#[from] PlanError),
    /// A tree could not be built from the configuration's sizing convention.
    #[error("tree: {0}")]
    Tree(#[from] TreeError),
    /// A `gto-model` value failed its checks.
    #[error("model: {0}")]
    Model(#[from] gto_model::ModelError),
    /// The job names a configuration outside `gto_model::v1_configs` (O-182).
    #[error("configuration {0} is not in the v1 catalog")]
    UnknownConfig(String),
    /// The job's tree hash differs from the one its configuration's convention gives now.
    #[error("tree hash mismatch for job {job}: queued {queued}, convention gives {current}")]
    TreeHashMismatch {
        /// The job id.
        job: String,
        /// The hash on the row, hexadecimal.
        queued: String,
        /// The hash the convention gives now, hexadecimal.
        current: String,
    },
    /// The job names a preflop line its configuration's tree does not have.
    #[error("line {line} is not a flop line of {pair} in {config_id}")]
    UnknownLine {
        /// The configuration.
        config_id: String,
        /// The pair.
        pair: String,
        /// The line.
        line: String,
    },
    /// No range source covers a line (O-181).
    #[error("no ranges for line {line} of {pair} in {config_id}")]
    MissingRanges {
        /// The configuration.
        config_id: String,
        /// The pair.
        pair: String,
        /// The line.
        line: String,
    },
    /// The memory estimate exceeds the cap, so the solve is refused before allocation
    /// (A2 section 3, O-187).
    #[error(
        "line {line}: estimate {estimate_bytes} bytes exceeds the memory cap of {cap_bytes} bytes"
    )]
    OverMemoryCap {
        /// The line.
        line: String,
        /// The estimate.
        estimate_bytes: u64,
        /// The cap in force.
        cap_bytes: u64,
    },
    /// The solve stopped above the exploitability target, so nothing is published (02
    /// section 3.2 step 4).
    #[error(
        "line {line}: gains {gains_pct_pot:?} percent of the pot exceed the target {target_pct_pot}"
    )]
    AboveTarget {
        /// The line.
        line: String,
        /// Both seats' gains.
        gains_pct_pot: [f64; 2],
        /// The target in force.
        target_pct_pot: f32,
    },
    /// The job was taken from this worker (a stale reclaim) before it published.
    #[error("job {0} is no longer locked by this worker")]
    LostLock(String),
    /// The named job does not exist or is not queued.
    #[error("job {0} is not queued")]
    JobNotQueued(String),
    /// A job spec, fixture or report file is malformed.
    #[error("{path}: {reason}")]
    Malformed {
        /// The file.
        path: String,
        /// What is wrong.
        reason: String,
    },
    /// The command-line arguments are malformed.
    #[error("{0}")]
    Usage(String),
    /// Not implemented yet (the red half of S18).
    #[error("{0} is not implemented yet (S18)")]
    NotImplemented(&'static str),
}

impl BuilderError {
    /// A store error for `operation` on `path`.
    #[must_use]
    pub fn store(operation: &'static str, path: &str, reason: &dyn std::fmt::Display) -> Self {
        BuilderError::Store { operation, path: path.to_owned(), reason: reason.to_string() }
    }

    /// An input/output error on `path`.
    #[must_use]
    pub fn io(path: &std::path::Path, source: std::io::Error) -> Self {
        BuilderError::Io { path: path.display().to_string(), source }
    }
}
