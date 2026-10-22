//! The request counters, the latency histogram and the gauges behind `GET /metrics`
//! (R2.13, A9 section 4, O-155, plan C.8), hand-rolled with no crate.
//!
//! Mechanism: the latency middleware calls `Metrics::observe` on every request with the
//! matched route pattern (so the label set stays bounded), the final status and the
//! elapsed time; one mutex guards the counters and the histogram. `Metrics::render` writes
//! the Prometheus text exposition (version 0.0.4): `solver_query_requests_total{route,
//! status}`, the `solver_query_request_seconds` histogram with the cumulative
//! `LATENCY_BUCKETS_SECONDS` bounds and `+Inf`, then the gauges the route reads at scrape
//! time (`Gauges`): the reader's cache (`solver_query_cache_used_bytes`,
//! `solver_query_cache_bytes`), the registry (`solver_query_solutions_indexed`,
//! `solver_query_solutions_unavailable`), the role probe (`solver_query_db_connected`) and
//! the deal store (`solver_query_deals_held`). A cache hit rate waits for hit and miss
//! counters in the reader (O-155).

use std::collections::BTreeMap;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use crate::library::LibraryStats;

/// The upper bounds of the `solver_query_request_seconds` histogram, 1 ms to 1 s.
pub const LATENCY_BUCKETS_SECONDS: [f64; 10] =
    [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0];

/// The request counter, labelled by matched route and status.
pub const REQUESTS_TOTAL: &str = "solver_query_requests_total";
/// The latency histogram.
pub const REQUEST_SECONDS: &str = "solver_query_request_seconds";
/// The bytes of decoded frames the reader's cache holds.
pub const CACHE_USED_BYTES: &str = "solver_query_cache_used_bytes";
/// The reader's cache budget.
pub const CACHE_BYTES: &str = "solver_query_cache_bytes";
/// How many solutions the startup scan indexed.
pub const SOLUTIONS_INDEXED: &str = "solver_query_solutions_indexed";
/// How many solutions the reader marked unavailable since startup.
pub const SOLUTIONS_UNAVAILABLE: &str = "solver_query_solutions_unavailable";
/// 1 when the role probe answered on this scrape, else 0.
pub const DB_CONNECTED: &str = "solver_query_db_connected";
/// How many deals the store holds.
pub const DEALS_HELD: &str = "solver_query_deals_held";

/// The label of the histogram's last, unbounded bucket.
const INF_BUCKET: &str = "+Inf";

/// What every request leaves behind.
#[derive(Debug, Default)]
struct Observed {
    /// `solver_query_requests_total{route,status}`.
    requests: BTreeMap<(String, u16), u64>,
    /// `solver_query_request_seconds_bucket`, one count per `LATENCY_BUCKETS_SECONDS`
    /// bound, each the count of requests at or under it (cumulative, as Prometheus reads).
    latency_buckets: [u64; LATENCY_BUCKETS_SECONDS.len()],
    /// `solver_query_request_seconds_count`.
    latency_count: u64,
    /// `solver_query_request_seconds_sum`.
    latency_sum_seconds: f64,
}

/// The registry, shared through `AppState` and written by the latency middleware.
#[derive(Debug, Default)]
pub struct Metrics {
    observed: Mutex<Observed>,
}

/// The values the route reads at scrape time, outside the registry.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Gauges {
    /// The registry and cache figures (`Library::stats`).
    pub library: LibraryStats,
    /// Whether the role probe answered.
    pub db_connected: bool,
    /// How many deals the store holds (`DealStore::held`).
    pub deals_held: usize,
}

impl Metrics {
    /// An empty registry.
    #[must_use]
    pub fn new() -> Metrics {
        Metrics::default()
    }

    /// Records one request: the route pattern, the final status and the elapsed time.
    pub fn observe(&self, route: &str, status: u16, latency: Duration) {
        let seconds = latency.as_secs_f64();
        let mut observed = self.lock();
        *observed.requests.entry((route.to_owned(), status)).or_insert(0) += 1;
        for (bucket, bound) in observed.latency_buckets.iter_mut().zip(LATENCY_BUCKETS_SECONDS) {
            if seconds <= bound {
                *bucket += 1;
            }
        }
        observed.latency_count += 1;
        observed.latency_sum_seconds += seconds;
    }

