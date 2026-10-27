//! The clock and the process figures a job records: the UTC time as RFC 3339 (the
//! manifest's `created_at`), the minute of the day the boost window is judged at (O-13),
//! and the memory figures and the machine the summary and the bench report carry (O-190):
//! the process's `VmHWM` and the container cgroup's `memory.peak`, both true peaks read on
//! Linux, and which of them O-50 judges.

use std::time::{SystemTime, UNIX_EPOCH};

/// Seconds in a day.
const SECONDS_PER_DAY: u64 = 86_400;

/// Seconds since the Unix epoch now; 0 for a clock set before 1970.
#[must_use]
pub fn now_epoch_seconds() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_secs())
}

/// The minute of the UTC day, 0 to 1,439, at `epoch_seconds`.
#[must_use]
pub fn minute_of_day_utc(epoch_seconds: u64) -> u32 {
    // Below 1,440, so the conversion cannot fail.
    u32::try_from(epoch_seconds % SECONDS_PER_DAY / 60).unwrap_or(0)
}

/// `epoch_seconds` as `YYYY-MM-DDTHH:MM:SSZ`.
#[must_use]
pub fn rfc3339_utc(epoch_seconds: u64) -> String {
    let (year, month, day) = civil_from_days(epoch_seconds / SECONDS_PER_DAY);
    let second_of_day = epoch_seconds % SECONDS_PER_DAY;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        second_of_day / 3_600,
        second_of_day % 3_600 / 60,
        second_of_day % 60
    )
}

/// The current time in UTC as RFC 3339 with a `Z` suffix, for `created_at`.
#[must_use]
pub fn utc_now_rfc3339() -> String {
    rfc3339_utc(now_epoch_seconds())
}

/// The proleptic Gregorian date of a day count since 1970-01-01: Howard Hinnant's
/// `civil_from_days`, shifting the year to start in March so the leap day is last, then
/// splitting into 400-year eras of 146,097 days.
fn civil_from_days(days: u64) -> (u64, u64, u64) {
    let shifted = days + 719_468;
    let era = shifted / 146_097;
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_from_march = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_from_march + 2) / 5 + 1;
    let month = if month_from_march < 10 { month_from_march + 3 } else { month_from_march - 9 };
    let year = year_of_era + era * 400 + u64::from(month <= 2);
    (year, month, day)
}

/// The Linux files the memory and machine figures read: the process status, the cgroup v2
/// `memory.peak` and `memory.max`, pid 1's cgroup list, and whether `/.dockerenv` exists.
#[cfg(target_os = "linux")]
mod paths {
    pub const STATUS: &str = "/proc/self/status";
    pub const CGROUP_MEMORY_PEAK: &str = "/sys/fs/cgroup/memory.peak";
    pub const CGROUP_MEMORY_MAX: &str = "/sys/fs/cgroup/memory.max";
    pub const PROC1_CGROUP: &str = "/proc/1/cgroup";
    pub const DOCKERENV: &str = "/.dockerenv";
}

/// `peak_source` when the container's cgroup `memory.peak` is judged.
pub const PEAK_SOURCE_CGROUP: &str = "cgroup memory.peak";

/// `peak_source` when the process's `VmHWM` is judged.
pub const PEAK_SOURCE_VM_HWM: &str = "VmHWM";

/// `peak_source` when no true peak was readable (any host but Linux).
pub const PEAK_SOURCE_NONE: &str = "none";

/// Bytes in a gibibyte, for the machine's memory (the validate tool's rounding).
const BYTES_PER_GIB: u64 = 1 << 30;

/// The contents of the files the memory and machine figures come from, read once so the
/// figures can be computed from injected text in tests. Every field is empty off Linux.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ProcSnapshot {
    /// `/proc/self/status`.
    pub status: Option<String>,
    /// `/sys/fs/cgroup/memory.peak` (cgroup v2, Linux 5.19 and later).
    pub cgroup_memory_peak: Option<String>,
    /// `/sys/fs/cgroup/memory.max`.
    pub cgroup_memory_max: Option<String>,
    /// `/proc/1/cgroup`.
    pub proc1_cgroup: Option<String>,
    /// True when `/.dockerenv` exists.
    pub dockerenv: bool,
}

