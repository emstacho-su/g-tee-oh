//! The machine block of a report (`machine.name`, `os`, `cpu`, `cores`, `memory_gb`)
//! read through `sysinfo` with only its `system` feature, plus the two environment
//! probes a report needs, the commit and the toolchain. Owner: the G1 agent (R2.4). The
//! probes are stubs until then; the name rule is settled here.
//!
//! Mechanism. [`detect`] refreshes a `sysinfo::System` once for the CPU list and the
//! memory, takes the brand string of the first CPU, the logical core count and the
//! total memory rounded to gibibytes, and `System::name` with `System::os_version` for
//! the operating system. [`git_head`] runs `git rev-parse HEAD` in the repository root
//! and checks the 40 hex characters; [`rustc_version`] runs `rustc --version` and keeps
//! its first line. Both report a failed or unreadable command instead of guessing.

use std::fmt;
use std::path::Path;

use crate::report::Machine;

/// The machine name when neither `--machine` nor `VALIDATE_MACHINE` says otherwise:
/// the Zenbook baseline the phase docs name (O-40).
pub const DEFAULT_MACHINE_NAME: &str = "zenbook";

/// The environment variable that overrides the machine name (CI sets `github-ubuntu`).
pub const MACHINE_ENV: &str = "VALIDATE_MACHINE";

/// The length of a full commit hash.
pub const COMMIT_HEX_LEN: usize = 40;

/// Why a probe failed.
#[derive(Debug)]
pub enum MachineError {
    /// A program could not be started.
    Spawn {
        /// The program.
        program: &'static str,
        /// The input/output error.
        source: std::io::Error,
    },
    /// A program ran and failed.
    Failed {
        /// The program.
        program: &'static str,
        /// Its standard error, trimmed.
        stderr: String,
    },
    /// A program's output is not what the probe expects.
    Unexpected {
        /// The program.
        program: &'static str,
        /// The output, trimmed.
        output: String,
    },
    /// A machine name outside `^[a-z][a-z0-9-]*$`.
    BadName(String),
    /// A commit outside `^[0-9a-f]{40}$`.
    BadCommit(String),
}

impl fmt::Display for MachineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Spawn { program, source } => write!(f, "cannot start {program}: {source}"),
            Self::Failed { program, stderr } => write!(f, "{program} failed: {stderr}"),
            Self::Unexpected { program, output } => {
                write!(f, "{program} printed something unexpected: {output}")
            }
            Self::BadName(name) => write!(
                f,
                "machine name {name:?} is not lowercase letters, digits and dashes starting \
                 with a letter"
            ),
            Self::BadCommit(commit) => {
                write!(f, "commit {commit:?} is not {COMMIT_HEX_LEN} lowercase hex characters")
            }
        }
    }
}

impl std::error::Error for MachineError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Spawn { source, .. } => Some(source),
            Self::Failed { .. }
            | Self::Unexpected { .. }
            | Self::BadName(_)
            | Self::BadCommit(_) => None,
        }
    }
}

/// Fail unless `name` matches the schema's machine name pattern.
///
/// # Errors
///
/// `MachineError::BadName` otherwise.
pub fn check_name(name: &str) -> Result<(), MachineError> {
    let mut chars = name.chars();
    let starts_well = chars.next().is_some_and(|c| c.is_ascii_lowercase());
    let rest_well = chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if starts_well && rest_well { Ok(()) } else { Err(MachineError::BadName(name.to_owned())) }
}

/// Fail unless `commit` is a full lowercase hex hash.
///
/// # Errors
///
/// `MachineError::BadCommit` otherwise.
pub fn check_commit(commit: &str) -> Result<(), MachineError> {
    let hex = commit.len() == COMMIT_HEX_LEN
        && commit.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c));
    if hex { Ok(()) } else { Err(MachineError::BadCommit(commit.to_owned())) }
}

/// The machine block for this host under `name`.
///
/// # Errors
///
/// `MachineError::BadName` when `name` fails [`check_name`].
pub fn detect(name: &str) -> Result<Machine, MachineError> {
    check_name(name)?;
    todo!("G1: the sysinfo machine block for {name}")
}

/// `git rev-parse HEAD` in `repo_root`, checked by [`check_commit`].
///
/// # Errors
///
/// `MachineError::Spawn`, `Failed`, `Unexpected` or `BadCommit`.
pub fn git_head(repo_root: &Path) -> Result<String, MachineError> {
    todo!("G1: git rev-parse HEAD in {}", repo_root.display())
}

/// The first line of `rustc --version`.
///
/// # Errors
///
/// `MachineError::Spawn`, `Failed` or `Unexpected`.
pub fn rustc_version() -> Result<String, MachineError> {
    todo!("G1: rustc --version")
}

#[cfg(test)]
mod tests {
    use super::{check_commit, check_name};

    /// R2.4 (the machine block every gate report carries): the name rule is the schema's
    /// pattern, and the commit rule is 40 lowercase hex characters.
    #[test]
    fn r2_4_machine_name_and_commit_follow_the_schema_patterns() {
        assert!(check_name("zenbook").is_ok());
        assert!(check_name("github-ubuntu").is_ok());
        assert!(check_name("mac2").is_ok());
        assert!(check_name("").is_err());
        assert!(check_name("Zenbook").is_err());
        assert!(check_name("1st").is_err());
        assert!(check_name("zen book").is_err());
        assert!(check_commit("0123456789abcdef0123456789abcdef01234567").is_ok());
        assert!(check_commit("abc").is_err());
        assert!(check_commit(&"a".repeat(39)).is_err());
        assert!(check_commit(&"A".repeat(40)).is_err());
    }
}