    /// How many requests were recorded under `route` with `status`.
    #[must_use]
    pub fn request_count(&self, route: &str, status: u16) -> u64 {
        self.lock().requests.get(&(route.to_owned(), status)).copied().unwrap_or(0)
    }

    /// How many requests were recorded in all.
    #[must_use]
    pub fn requests_observed(&self) -> u64 {
        self.lock().latency_count
    }

    /// The Prometheus text exposition: the counters and the histogram recorded so far, then
    /// `gauges`. Every line ends with a newline, as the format requires.
    #[must_use]
    pub fn render(&self, gauges: &Gauges) -> String {
        let mut lines = Vec::new();
        {
            let observed = self.lock();
            render_requests(&mut lines, &observed.requests);
            render_latency(&mut lines, &observed);
        }
        render_gauges(&mut lines, gauges);
        let mut text = lines.join("\n");
        text.push('\n');
        text
    }

    /// The state; every update is a few counter increments, so a poisoned lock is reused.
    fn lock(&self) -> MutexGuard<'_, Observed> {
        self.observed.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// The counter family, one line per (route, status) seen.
fn render_requests(lines: &mut Vec<String>, requests: &BTreeMap<(String, u16), u64>) {
    lines.push(format!("# HELP {REQUESTS_TOTAL} Requests answered, by matched route and status."));
    lines.push(format!("# TYPE {REQUESTS_TOTAL} counter"));
    for ((route, status), count) in requests {
        let route = escape_label(route);
        lines.push(format!("{REQUESTS_TOTAL}{{route=\"{route}\",status=\"{status}\"}} {count}"));
    }
}

/// The histogram family: the cumulative buckets, `+Inf`, the sum and the count.
fn render_latency(lines: &mut Vec<String>, observed: &Observed) {
    lines.push(format!("# HELP {REQUEST_SECONDS} Request latency in seconds."));
    lines.push(format!("# TYPE {REQUEST_SECONDS} histogram"));
    for (bound, count) in LATENCY_BUCKETS_SECONDS.iter().zip(observed.latency_buckets) {
        lines.push(format!("{REQUEST_SECONDS}_bucket{{le=\"{bound}\"}} {count}"));
    }
    let total = observed.latency_count;
    lines.push(format!("{REQUEST_SECONDS}_bucket{{le=\"{INF_BUCKET}\"}} {total}"));
    lines.push(format!("{REQUEST_SECONDS}_sum {}", observed.latency_sum_seconds));
    lines.push(format!("{REQUEST_SECONDS}_count {total}"));
}

/// The gauges, each with its HELP and TYPE lines.
fn render_gauges(lines: &mut Vec<String>, gauges: &Gauges) {
    let library = gauges.library;
    let db_connected = u8::from(gauges.db_connected);
    let rows: [(&str, &str, u64); 6] = [
        (
            CACHE_USED_BYTES,
            "Bytes of decoded frames the reader's cache holds.",
            library.cache_used_bytes,
        ),
        (CACHE_BYTES, "The reader's cache budget in bytes.", library.cache_bytes),
        (SOLUTIONS_INDEXED, "Solutions the startup scan indexed.", u64::from(library.indexed)),
        (
            SOLUTIONS_UNAVAILABLE,
            "Solutions the reader marked unavailable since startup.",
            u64::from(library.unavailable),
        ),
        (
            DB_CONNECTED,
            "1 when the query-role probe answered on this scrape.",
            u64::from(db_connected),
        ),
        (
            DEALS_HELD,
            "Deals the store holds.",
            u64::try_from(gauges.deals_held).unwrap_or(u64::MAX),
        ),
    ];
    for (name, help, value) in rows {
        lines.push(format!("# HELP {name} {help}"));
        lines.push(format!("# TYPE {name} gauge"));
        lines.push(format!("{name} {value}"));
    }
}

/// A label value as the exposition format writes it: backslash, double quote and line
/// feed escaped. Route patterns hold none of them, so this is for correctness, not need.
fn escape_label(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n")
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{
        CACHE_BYTES, DB_CONNECTED, DEALS_HELD, Gauges, LATENCY_BUCKETS_SECONDS, Metrics,
        REQUEST_SECONDS, REQUESTS_TOTAL, SOLUTIONS_INDEXED, escape_label,
    };
    use crate::library::LibraryStats;

    fn gauges() -> Gauges {
        let library =
            LibraryStats { indexed: 3, unavailable: 1, cache_used_bytes: 4096, cache_bytes: 65536 };
        Gauges { library, db_connected: true, deals_held: 2 }
    }

    #[test]
    fn r2_13_metrics_render_counts_requests_by_route_and_status() {
        let metrics = Metrics::new();
        metrics.observe("/v1/nodes", 200, Duration::from_millis(2));
        metrics.observe("/v1/nodes", 200, Duration::from_millis(3));
        metrics.observe("/v1/grade", 400, Duration::from_micros(500));

        let text = metrics.render(&gauges());

        assert!(text.contains(&format!("# TYPE {REQUESTS_TOTAL} counter\n")), "{text}");
        assert!(
            text.contains(&format!("{REQUESTS_TOTAL}{{route=\"/v1/nodes\",status=\"200\"}} 2\n"))
        );
        assert!(
            text.contains(&format!("{REQUESTS_TOTAL}{{route=\"/v1/grade\",status=\"400\"}} 1\n"))
        );
        assert!(text.ends_with('\n'));
        assert_eq!(metrics.request_count("/v1/nodes", 200), 2);
        assert_eq!(metrics.requests_observed(), 3);
    }

    #[test]
    fn r2_13_metrics_render_histogram_is_cumulative_and_ends_with_inf() {
        let metrics = Metrics::new();
        metrics.observe("/healthz", 200, Duration::from_micros(500));
        metrics.observe("/healthz", 200, Duration::from_millis(30));
        metrics.observe("/healthz", 200, Duration::from_secs(5));

        let text = metrics.render(&gauges());

        assert!(text.contains(&format!("# TYPE {REQUEST_SECONDS} histogram\n")), "{text}");
        assert!(text.contains(&format!("{REQUEST_SECONDS}_bucket{{le=\"0.001\"}} 1\n")), "{text}");
        assert!(text.contains(&format!("{REQUEST_SECONDS}_bucket{{le=\"0.05\"}} 2\n")), "{text}");
        assert!(text.contains(&format!("{REQUEST_SECONDS}_bucket{{le=\"1\"}} 2\n")), "{text}");
        assert!(text.contains(&format!("{REQUEST_SECONDS}_bucket{{le=\"+Inf\"}} 3\n")), "{text}");
        assert!(text.contains(&format!("{REQUEST_SECONDS}_count 3\n")), "{text}");
        let sum_prefix = format!("{REQUEST_SECONDS}_sum ");
        let sum_line = text.lines().find(|l| l.starts_with(&sum_prefix)).expect("a sum line");
        let sum: f64 = sum_line[sum_prefix.len()..].parse().expect("the sum is a number");
        assert!((sum - 5.0305).abs() < 1e-9, "{sum}");
        let bucket_lines = text.lines().filter(|l| l.contains("_bucket{")).count();
        assert_eq!(bucket_lines, LATENCY_BUCKETS_SECONDS.len() + 1);
    }

    #[test]
    fn r2_13_metrics_render_writes_every_gauge_with_type_lines() {
        let text = Metrics::new().render(&gauges());

        for expected in [
            format!("# TYPE {CACHE_BYTES} gauge\n{CACHE_BYTES} 65536\n"),
            format!("# TYPE {SOLUTIONS_INDEXED} gauge\n{SOLUTIONS_INDEXED} 3\n"),
            "solver_query_solutions_unavailable 1\n".to_owned(),
            "solver_query_cache_used_bytes 4096\n".to_owned(),
            format!("{DB_CONNECTED} 1\n"),
            format!("{DEALS_HELD} 2\n"),
        ] {
            assert!(text.contains(&expected), "missing {expected:?} in:\n{text}");
        }
        let off = Gauges { db_connected: false, ..gauges() };
        assert!(Metrics::new().render(&off).contains(&format!("{DB_CONNECTED} 0\n")));
    }

    #[test]
    fn r2_13_metrics_escape_label_quotes_backslashes_and_newlines() {
        assert_eq!(escape_label("/v1/deal/{id}/reveal"), "/v1/deal/{id}/reveal");
        assert_eq!(escape_label("a\\b\"c\nd"), "a\\\\b\\\"c\\nd");
    }
}
