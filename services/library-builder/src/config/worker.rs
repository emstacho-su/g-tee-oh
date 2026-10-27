//! The worker id (O-185, S18 review MEDIUM 8, L6).
//!
//! `BUILDER_WORKER_ID`, or by default the host name, is the stable half: it stays the same
//! across restarts, so the stale reclaim can tell this worker's own abandoned rows from
//! another worker's. [`process_worker_id`] appends `#` and a per-process nonce (the process
//! id and the process start time in seconds, both hexadecimal), which is what a claim
//! writes to `build_job.locked_by`: a restarted process, even one that reuses the old
//! process id (a container's process 1), never mistakes the old process's lock for its own.
//! The stable half may therefore not contain `#`.
//!
//! Two processes running at the same time may share a `BUILDER_WORKER_ID` (the loop and a
//! `--once` run in one container, PR #22 re-review MEDIUM): each holds a liveness lock keyed
//! by its full id (`queue::liveness_key`), and the stale reclaim takes a row of the same
//! stable half only when its holder's lock is free, that is, when the holder is dead.

use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// The separator between the stable worker id and the process nonce.
pub const NONCE_SEPARATOR: char = '#';

/// `<stable>#<pid>-<start>`: `stable` with this process's nonce, the process id and the
/// process start time in seconds since the Unix epoch, both lowercase hexadecimal. The
/// nonce is computed once, so every call in one process answers the same.
#[must_use]
pub fn process_worker_id(stable: &str) -> String {
    static NONCE: OnceLock<String> = OnceLock::new();
    let nonce = NONCE.get_or_init(|| {
        let pid = std::process::id();
        format!("{pid:x}-{:x}", process_start_seconds())
    });
    format!("{stable}{NONCE_SEPARATOR}{nonce}")
}

/// The process start time from sysinfo, or the time of the first call when sysinfo cannot
/// read it (logged); either is fixed for the life of the process.
fn process_start_seconds() -> u64 {
    let started = sysinfo::get_current_pid().ok().and_then(|pid| {
        let mut system = sysinfo::System::new();
        system.refresh_processes_specifics(
            sysinfo::ProcessesToUpdate::Some(&[pid]),
            true,
            sysinfo::ProcessRefreshKind::nothing(),
        );
        system.process(pid).map(sysinfo::Process::start_time)
    });
    if let Some(seconds) = started.filter(|seconds| *seconds > 0) {
        seconds
    } else {
        tracing::warn!("the process start time is unavailable; the nonce uses the clock");
        SystemTime::now().duration_since(UNIX_EPOCH).map_or(1, |since| since.as_secs())
    }
}
