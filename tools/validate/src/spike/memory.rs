//! The three peak readings of the spike (O-228).
//!
//! Mechanism. The accounted peak comes from `peak_alloc`, installed here as the global
//! allocator of every binary that links the `validate` library: the `validate` binary and
//! the crate's test binaries alike, so the one-depth R2.21 test measures real bytes on any
//! operating system. The allocator keeps a current and a peak byte count in two atomics;
//! [`start`] moves the peak down to the current count, so a run's accounted peak is the
//! largest heap the process held from that point on.
//!
//! The two kernel readings are Linux only and read as `None` elsewhere. `VmHWM` in
//! `/proc/self/status` is the process's resident high-water mark; [`start`] writes `5` to
//! `/proc/self/clear_refs`, which resets it (Linux 4.0 and later), and when that write
//! fails the reading stays the process's lifetime peak, which still bounds the run's peak
//! from above. The cgroup reading is `memory.peak` of cgroup version 2, the container's
//! peak since it started; on a cgroup version 1 host the fallback is
//! `memory.max_usage_in_bytes`, read only inside a Docker container (`/.dockerenv`), since
//! outside one that file describes the whole host. Neither cgroup figure is reset, so the
//! second run's reading also covers the first: an upper bound again.

use std::path::Path;

use peak_alloc::PeakAlloc;

use super::PeakBytes;

/// The allocator that keeps the accounted peak.
#[global_allocator]
static ALLOCATOR: PeakAlloc = PeakAlloc;

/// The process status file that carries `VmHWM`.
const PROC_STATUS: &str = "/proc/self/status";

/// The file whose value `5` resets the process's resident high-water mark.
const PROC_CLEAR_REFS: &str = "/proc/self/clear_refs";

/// The value written to `clear_refs` to reset `VmHWM`.
const CLEAR_REFS_RESET_PEAK: &str = "5";

/// The `/proc/self/status` field of the resident high-water mark.
const VM_HWM_FIELD: &str = "VmHWM:";

/// The cgroup version 2 peak of the process's own cgroup, as a container sees it.
const CGROUP_V2_PEAK: &str = "/sys/fs/cgroup/memory.peak";

/// The cgroup version 1 peak, as a container sees it.
const CGROUP_V1_PEAK: &str = "/sys/fs/cgroup/memory/memory.max_usage_in_bytes";

/// The file Docker creates at the root of every container.
const DOCKER_ENV_MARKER: &str = "/.dockerenv";

/// Bytes in one kibibyte, the unit `/proc/self/status` uses.
const BYTES_PER_KIB: u64 = 1024;

/// Start a measured run: reset the accounted peak and, where the kernel allows, the
/// resident high-water mark.
pub(crate) fn start() {
    ALLOCATOR.reset_peak_usage();
    // A failed reset leaves VmHWM at the process's lifetime peak, which is at least this
    // run's peak, so the judged figure stays an upper bound; nothing is lost but detail.
    let _reset_or_lifetime_peak = std::fs::write(PROC_CLEAR_REFS, CLEAR_REFS_RESET_PEAK);
}

/// The three readings at the end of a measured run.
pub(crate) fn finish() -> PeakBytes {
    PeakBytes {
        accounted: u64::try_from(ALLOCATOR.peak_usage()).unwrap_or(u64::MAX),
        vm_hwm: read_vm_hwm(),
        cgroup_peak: read_cgroup_peak(),
    }
}

/// `VmHWM` in bytes, when `/proc/self/status` is readable and carries it.
fn read_vm_hwm() -> Option<u64> {
    std::fs::read_to_string(PROC_STATUS).ok().as_deref().and_then(parse_vm_hwm)
}

/// The container's peak in bytes: cgroup version 2 first, then version 1 inside Docker.
fn read_cgroup_peak() -> Option<u64> {
    read_bytes_file(CGROUP_V2_PEAK).or_else(|| {
        Path::new(DOCKER_ENV_MARKER).exists().then(|| read_bytes_file(CGROUP_V1_PEAK)).flatten()
    })
}

/// A file holding one byte count, when readable.
fn read_bytes_file(path: &str) -> Option<u64> {
    std::fs::read_to_string(path).ok().as_deref().and_then(parse_bytes)
}

/// The `VmHWM` line of a `/proc/self/status` text in bytes: `VmHWM:   1234 kB`.
pub(crate) fn parse_vm_hwm(status: &str) -> Option<u64> {
    let line = status.lines().find(|line| line.starts_with(VM_HWM_FIELD))?;
    let mut words = line[VM_HWM_FIELD.len()..].split_whitespace();
    let kib: u64 = words.next()?.parse().ok()?;
    match words.next() {
        Some("kB") => kib.checked_mul(BYTES_PER_KIB),
        _ => None,
    }
}

/// A cgroup byte count: one decimal number and a newline. `max` and anything else that is
/// not a count read as `None`.
pub(crate) fn parse_bytes(text: &str) -> Option<u64> {
    text.trim().parse().ok()
}

#[cfg(test)]
mod tests {
    use super::{parse_bytes, parse_vm_hwm};

    #[test]
    fn r2_21_vm_hwm_reads_kibibytes_as_bytes() {
        let status = "Name:\tvalidate\nVmPeak:\t  999 kB\nVmHWM:\t    2048 kB\nVmRSS:\t 1 kB\n";
        assert_eq!(parse_vm_hwm(status), Some(2048 * 1024));
    }

    #[test]
    fn r2_21_vm_hwm_without_the_field_or_unit_is_none() {
        assert_eq!(parse_vm_hwm("Name:\tvalidate\n"), None);
        assert_eq!(parse_vm_hwm("VmHWM:\t2048 MB\n"), None);
        assert_eq!(parse_vm_hwm("VmHWM:\tmany kB\n"), None);
    }

    #[test]
    fn r2_21_cgroup_counts_parse_and_max_does_not() {
        assert_eq!(parse_bytes("123456789\n"), Some(123_456_789));
        assert_eq!(parse_bytes("max\n"), None);
    }

    #[test]
    fn r2_21_accounted_peak_sees_an_allocation() {
        super::start();
        let block = std::hint::black_box(vec![0_u8; 1 << 20]);
        let peak = super::finish();
        assert!(peak.accounted >= 1 << 20, "{peak:?}");
        drop(block);
    }
}
