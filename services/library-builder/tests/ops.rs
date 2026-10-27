//! The operations surface (R2.18, O-207): `/metrics` scrapes as Prometheus text with every
//! family, and `/healthz` reports the state, the dependencies and the settings errors,
//! answering 503 only when a configured dependency does not answer.

use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use library_builder::notify::BuilderState;
use library_builder::ops::{
    HealthBody, METRIC_FAMILIES, OpsState, PROBE_CACHE_TTL, PROBE_TIMEOUT, Probes, Status,
    health_body_with, render_metrics, router,
};
use library_builder::settings::SettingError;
use library_builder::store::LibraryTarget;
use tower::ServiceExt;

fn state(status: Arc<Status>, target: Option<LibraryTarget>) -> OpsState {
    OpsState { status, database: None, target, worker_id: "test-worker".to_owned() }
}

async fn get(state: OpsState, path: &str) -> (StatusCode, Option<String>, String) {
    let response = router(state)
        .oneshot(Request::get(path).body(Body::empty()).expect("a request"))
        .await
        .expect("the router answers");
    let status = response.status();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let bytes = response.into_body().collect().await.expect("the body").to_bytes();
    (status, content_type, String::from_utf8(bytes.to_vec()).expect("text"))
}

#[tokio::test]
async fn r2_18_metrics_scrape_carries_every_family() {
    let status = Arc::new(Status::default());
    status.count_job("done");
    status.count_job("done");
    status.count_job("parked");
    status.record_line(12.5, 400);
    status.update(|view| {
        view.state = BuilderState::Running;
        view.queue_depth = vec![("queued".to_owned(), 7), ("failed".to_owned(), 1)];
        view.storage_used_bytes = 1_234;
        view.storage_budget_bytes = 650_000_000_000;
        view.last_exploitability_pct_pot = Some([0.2, 0.25]);
    });
    let (code, content_type, body) = get(state(status, None), "/metrics").await;
    assert_eq!(code, StatusCode::OK);
    assert!(content_type.is_some_and(|value| value.starts_with("text/plain")), "content type");
    for family in METRIC_FAMILIES {
        assert!(body.contains(&format!("# TYPE {family} ")), "{family} is missing:\n{body}");
    }
    assert!(body.contains("builder_jobs_total{outcome=\"done\"} 2"), "{body}");
    assert!(body.contains("builder_jobs_total{outcome=\"parked\"} 1"), "{body}");
    assert!(body.contains("builder_queue_depth{status=\"queued\"} 7"), "{body}");
    assert!(body.contains("builder_storage_used_bytes 1234"), "{body}");
    assert!(body.contains("builder_line_seconds_count 1"), "{body}");
    assert!(body.contains("builder_line_iterations_total 400"), "{body}");
    assert!(body.contains("builder_last_exploitability_pct_pot{seat=\"oop\"} 0.2"), "{body}");
    assert!(body.contains("builder_up 1"), "{body}");
    for line in body.lines().filter(|line| !line.starts_with('#') && !line.is_empty()) {
        let value = line.rsplit(' ').next().expect("a value");
        assert!(value.parse::<f64>().is_ok(), "not a sample line: {line}");
    }
}

#[test]
fn r2_18_render_metrics_names_the_state() {
    let status = Status::default();
    status.update(|view| view.state = BuilderState::Paused);
    let text = render_metrics(&status.view(), Some(42));
    assert!(text.contains("builder_peak_rss_bytes 42"), "{text}");
    assert!(text.contains("builder_state{state=\"paused\"} 1"), "{text}");
    assert!(text.contains("builder_state{state=\"running\"} 0"), "{text}");
}

/// Where no true peak is available the family keeps its HELP and TYPE lines and has no
/// sample, rather than a current figure passed off as a peak.
#[test]
fn r2_18_peak_rss_has_no_sample_without_a_true_peak() {
    let text = render_metrics(&Status::default().view(), None);
    assert!(text.contains("# HELP builder_peak_rss_bytes "), "{text}");
    assert!(text.contains("# TYPE builder_peak_rss_bytes gauge"), "{text}");
    assert!(!text.lines().any(|line| line.starts_with("builder_peak_rss_bytes")), "{text}");
}

#[tokio::test]
async fn r2_18_healthz_reports_unconfigured_dependencies_as_healthy() {
    let (code, content_type, body) =
        get(state(Arc::new(Status::default()), None), "/healthz").await;
    assert_eq!(code, StatusCode::OK);
    assert!(content_type.is_some_and(|value| value.starts_with("application/json")));
    let health: HealthBody = serde_json::from_str(&body).expect("the health body");
    assert_eq!(health.status, "ok");
    assert_eq!(health.version, env!("CARGO_PKG_VERSION"));
    assert_eq!(health.worker_id, "test-worker");
    assert_eq!(health.state, "idle");
    assert_eq!(health.database, "unconfigured");
    assert_eq!(health.store.kind, "unconfigured");
    assert!(!health.store.reachable);
    assert_eq!(health.settings_errors, Vec::<String>::new());
}

