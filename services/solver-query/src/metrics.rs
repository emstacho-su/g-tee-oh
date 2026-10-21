#![allow(unused_variables, dead_code, reason = "S16 stub: lane D fills this file")]
//! The request counters, the latency histogram and the gauges behind `GET /metrics`
//! (R2.13, A9 section 4, O-155, plan C.8), hand-rolled with no crate.
//!
//! S16 lands the shape the latency middleware needs: `Metrics::new`, `Metrics::observe`
//! (called on every request with the matched route, the final status and the elapsed
//! time) and the counts read back. Lane D adds the gauges (`solver_query_cache_used_bytes`,
//! `solver_query_cache_bytes`, `solver_query_solutions_indexed`,
//! `solver_query_solutions_unavailable`, `solver_query_db_connected`,
//! `solver_query_deals_held`) and the Prometheus text renderer
//! (`text/plain; version=0.0.4`) that `routes::metrics` serves, and removes the allowance
//! at the top of this file.

use std::collections::BTreeMap;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

/// The upper bounds of the `solver_query_request_seconds` histogram, 1 ms to 1 s.
pub const LATENCY_BUCKETS_SECONDS: [f64; 10] =
    [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0];

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

    /// The state; every update is a few counter increments, so a poisoned lock is reused.
    fn lock(&self) -> MutexGuard<'_, Observed> {
        self.observed.lock().unwrap_or_else(PoisonError::into_inner)
    }
}
