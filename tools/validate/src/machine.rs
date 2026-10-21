//! The machine block of a report (`machine.name`, `os`, `cpu`, `cores`, `memory_gb`)
//! read through `sysinfo` with only its `system` feature, plus the run provenance a
//! report needs: the machine name, the commit with the state of the working tree, and
//! the toolchain. Owner: the G1 agent (R2.4).
//!
//! Mechanism. [`detect`] refreshes a `sysinfo::System` once for the CPU list and the
//! memory, takes the brand string of the first CPU, the logical core count and the
//! total memory rounded to gibibytes, and `System::name` with `System::os_version` for
//! the operating system. [`machine_name`] picks the name: `--machine`, else
//! `VALIDATE_MACHINE`, else the host name lowercased with every character outside the
//! schema's pattern `^[a-z][a-z0-9-]*$` turned into a dash, else an error.
//! [`resolve_commit`] runs `git status --porcelain` in the repository root and refuses a
//! dirty tree unless the caller allows it, then takes the commit from the caller or from
//! `git rev-parse HEAD`, checked as 40 hex characters. [`rustc_version`] is the line the
//! build script embedded (`build.rs`). Every probe reports a failed or unreadable
//! command instead of guessing, and `detect` reports a host that answers with no CPU or
//! no memory the same way, since the schema requires at least one core and one gibibyte.

use std::fmt;
use std::path::Path;
use std::process::Command;

use sysinfo::{CpuRefreshKind, MemoryRefreshKind, System};

use crate::report::Machine;

/// The environment variable that names the machine when `--machine` does not (CI sets
/// `github-ubuntu`, the Zenbook run sets `zenbook`).
pub const MACHINE_ENV: &str = "VALIDATE_MACHINE";

/// The length of a full commit hash.
pub const COMMIT_HEX_LEN: usize = 40;

/// What a host name character outside the machine name pattern becomes.
const NAME_REPLACEMENT: char = '-';

/// Bytes in one gibibyte, the unit of `memory_gb`.
const BYTES_PER_GIB: u64 = 1 << 30;

/// The program name `detect` reports its probe failures under.
const SYSINFO: &str = "sysinfo";

/// The git executable, as found on `PATH`.
const GIT: &str = "git";

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
    /// No `--machine`, no `VALIDATE_MACHINE`, and no usable host name.
    NoMachineName {
        /// Why the host name could not serve, in plain words.
        reason: String,
    },
    /// A commit outside `^[0-9a-f]{40}$`.
    BadCommit(String),
    /// The working tree has changes and the run did not allow them.
    DirtyTree {
        /// The first path `git status --porcelain` lists.
        path: String,
    },
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
            Self::NoMachineName { reason } => {
                write!(f, "no machine name: pass --machine NAME or set {MACHINE_ENV} ({reason})")
            }
            Self::BadCommit(commit) => {
                write!(f, "commit {commit:?} is not {COMMIT_HEX_LEN} lowercase hex characters")
            }
            Self::DirtyTree { path } => write!(
                f,
                "the working tree is dirty (first dirty path: {path}); commit or stash the \
                 changes, or pass --allow-dirty to record them in the notes"
            ),
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
            | Self::NoMachineName { .. }
            | Self::BadCommit(_)
            | Self::DirtyTree { .. } => None,
        }
    }
}

/// Whether a character may appear after the first one in a machine name.
fn is_name_char(c: char) -> bool {
    c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'
}

/// Fail unless `name` matches the schema's machine name pattern.
///
/// # Errors
///
/// `MachineError::BadName` otherwise.
pub fn check_name(name: &str) -> Result<(), MachineError> {
    let mut chars = name.chars();
    let starts_well = chars.next().is_some_and(|c| c.is_ascii_lowercase());
    if starts_well && chars.all(is_name_char) {
        Ok(())
    } else {
        Err(MachineError::BadName(name.to_owned()))
    }
}

/// The machine name for a run: `flag`, else `env`, else `host()` mapped through
/// [`name_from_host`]. A given name is checked, never rewritten.
///
/// # Errors
///
/// `MachineError::BadName` for a given name outside the pattern,
/// `MachineError::NoMachineName` when neither is given and the host name is absent or
/// does not map to a valid name.
pub fn machine_name(
    flag: Option<&str>,
    env: Option<&str>,
    host: impl FnOnce() -> Option<String>,
) -> Result<String, MachineError> {
    if let Some(given) = flag.or(env) {
        check_name(given)?;
        return Ok(given.to_owned());
    }
    let host = host().ok_or_else(|| MachineError::NoMachineName {
        reason: "the operating system reports no host name".to_owned(),
    })?;
    name_from_host(&host)
}

