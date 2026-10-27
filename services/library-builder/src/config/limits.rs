//! The deploy-time ceilings of [`Limits`] (S18 review M1, M2): `BUILDER_MEMORY_CEILING_BYTES`
//! and `BUILDER_BUDGET_CEILING_BYTES`, each a positive byte count.
//!
//! The memory ceiling falls back to the container's cgroup version 2 limit (the number in
//! `/sys/fs/cgroup/memory.max`) less [`CGROUP_HEADROOM_BYTES`], and to
//! [`DEFAULT_MEMORY_CEILING_BYTES`] when the file is absent or reads `max`. The budget
//! ceiling falls back to [`DEFAULT_BUDGET_CEILING_BYTES`]. The cgroup figure is passed in by
//! the caller, so tests never read the real file.

use std::ffi::OsString;

use super::{Error, unicode};
use crate::settings::{DEFAULT_BUDGET_CEILING_BYTES, DEFAULT_MEMORY_CEILING_BYTES, Limits};

/// Variable holding the largest `memory_cap_bytes` any setting row may put in force.
pub const MEMORY_CEILING_VAR: &str = "BUILDER_MEMORY_CEILING_BYTES";

/// Variable holding the largest `budget_bytes` any setting row may put in force.
pub const BUDGET_CEILING_VAR: &str = "BUILDER_BUDGET_CEILING_BYTES";

/// Where cgroup version 2 publishes the container's memory limit.
pub const CGROUP_MEMORY_MAX_PATH: &str = "/sys/fs/cgroup/memory.max";

/// What the memory ceiling leaves under the cgroup limit for the runtime, the runout
/// extraction and the staging buffers: 1 GiB, so the 5 GiB container gets the 4 GiB
/// default cap.
pub const CGROUP_HEADROOM_BYTES: u64 = 1024 * 1024 * 1024;

/// The ceilings from `lookup`, with `cgroup_memory_max` the container limit when known.
///
/// # Errors
///
/// `Error::InvalidCeiling` for a variable that is set but not a positive whole number,
/// `Error::NotUnicode` for one that is not Unicode.
pub(super) fn read<F>(lookup: &F, cgroup_memory_max: Option<u64>) -> Result<Limits, Error>
where
    F: Fn(&str) -> Option<OsString>,
{
    let memory_ceiling_bytes = match bytes(lookup, MEMORY_CEILING_VAR)? {
        Some(bytes) => bytes,
        None => cgroup_memory_max.map_or(DEFAULT_MEMORY_CEILING_BYTES, under_cgroup),
    };
    let budget_ceiling_bytes =
        bytes(lookup, BUDGET_CEILING_VAR)?.unwrap_or(DEFAULT_BUDGET_CEILING_BYTES);
    Ok(Limits { memory_ceiling_bytes, budget_ceiling_bytes })
}

/// The memory ceiling under a cgroup limit: the limit less [`CGROUP_HEADROOM_BYTES`], but
/// never under half the limit, so a container smaller than twice the headroom still gets a
/// positive ceiling.
fn under_cgroup(limit: u64) -> u64 {
    limit.saturating_sub(CGROUP_HEADROOM_BYTES).max(limit / 2)
}

/// The byte count in a `memory.max` text, `None` for `max` (no limit) or anything else
/// that is not a positive whole number.
#[must_use]
pub fn parse_cgroup_memory_max(text: &str) -> Option<u64> {
    text.trim().parse::<u64>().ok().filter(|bytes| *bytes > 0)
}

/// The container's memory limit from [`CGROUP_MEMORY_MAX_PATH`], `None` when the file is
/// absent (not Linux, or cgroup version 1) or carries no number. A read failure other than
/// a missing file is logged, because the default ceiling then applies.
#[must_use]
pub fn read_cgroup_memory_max() -> Option<u64> {
    match std::fs::read_to_string(CGROUP_MEMORY_MAX_PATH) {
        Ok(text) => parse_cgroup_memory_max(&text),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            tracing::warn!(%error, path = CGROUP_MEMORY_MAX_PATH, "cgroup memory limit unreadable");
            None
        }
    }
}

/// A positive byte count from `name`, `None` when unset.
fn bytes<F>(lookup: &F, name: &'static str) -> Result<Option<u64>, Error>
where
    F: Fn(&str) -> Option<OsString>,
{
    let Some(value) = unicode(lookup, name)? else {
        return Ok(None);
    };
    match value.parse::<u64>() {
        Ok(0) => Err(Error::InvalidCeiling { name, value, source: None }),
        Ok(bytes) => Ok(Some(bytes)),
        Err(source) => Err(Error::InvalidCeiling { name, value, source: Some(source) }),
    }
}