impl ProcSnapshot {
    /// The files as they read now; a file that cannot be read is `None`.
    #[cfg(target_os = "linux")]
    #[must_use]
    pub fn read() -> Self {
        let read = |path: &str| std::fs::read_to_string(path).ok();
        Self {
            status: read(paths::STATUS),
            cgroup_memory_peak: read(paths::CGROUP_MEMORY_PEAK),
            cgroup_memory_max: read(paths::CGROUP_MEMORY_MAX),
            proc1_cgroup: read(paths::PROC1_CGROUP),
            dockerenv: std::path::Path::new(paths::DOCKERENV).exists(),
        }
    }

    /// Empty: off Linux there is no procfs or cgroup file to read, and no true peak is
    /// readable without unsafe code, which the crate forbids.
    #[cfg(not(target_os = "linux"))]
    #[must_use]
    pub fn read() -> Self {
        Self::default()
    }
}

/// The process's peak resident set size in bytes, `VmHWM` from `/proc/self/status`; `None`
/// off Linux, where the current figure is all that is readable and is not a peak.
#[must_use]
pub fn peak_rss_bytes() -> Option<u64> {
    ProcSnapshot::read().status.as_deref().and_then(parse_vm_hwm)
}

/// The `VmHWM` line of a `/proc/<pid>/status` text in bytes.
fn parse_vm_hwm(status: &str) -> Option<u64> {
    let line = status.lines().find_map(|line| line.strip_prefix("VmHWM:"))?;
    let kibibytes = line.trim().strip_suffix("kB")?.trim().parse::<u64>().ok()?;
    kibibytes.checked_mul(1_024)
}

/// A cgroup v2 byte count (`memory.peak`, `memory.max`); `None` for `max` (no limit) or
/// text that is not a number.
fn parse_cgroup_bytes(text: &str) -> Option<u64> {
    text.trim().parse::<u64>().ok()
}

/// True when the process runs in a container: `/.dockerenv` exists or pid 1's cgroup list
/// names docker.
fn in_container(snapshot: &ProcSnapshot) -> bool {
    snapshot.dockerenv
        || snapshot.proc1_cgroup.as_deref().is_some_and(|cgroup| cgroup.contains("docker"))
}

/// The memory figures of a run and which one O-50 judges (O-190).
///
/// In a container the cgroup's `memory.peak` is judged: it is what `docker run --memory`
/// enforces, and it counts every process and the page cache of the container. Outside a
/// container the process's `VmHWM` is judged. With neither, nothing is judged and the
/// verdict fails (the bench report says no true peak was recorded).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeakMemory {
    /// The process's `VmHWM`, Linux only.
    pub peak_rss_bytes: Option<u64>,
    /// The cgroup v2 `memory.peak`, when the file exists.
    pub cgroup_memory_peak_bytes: Option<u64>,
    /// The figure O-50 judges, `None` when no true peak was readable.
    pub judged_peak_bytes: Option<u64>,
    /// [`PEAK_SOURCE_CGROUP`], [`PEAK_SOURCE_VM_HWM`] or [`PEAK_SOURCE_NONE`].
    pub peak_source: String,
}

impl PeakMemory {
    /// The figures of `snapshot`, judging as the type's docs say.
    #[must_use]
    pub fn from_snapshot(snapshot: &ProcSnapshot) -> Self {
        let peak_rss_bytes = snapshot.status.as_deref().and_then(parse_vm_hwm);
        let cgroup_memory_peak_bytes =
            snapshot.cgroup_memory_peak.as_deref().and_then(parse_cgroup_bytes);
        let (judged_peak_bytes, source) = match (in_container(snapshot), cgroup_memory_peak_bytes) {
            (true, Some(bytes)) => (Some(bytes), PEAK_SOURCE_CGROUP),
            _ if peak_rss_bytes.is_some() => (peak_rss_bytes, PEAK_SOURCE_VM_HWM),
            _ => (None, PEAK_SOURCE_NONE),
        };
        Self {
            peak_rss_bytes,
            cgroup_memory_peak_bytes,
            judged_peak_bytes,
            peak_source: source.to_owned(),
        }
    }
}