/// `host` trimmed and lowercased, with every character outside `[a-z0-9-]` replaced by
/// a dash.
///
/// # Errors
///
/// `MachineError::NoMachineName` when the result does not start with a letter.
pub fn name_from_host(host: &str) -> Result<String, MachineError> {
    let name: String = host
        .trim()
        .chars()
        .map(|c| c.to_ascii_lowercase())
        .map(|c| if is_name_char(c) { c } else { NAME_REPLACEMENT })
        .collect();
    match check_name(&name) {
        Ok(()) => Ok(name),
        Err(_) => Err(MachineError::NoMachineName {
            reason: format!(
                "host name {host:?} maps to {name:?}, which does not start with a letter"
            ),
        }),
    }
}

/// The host name `sysinfo` reports, if any.
#[must_use]
pub fn host_name() -> Option<String> {
    System::host_name()
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

/// The state of the working tree as `git status --porcelain` reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TreeState {
    /// No change, staged or not, and no untracked file.
    Clean,
    /// At least one change.
    Dirty {
        /// The first path listed, the new name for a rename or copy.
        first_path: String,
    },
}

/// Read `git status --porcelain` (format v1) output: every line is two status letters, a
/// space and the path, or `ORIG -> PATH` for a rename or copy. No line means clean.
///
/// # Errors
///
/// `MachineError::Unexpected` under `git` when the first line is not in that form.
pub fn parse_porcelain(output: &str) -> Result<TreeState, MachineError> {
    let Some(line) = output.lines().find(|line| !line.is_empty()) else {
        return Ok(TreeState::Clean);
    };
    let path = line
        .get(3..)
        .filter(|path| line.as_bytes().get(2) == Some(&b' ') && !path.is_empty())
        .ok_or_else(|| MachineError::Unexpected { program: GIT, output: line.to_owned() })?;
    let first_path = path.rsplit(" -> ").next().unwrap_or(path).to_owned();
    Ok(TreeState::Dirty { first_path })
}

/// `git status --porcelain` in `repo_root`, read by [`parse_porcelain`].
///
/// # Errors
///
/// `MachineError::Spawn`, `Failed` or `Unexpected`.
pub fn tree_state(repo_root: &Path) -> Result<TreeState, MachineError> {
    parse_porcelain(&run(GIT, &["status", "--porcelain"], Some(repo_root))?)
}

/// Whether a run may go ahead on `state`, and whether the tree it runs on is dirty:
/// `Ok(false)` when clean, `Ok(true)` when dirty and that is allowed.
///
/// # Errors
///
/// `MachineError::DirtyTree` naming the first dirty path when it is not allowed.
pub fn judge_tree(state: TreeState, allow_dirty: bool) -> Result<bool, MachineError> {
    match state {
        TreeState::Clean => Ok(false),
        TreeState::Dirty { .. } if allow_dirty => Ok(true),
        TreeState::Dirty { first_path } => Err(MachineError::DirtyTree { path: first_path }),
    }
}

/// The commit a run records and whether the tree was dirty when it ran.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedCommit {
    /// 40 lowercase hex characters.
    pub commit: String,
    /// True when the run went ahead on a dirty tree under `--allow-dirty`.
    pub tree_dirty: bool,
}

/// The working tree check through [`judge_tree`], then `given` or `git rev-parse HEAD` in
/// `repo_root`, checked by [`check_commit`]. The one commit resolution every subcommand
/// that records a commit goes through.
///
/// # Errors
///
/// `MachineError::DirtyTree` on a dirty tree without `allow_dirty`, `BadCommit` for a
/// malformed commit, and the probe errors of `git`.
pub fn resolve_commit(
    repo_root: &Path,
    given: Option<&str>,
    allow_dirty: bool,
) -> Result<ResolvedCommit, MachineError> {
    let tree_dirty = judge_tree(tree_state(repo_root)?, allow_dirty)?;
    let commit = match given {
        Some(commit) => commit.to_owned(),
        None => run(GIT, &["rev-parse", "HEAD"], Some(repo_root))?.trim().to_owned(),
    };
    check_commit(&commit)?;
    Ok(ResolvedCommit { commit, tree_dirty })
}

/// The first line of `rustc --version` for the compiler that built this crate, embedded
/// by `build.rs` and checked there through `crate::toolchain::first_line`.
#[must_use]
pub fn rustc_version() -> &'static str {
    env!("VALIDATE_RUSTC_VERSION")
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
mod tests;