#[tokio::test]
async fn r2_18_healthz_lists_the_settings_errors_and_the_store() {
    let dir = tempfile::tempdir().expect("a scratch directory");
    let status = Arc::new(Status::default());
    status.update(|view| {
        view.settings_errors = vec![SettingError {
            key: "cpu_share".to_owned(),
            reason: "not a number; the default 0.5 is used".to_owned(),
        }];
        view.current_job = Some("job-1".to_owned());
    });
    let target = LibraryTarget::Fs { root: dir.path().to_path_buf() };
    let (code, _, body) = get(state(status, Some(target)), "/healthz").await;
    assert_eq!(code, StatusCode::OK);
    let health: HealthBody = serde_json::from_str(&body).expect("the health body");
    assert_eq!(health.store.kind, "fs");
    assert!(health.store.reachable);
    assert_eq!(health.current_job.as_deref(), Some("job-1"));
    assert_eq!(health.settings_errors.len(), 1);
    assert!(health.settings_errors[0].starts_with("cpu_share: "), "{:?}", health.settings_errors);
}

#[tokio::test]
async fn r2_18_healthz_answers_503_when_the_store_does_not_answer() {
    let dir = tempfile::tempdir().expect("a scratch directory");
    let missing = dir.path().join("not-there");
    let target = LibraryTarget::Fs { root: missing };
    let (code, _, body) = get(state(Arc::new(Status::default()), Some(target)), "/healthz").await;
    assert_eq!(code, StatusCode::SERVICE_UNAVAILABLE);
    let health: HealthBody = serde_json::from_str(&body).expect("the health body");
    assert_eq!(health.status, "degraded");
    assert!(!health.store.reachable);
}

#[tokio::test]
async fn r2_18_unknown_paths_are_not_found() {
    let (code, _, _) = get(state(Arc::new(Status::default()), None), "/admin").await;
    assert_eq!(code, StatusCode::NOT_FOUND);
}

/// Fake probes: each answers after `delay`, and every database probe started is counted.
struct SlowProbes {
    delay: std::time::Duration,
    started: Arc<std::sync::atomic::AtomicUsize>,
}

impl SlowProbes {
    fn new(millis: u64) -> Self {
        SlowProbes {
            delay: std::time::Duration::from_millis(millis),
            started: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
        }
    }

    fn started(&self) -> usize {
        self.started.load(std::sync::atomic::Ordering::SeqCst)
    }
}

impl Probes for SlowProbes {
    fn database(&self) -> Option<impl std::future::Future<Output = bool> + Send> {
        self.started.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let delay = self.delay;
        Some(async move {
            tokio::time::sleep(delay).await;
            true
        })
    }

    fn store(&self) -> Option<(&'static str, impl std::future::Future<Output = bool> + Send)> {
        let delay = self.delay;
        Some(("fs", async move {
            tokio::time::sleep(delay).await;
            true
        }))
    }
}

/// The two probes run at the same time: two of 1.2 s answer in well under their 2.4 s sum
/// (S18 review MEDIUM 9).
#[tokio::test]
async fn r2_18_healthz_runs_the_probes_concurrently() {
    let probes = SlowProbes::new(1_200);
    let started = std::time::Instant::now();
    let health = health_body_with(&state(Arc::new(Status::default()), None), &probes).await;
    let elapsed = started.elapsed();
    assert!(elapsed < std::time::Duration::from_millis(2_000), "took {elapsed:?}");
    assert_eq!(health.status, "ok");
    assert_eq!(health.database, "ok");
    assert!(health.store.reachable);
}

/// Each probe is bounded by `PROBE_TIMEOUT`: a probe that hangs answers `unavailable` and
/// `/healthz` still answers within about 2 s.
#[tokio::test]
async fn r2_18_a_hung_probe_is_cut_at_the_timeout() {
    let probes = SlowProbes::new(30_000);
    let started = std::time::Instant::now();
    let health = health_body_with(&state(Arc::new(Status::default()), None), &probes).await;
    let elapsed = started.elapsed();
    assert!(elapsed < PROBE_TIMEOUT + std::time::Duration::from_millis(800), "took {elapsed:?}");
    assert_eq!(health.status, "degraded");
    assert_eq!(health.database, "unavailable");
    assert!(!health.store.reachable);
}

/// Concurrent requests share one in-flight probe, and its answer is reused for
/// `PROBE_CACHE_TTL`, so a flood of `/healthz` cannot drain the 4-connection pool (S18
/// review L3).
#[tokio::test]
async fn r2_18_concurrent_healthz_requests_share_one_probe() {
    assert_eq!(PROBE_CACHE_TTL, std::time::Duration::from_secs(5));
    let probes = Arc::new(SlowProbes::new(200));
    let ops = state(Arc::new(Status::default()), None);
    let mut requests = tokio::task::JoinSet::new();
    for _ in 0..16 {
        let (ops, probes) = (ops.clone(), Arc::clone(&probes));
        requests.spawn(async move { health_body_with(&ops, probes.as_ref()).await });
    }
    while let Some(answer) = requests.join_next().await {
        assert_eq!(answer.expect("the request task").database, "ok");
    }
    assert_eq!(probes.started(), 1, "sixteen requests, one probe");
    let _ = health_body_with(&ops, probes.as_ref()).await;
    assert_eq!(probes.started(), 1, "a request inside the cache window reuses the answer");
}