/// The memory figures now.
#[must_use]
pub fn peak_memory() -> PeakMemory {
    PeakMemory::from_snapshot(&ProcSnapshot::read())
}

/// The machine a run happened on, captured inside the measured process, so a report
/// written elsewhere (the bench report on the host) still names where the run was.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeMachine {
    /// The operating system's long name from sysinfo, for example a Debian release.
    pub os: String,
    /// `<os>/<architecture>` in container platform terms, for example `linux/amd64`.
    pub platform: String,
    /// The first processor's brand.
    pub cpu: String,
    /// Logical cores.
    pub cores: u32,
    /// Memory the kernel reports, rounded to whole gibibytes.
    pub memory_gb: u64,
    /// True when the run was in a container.
    pub container: bool,
    /// The cgroup's `memory.max`, `None` when unlimited or unreadable.
    pub cgroup_memory_limit_bytes: Option<u64>,
}

impl RuntimeMachine {
    /// The machine from sysinfo with the container facts of `snapshot`. Every field has a
    /// floor the report schema accepts (the compile-time names, one core, one gigabyte).
    #[must_use]
    pub fn from_snapshot(snapshot: &ProcSnapshot) -> Self {
        let mut system = sysinfo::System::new();
        system.refresh_cpu_list(sysinfo::CpuRefreshKind::nothing());
        system.refresh_memory_specifics(sysinfo::MemoryRefreshKind::nothing().with_ram());
        let cpu = system
            .cpus()
            .first()
            .map(|cpu| cpu.brand().trim().to_owned())
            .filter(|brand| !brand.is_empty())
            .unwrap_or_else(|| std::env::consts::ARCH.to_owned());
        let os = sysinfo::System::long_os_version()
            .map(|text| text.trim().to_owned())
            .filter(|text| !text.is_empty())
            .unwrap_or_else(|| std::env::consts::OS.to_owned());
        Self {
            os,
            platform: platform(),
            cpu,
            cores: u32::try_from(system.cpus().len()).unwrap_or(u32::MAX).max(1),
            memory_gb: (system.total_memory().saturating_add(BYTES_PER_GIB / 2) / BYTES_PER_GIB)
                .max(1),
            container: in_container(snapshot),
            cgroup_memory_limit_bytes: snapshot
                .cgroup_memory_max
                .as_deref()
                .and_then(parse_cgroup_bytes),
        }
    }
}

/// The machine this process runs on now.
#[must_use]
pub fn runtime_machine() -> RuntimeMachine {
    RuntimeMachine::from_snapshot(&ProcSnapshot::read())
}

/// This build's platform, for example `linux/amd64`.
#[must_use]
pub fn platform() -> String {
    platform_of(std::env::consts::OS, std::env::consts::ARCH)
}

/// `<os>/<arch>` with Rust's architecture names mapped to the container ones
/// (`x86_64` is `amd64`, `aarch64` is `arm64`).
fn platform_of(os: &str, arch: &str) -> String {
    let arch = match arch {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        other => other,
    };
    format!("{os}/{arch}")
}

#[cfg(test)]
mod tests {
    use super::{
        PEAK_SOURCE_CGROUP, PEAK_SOURCE_NONE, PEAK_SOURCE_VM_HWM, PeakMemory, ProcSnapshot,
        RuntimeMachine, in_container, minute_of_day_utc, parse_cgroup_bytes, parse_vm_hwm,
        peak_rss_bytes, platform, platform_of, rfc3339_utc, runtime_machine,
    };

