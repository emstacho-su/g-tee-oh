//! `GET /healthz` blocks and `GET /metrics` (R2.13, plan D.4, A9 section 4, O-155).
//! Written red in S16 step 2: the health blocks report zeros and `/metrics` is a stub
//! answering 501 until lane D lands the registry gauges and the Prometheus text.

mod common;

use axum::http::{StatusCode, header};
use gto_library::DEFAULT_QUERY_CACHE_BYTES;

use common::{get, get_node, packed_fixture};

/// The Prometheus exposition media type.
const METRICS_CONTENT_TYPE: &str = "text/plain; version=0.0.4";

#[tokio::test]
async fn r2_13_healthz_reports_library_and_database_blocks() {
    let fixture = packed_fixture();
    let router = fixture.router();

    let (status, _, json) = get(router.clone(), "/healthz").await;

    assert_eq!(status, StatusCode::OK, "body was {json}");
    assert_eq!(json["status"], "ok", "the S06 fields are unchanged: {json}");
    assert_eq!(json["service"], "solver-query", "{json}");
    assert_eq!(json["version"], env!("CARGO_PKG_VERSION"), "{json}");
    assert_eq!(json["fixture_library"]["path"], fixture.root.to_string_lossy().as_ref(), "{json}");
    assert_eq!(json["fixture_library"]["present"], true, "{json}");
    let library = &json["library"];
    assert_eq!(library["indexed"], 1, "the startup scan indexed the fixture: {json}");
    assert_eq!(library["unavailable"], 0, "{json}");
    assert!(library["cache_used_bytes"].is_u64(), "{json}");
    assert_eq!(
        library["cache_bytes"], DEFAULT_QUERY_CACHE_BYTES,
        "no QUERY_CACHE_BYTES set: {json}"
    );
    let database = &json["database"];
    assert_eq!(database["configured"], false, "no QUERY_DB_PASSWORD set: {json}");
    assert_eq!(database["connected"], false, "{json}");
    assert!(database["role"].is_null(), "{json}");

    let (status, _, node) =
        get_node(router.clone(), &fixture.solution_id, &fixture.key(0), None).await;
    assert_eq!(status, StatusCode::OK, "body was {node}");
    let (_, _, json) = get(router, "/healthz").await;
    assert!(
        json["library"]["cache_used_bytes"].as_u64().is_some_and(|b| b > 0),
        "a read caches a frame: {json}"
    );
}

#[tokio::test]
async fn r2_13_metrics_exposes_prometheus_text() {
    let fixture = packed_fixture();
    let router = fixture.router();
    let (status, _, node) =
        get_node(router.clone(), &fixture.solution_id, &fixture.key(0), None).await;
    assert_eq!(status, StatusCode::OK, "body was {node}");

    let (status, headers, body) = get(router, "/metrics").await;

    assert_eq!(status, StatusCode::OK, "body was {body}");
    let content_type = headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok());
    assert_eq!(content_type, Some(METRICS_CONTENT_TYPE));
    let text = body.as_str().expect("the exposition is text");
    for expected in [
        "# TYPE solver_query_requests_total counter",
        "solver_query_requests_total{route=\"/v1/nodes\",status=\"200\"} 1",
        "# TYPE solver_query_request_seconds histogram",
        "solver_query_request_seconds_bucket{",
        "# TYPE solver_query_cache_used_bytes gauge",
        "solver_query_cache_used_bytes ",
        "# TYPE solver_query_cache_bytes gauge",
        "solver_query_solutions_indexed 1",
        "solver_query_solutions_unavailable 0",
        "solver_query_db_connected 0",
        "solver_query_deals_held 0",
    ] {
        assert!(text.contains(expected), "missing {expected:?} in:\n{text}");
    }
    assert!(text.ends_with('\n'), "the exposition ends with a newline");
}
