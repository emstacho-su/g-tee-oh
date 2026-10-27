//! The clock and the process figures a job records: the UTC time as RFC 3339 (the
//! manifest's `created_at`), the minute of the day the boost window is judged at (O-13),
//! and the peak resident set size the summary and the bench report carry (O-190).

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

/// The process's peak resident set size in bytes: `VmHWM` from `/proc/self/status` on
/// Linux, sysinfo's current figure elsewhere.
#[must_use]
pub fn peak_rss_bytes() -> u64 {
    #[cfg(target_os = "linux")]
    if let Some(bytes) =
        std::fs::read_to_string("/proc/self/status").ok().as_deref().and_then(parse_vm_hwm)
    {
        return bytes;
    }
    current_rss_bytes()
}

/// The `VmHWM` line of a `/proc/<pid>/status` text in bytes.
#[cfg(any(target_os = "linux", test))]
fn parse_vm_hwm(status: &str) -> Option<u64> {
    let line = status.lines().find_map(|line| line.strip_prefix("VmHWM:"))?;
    let kibibytes = line.trim().strip_suffix("kB")?.trim().parse::<u64>().ok()?;
    kibibytes.checked_mul(1_024)
}

/// The process's current resident set size from sysinfo, 0 when it cannot be read.
fn current_rss_bytes() -> u64 {
    let Ok(pid) = sysinfo::get_current_pid() else {
        tracing::warn!("the current process id is unavailable; peak RSS reads 0");
        return 0;
    };
    let mut system = sysinfo::System::new();
    system.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::Some(&[pid]),
        true,
        sysinfo::ProcessRefreshKind::nothing().with_memory(),
    );
    system.process(pid).map_or(0, sysinfo::Process::memory)
}

#[cfg(test)]
mod tests {
    use super::{minute_of_day_utc, parse_vm_hwm, peak_rss_bytes, rfc3339_utc};

    #[test]
    fn r2_17_epoch_seconds_format_as_utc_rfc3339() {
        assert_eq!(rfc3339_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(rfc3339_utc(951_782_400), "2000-02-29T00:00:00Z", "a leap day");
        assert_eq!(rfc3339_utc(1_793_102_400), "2026-10-27T12:00:00Z");
        assert_eq!(rfc3339_utc(1_798_761_599), "2026-12-31T23:59:59Z");
        assert_eq!(minute_of_day_utc(1_793_102_400), 720);
    }

    #[test]
    fn r2_17_vm_hwm_parses_in_bytes_and_rss_is_measured() {
        let status = "Name:\tx\nVmPeak:\t  9 kB\nVmHWM:\t    2048 kB\nVmRSS:\t 1 kB\n";
        assert_eq!(parse_vm_hwm(status), Some(2_048 * 1_024));
        assert_eq!(parse_vm_hwm("VmRSS: 1 kB"), None);
        assert!(peak_rss_bytes() > 0);
    }
}