    #[test]
    fn r2_17_epoch_seconds_format_as_utc_rfc3339() {
        assert_eq!(rfc3339_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(rfc3339_utc(951_782_400), "2000-02-29T00:00:00Z", "a leap day");
        assert_eq!(rfc3339_utc(1_793_102_400), "2026-10-27T12:00:00Z");
        assert_eq!(rfc3339_utc(1_798_761_599), "2026-12-31T23:59:59Z");
        assert_eq!(minute_of_day_utc(1_793_102_400), 720);
    }

    #[test]
    fn r2_17_vm_hwm_parses_in_bytes_and_only_linux_has_a_true_peak() {
        let status = "Name:\tx\nVmPeak:\t  9 kB\nVmHWM:\t    2048 kB\nVmRSS:\t 1 kB\n";
        assert_eq!(parse_vm_hwm(status), Some(2_048 * 1_024));
        assert_eq!(parse_vm_hwm("VmRSS: 1 kB"), None);
        assert_eq!(peak_rss_bytes().is_some(), cfg!(target_os = "linux"));
    }

    const STATUS: &str = "VmHWM:\t 1000 kB\n";

    #[test]
    fn r2_17_cgroup_files_parse_as_bytes_or_unlimited() {
        assert_eq!(parse_cgroup_bytes("1595564032\n"), Some(1_595_564_032));
        assert_eq!(parse_cgroup_bytes("max\n"), None);
        assert_eq!(parse_cgroup_bytes("garbage"), None);
    }

    #[test]
    fn r2_17_the_cgroup_peak_is_judged_in_a_container() {
        let snapshot = ProcSnapshot {
            status: Some(STATUS.to_owned()),
            cgroup_memory_peak: Some("6000000000\n".to_owned()),
            dockerenv: true,
            ..ProcSnapshot::default()
        };
        let memory = PeakMemory::from_snapshot(&snapshot);
        assert_eq!(memory.peak_rss_bytes, Some(1_024_000));
        assert_eq!(memory.cgroup_memory_peak_bytes, Some(6_000_000_000));
        assert_eq!(memory.judged_peak_bytes, Some(6_000_000_000));
        assert_eq!(memory.peak_source, PEAK_SOURCE_CGROUP);
    }

    #[test]
    fn r2_17_vm_hwm_is_judged_outside_a_container_and_none_without_either() {
        let host = ProcSnapshot {
            status: Some(STATUS.to_owned()),
            cgroup_memory_peak: Some("6000000000\n".to_owned()),
            proc1_cgroup: Some("0::/init.scope\n".to_owned()),
            ..ProcSnapshot::default()
        };
        let memory = PeakMemory::from_snapshot(&host);
        assert_eq!(memory.judged_peak_bytes, Some(1_024_000));
        assert_eq!(memory.peak_source, PEAK_SOURCE_VM_HWM);
        let bare = PeakMemory::from_snapshot(&ProcSnapshot::default());
        assert_eq!(bare.judged_peak_bytes, None);
        assert_eq!(bare.peak_source, PEAK_SOURCE_NONE);
    }

    #[test]
    fn r2_17_a_container_is_known_by_dockerenv_or_pid_1s_cgroup() {
        assert!(!in_container(&ProcSnapshot::default()));
        let docker_cgroup = ProcSnapshot {
            proc1_cgroup: Some("12:memory:/docker/abc\n".to_owned()),
            ..ProcSnapshot::default()
        };
        assert!(in_container(&docker_cgroup));
        assert!(in_container(&ProcSnapshot { dockerenv: true, ..ProcSnapshot::default() }));
    }

    #[test]
    fn r2_17_the_runtime_machine_records_the_container_and_its_limit() {
        let snapshot = ProcSnapshot {
            cgroup_memory_max: Some("5368709120\n".to_owned()),
            dockerenv: true,
            ..ProcSnapshot::default()
        };
        let machine = RuntimeMachine::from_snapshot(&snapshot);
        assert!(machine.container);
        assert_eq!(machine.cgroup_memory_limit_bytes, Some(5_368_709_120));
        assert_eq!(machine.platform, platform());
        assert!(machine.cores >= 1 && machine.memory_gb >= 1 && !machine.cpu.is_empty());
        assert_ne!(machine.os, "");
        let host = RuntimeMachine::from_snapshot(&ProcSnapshot {
            cgroup_memory_max: Some("max\n".to_owned()),
            ..ProcSnapshot::default()
        });
        assert!(!host.container);
        assert_eq!(host.cgroup_memory_limit_bytes, None);
        assert!(runtime_machine().cores >= 1);
    }

    #[test]
    fn r2_17_platforms_use_container_architecture_names() {
        assert_eq!(platform_of("linux", "x86_64"), "linux/amd64");
        assert_eq!(platform_of("linux", "aarch64"), "linux/arm64");
        assert_eq!(platform_of("windows", "x86"), "windows/x86");
    }
}
