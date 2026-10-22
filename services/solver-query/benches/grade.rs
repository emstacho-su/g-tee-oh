//! Grade benchmark (R2.13, A9 section 6, O-86, O-154): one `POST /v1/grade` through the
//! router in process, id `grade/warm_cache`. The number covers the request-id and latency
//! middleware, JSON parsing, the key and hand parsing, the reader's warm-cache node read,
//! the grade math and the serialization, but no socket. `scripts/bench-report.mjs` reads
//! the 95th percentile from criterion's `sample.json` and `scripts/check-reports.mjs`
//! holds the 30 ms budget (plan D.7).
//!
//! Mechanism: the packed synthetic fixture of the integration tests (`tests/common`, seed
//! 7, 40 dense `preflop_169` nodes packed by library-pack into a temporary directory) is
//! served through `AppState::from_config` and `app_with`, so the startup scan and the real
//! reader are in the path. One warming request opens the solution (which checksums its
//! chunks) and decodes the frame; the routine then grades the first node's `AA` on its
//! first action with `tower::ServiceExt::oneshot` on a current-thread runtime, the body
//! behind `black_box`. Sample count and measurement time are modest: the request is
//! sub-millisecond warm and the fixture build dominates the run.

#![forbid(unsafe_code)]

#[path = "../tests/common/mod.rs"]
mod common;

use std::hint::black_box;
use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use criterion::{Criterion, criterion_group, criterion_main};
use tokio::runtime::Runtime;
use tower::ServiceExt;

use common::{Fixture, packed_fixture};

/// The hand graded, the first class of the index.
const HAND: &str = "AA";
/// The action graded: index 0, the fold every synthetic node offers.
const ACTION_INDEX: u8 = 0;
/// Samples per run, modest because the request is sub-millisecond (O-154).
const SAMPLE_SIZE: usize = 60;
/// Measurement time per run.
const MEASUREMENT_SECONDS: u64 = 3;

/// The grade request body for the fixture's first node.
fn request_body(fixture: &Fixture) -> String {
    serde_json::json!({
        "solution_id": fixture.solution_id,
        "node_key": fixture.key(0),
        "hand": HAND,
        "action_index": ACTION_INDEX,
        "reference": "bench",
    })
    .to_string()
}

/// One `POST /v1/grade` with `body`.
fn grade_request(body: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/v1/grade")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_owned()))
        .expect("a valid request")
}

/// Sends one grade through `router` and returns its status.
async fn grade_once(router: Router, body: &str) -> StatusCode {
    let response = router.oneshot(grade_request(body)).await.expect("the router answers");
    response.status()
}

fn bench_grade(c: &mut Criterion) {
    let fixture = packed_fixture();
    let router = fixture.router();
    let body = request_body(&fixture);
    let runtime = Runtime::new().expect("a tokio runtime");
    let warmed = runtime.block_on(grade_once(router.clone(), &body));
    assert_eq!(warmed, StatusCode::OK, "the warming grade answers 200");
    let mut group = c.benchmark_group("grade");
    group.sample_size(SAMPLE_SIZE).measurement_time(Duration::from_secs(MEASUREMENT_SECONDS));
    group.bench_function("warm_cache", |b| {
        b.iter(|| runtime.block_on(grade_once(router.clone(), black_box(&body))));
    });
    group.finish();
}

criterion_group!(benches, bench_grade);
criterion_main!(benches);
