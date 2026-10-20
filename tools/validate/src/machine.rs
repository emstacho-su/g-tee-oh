//! The machine block of a report (`machine.name`, `os`, `cpu`, `cores`, `memory_gb`)
//! read through `sysinfo` with only its `system` feature, plus the two environment
//! probes a report needs, the commit and the toolchain. Owner: the G1 agent (R2.4).
//!
//! Mechanism. [`detect`] refreshes a `sysinfo::System` once for the CPU list and the
//! memory, takes the brand string of the first CPU, the logical core count and the
//! total memory rounded to gibibytes, and `System::name` with `System::os_version` for
//! the operating system. [`git_head`] runs `git rev-parse HEAD` in the repository root
//! and checks the 40 hex characters; [`rustc_version`] runs `rustc --version` and keeps
//! its first line. Both report a failed or unreadable command instead of guessing, and
//! `detect` reports a host that answers with no CPU or no memory the same way, since the
//! schema requires at least one core and one gibibyte.

use std::fmt;
use std::path::Path;
use std::process::Command;

use sysinfo::{CpuRefreshKind, MemoryRefreshKind, System};

use crate::report::Machine;

/// The machine name when neither `--machine` nor `VALIDATE_MACHINE` says otherwise:
/// the Zenbook baseline the phase docs name (O-40).
pub const DEFAULT_MACHINE_NAME: &str = "zenbook";

/// The environment variable that overrides the machine name (CI sets `github-ubuntu`).
pub const MACHINE_ENV: &str = "VALIDATE_MACHINE";

/// The length of a full commit hash.
pub const COMMIT_HEX_LEN: usize = 40;

/// Bytes in one gibibyte, the unit of `memory_gb`.
const BYTES_PER_GIB: u64 = 1 << 30;

/// The program name `detect` reports its probe failures under.
const SYSINFO: &str = "sysinfo";

/// The git executable and the rustc executable, as found on `PATH`.
const GIT: &str = "git";
const RUSTC: &str = "rustc";

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
/// `MachineError::BadName` when `name` fails [`check_name`]; `MachineError::Unexpected`
/// under the program name `sysinfo` when the host reports no CPU, no memory, or a core
/// count or memory size that does not fit the schema's integer.
pub fn detect(name: &str) -> Result<Machine, MachineError> {
    check_name(name)?;
    let mut system = System::new();
    system.refresh_cpu_list(CpuRefreshKind::nothing());
    system.refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());
    let cpu = system
        .cpus()
        .first()
        .map(|cpu| cpu.brand().trim().to_owned())
        .filter(|brand| !brand.is_empty())
        .ok_or_else(|| unexpected("no CPU brand reported"))?;
    let cores = u32::try_from(system.cpus().len())
        .ok()
        .filter(|cores| *cores >= 1)
        .ok_or_else(|| unexpected(&format!("{} CPUs reported", system.cpus().len())))?;
    let memory_gb = u32::try_from(round_to_gib(system.total_memory()))
        .ok()
        .filter(|memory| *memory >= 1)
        .ok_or_else(|| {
            unexpected(&format!("{} bytes of memory reported", system.total_memory()))
        })?;
    Ok(Machine { name: name.to_owned(), os: os_name_and_version(), cpu, cores, memory_gb })
}

/// `bytes` in gibibytes, rounded to the nearest whole number.
fn round_to_gib(bytes: u64) -> u64 {
    bytes.saturating_add(BYTES_PER_GIB / 2) / BYTES_PER_GIB
}

/// `System::name` and `System::os_version` joined with a space, falling back to the
/// compile-time operating system name when sysinfo has nothing.
fn os_name_and_version() -> String {
    let name = System::name().unwrap_or_else(|| std::env::consts::OS.to_owned());
    match System::os_version() {
        Some(version) if !version.trim().is_empty() => format!("{name} {}", version.trim()),
        _ => name,
    }
}

/// A `detect` failure under the `sysinfo` program name.
fn unexpected(output: &str) -> MachineError {
    MachineError::Unexpected { program: SYSINFO, output: output.to_owned() }
}

/// `git rev-parse HEAD` in `repo_root`, checked by [`check_commit`].
///
/// # Errors
///
/// `MachineError::Spawn`, `Failed`, `Unexpected` or `BadCommit`.
pub fn git_head(repo_root: &Path) -> Result<String, MachineError> {
    let stdout = run(GIT, &["rev-parse", "HEAD"], Some(repo_root))?;
    let commit = stdout.trim().to_owned();
    check_commit(&commit)?;
    Ok(commit)
}

/// The first line of `rustc --version`.
///
/// # Errors
///
/// `MachineError::Spawn`, `Failed` or `Unexpected` (an empty first line, or one that does
/// not start with `rustc`).
pub fn rustc_version() -> Result<String, MachineError> {
    let stdout = run(RUSTC, &["--version"], None)?;
    let first_line = stdout.lines().next().unwrap_or_default().trim().to_owned();
    if first_line.starts_with("rustc ") {
        Ok(first_line)
    } else {
        Err(MachineError::Unexpected { program: RUSTC, output: stdout.trim().to_owned() })
    }
}

/// Run `program` with `args` (in `cwd` when given) and hand back its standard output as
/// text, or the error that names the program.
fn run(program: &'static str, args: &[&str], cwd: Option<&Path>) -> Result<String, MachineError> {
    let mut command = Command::new(program);
    command.args(args);
    if let Some(dir) = cwd {
        command.current_dir(dir);
    }
    let output = command.output().map_err(|source| MachineError::Spawn { program, source })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Err(MachineError::Failed { program, stderr });
    }
    String::from_utf8(output.stdout).map_err(|error| MachineError::Unexpected {
        program,
        output: String::from_utf8_lossy(error.as_bytes()).trim().to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::{check_commit, check_name, detect, git_head, round_to_gib, rustc_version};

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

    /// R2.4: the three probes answer on the host that runs the tests, with every field
    /// inside the schema's bounds, and a bad name is refused before sysinfo is asked.
    #[test]
    fn r2_4_probes_answer_on_this_host() {
        let machine = detect("test-machine").expect("sysinfo answers");
        assert_eq!(machine.name, "test-machine");
        assert_ne!(machine.os, "");
        assert_ne!(machine.cpu, "");
        assert!(machine.cores >= 1);
        assert!(machine.memory_gb >= 1);
        assert!(detect("Bad Name").is_err());
        let commit = git_head(&crate::repo_root()).expect("git answers in a checkout");
        assert!(check_commit(&commit).is_ok(), "{commit}");
        let toolchain = rustc_version().expect("rustc is on PATH");
        assert!(toolchain.starts_with("rustc "), "{toolchain}");
        assert!(!toolchain.contains('\n'));
    }

    /// R2.4: memory rounds to the nearest gibibyte.
    #[test]
    fn r2_4_memory_rounds_to_the_nearest_gibibyte() {
        let gib = 1u64 << 30;
        assert_eq!(round_to_gib(0), 0);
        assert_eq!(round_to_gib(gib / 2 - 1), 0);
        assert_eq!(round_to_gib(gib / 2), 1);
        assert_eq!(round_to_gib(16 * gib - 1), 16);
        assert_eq!(round_to_gib(33_654_878_208), 31);
        assert_eq!(round_to_gib(u64::MAX), u64::MAX / gib);
    }
}
