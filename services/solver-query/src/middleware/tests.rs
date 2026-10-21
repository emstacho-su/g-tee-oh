//! Middleware tests (R2.13, O-158) over a two-route router mounted the way `app_with`
//! mounts the real one: a route that fails with an `ApiError`, a route that takes a JSON
//! body, a small body limit, then `request_id`, then `latency`.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Json};
use axum::http::{Request, StatusCode, header};
use axum::middleware::{from_fn, from_fn_with_state};
use axum::routing::{get, post};
use axum::{Router, response::IntoResponse};
use http_body_util::BodyExt;
use serde::Deserialize;
use serde_json::Value;
use tower::ServiceExt;

use super::{
    METHOD_NOT_ALLOWED_TAG, PAYLOAD_TOO_LARGE_TAG, REQUEST_ID_HEADER, UNMATCHED_ROUTE,
    generate_request_id, latency, request_id,
};
use crate::api::problem::{PROBLEM_JSON, PROBLEM_TYPE_PREFIX};
use crate::error::ApiError;
use crate::metrics::Metrics;

/// The body limit of the test router, small enough to exceed with one line.
const BODY_LIMIT: usize = 64;

#[derive(Deserialize)]
struct Seeded {
    seed: String,
}

async fn fails() -> Result<(), ApiError> {
    Err(ApiError::NotFound("no such deal".to_owned()))
}

async fn echoes(Json(body): Json<Seeded>) -> impl IntoResponse {
    body.seed
}

fn router(metrics: &Arc<Metrics>) -> Router {
    Router::new()
        .route("/fails", get(fails))
        .route("/json", post(echoes))
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .layer(from_fn(request_id))
        .layer(from_fn_with_state(Arc::clone(metrics), latency))
}

async fn send(router: Router, request: Request<Body>) -> (StatusCode, Option<String>, Value) {
    let response = router.oneshot(request).await.expect("the router answers");
    let status = response.status();
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let id =
        response.headers().get(REQUEST_ID_HEADER).and_then(|v| v.to_str().ok()).map(str::to_owned);
    let bytes = response.into_body().collect().await.expect("a body").to_bytes();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    assert!(id.is_some(), "every answer carries {REQUEST_ID_HEADER}");
    (status, content_type.zip(id).map(|(c, i)| format!("{c}|{i}")), json)
}

fn get_request(uri: &str, request_id: Option<&str>) -> Request<Body> {
    let mut builder = Request::builder().uri(uri);
    if let Some(id) = request_id {
        builder = builder.header(REQUEST_ID_HEADER, id);
    }
    builder.body(Body::empty()).expect("a request")
}

fn post_json(uri: &str, body: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_owned()))
        .expect("a request")
}

fn assert_problem(status: StatusCode, meta: Option<&str>, json: &Value, code: u16, tag: &str) {
    assert_eq!(status.as_u16(), code, "{json}");
    let (content_type, id) = meta.and_then(|m| m.split_once('|')).expect("content type and id");
    assert_eq!(content_type, PROBLEM_JSON, "{json}");
    assert_eq!(json["type"], format!("{PROBLEM_TYPE_PREFIX}{tag}"), "{json}");
    assert_eq!(json["status"], u64::from(code), "{json}");
    assert_eq!(json["instance"], id, "the instance is the echoed id: {json}");
    assert!(json["detail"].as_str().is_some_and(|d| !d.is_empty()), "{json}");
}

#[tokio::test]
async fn r2_13_request_id_is_echoed_or_generated_and_fills_the_problem_instance() {
    let metrics = Arc::new(Metrics::new());

    let (status, meta, json) = send(router(&metrics), get_request("/fails", Some("abc-123"))).await;
    assert_problem(status, meta.as_deref(), &json, 404, "not-found");
    assert_eq!(json["instance"], "abc-123");
    assert_eq!(json["detail"], "no such deal");

    let (_, meta, json) = send(router(&metrics), get_request("/fails", None)).await;
    let id = json["instance"].as_str().expect("a generated id").to_owned();
    assert_eq!(id.len(), 16, "{id}");
    assert!(id.bytes().all(|b| b.is_ascii_hexdigit()), "{id}");
    assert!(meta.is_some_and(|m| m.ends_with(&id)));

    let too_long = "x".repeat(super::MAX_REQUEST_ID_BYTES + 1);
    let (_, _, json) = send(router(&metrics), get_request("/fails", Some(&too_long))).await;
    assert_ne!(json["instance"], too_long, "an oversized id is replaced");
    let (_, _, json) = send(router(&metrics), get_request("/fails", Some("has space"))).await;
    assert_ne!(json["instance"], "has space", "a non-visible byte is replaced");

    let (status, meta, json) = send(router(&metrics), post_json("/json", r#"{"seed":"7"}"#)).await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert!(meta.is_some_and(|m| m.starts_with("text/plain")), "a success passes through");
}

#[tokio::test]
async fn r2_13_axum_rejections_and_router_answers_become_problem_bodies() {
    let metrics = Arc::new(Metrics::new());

    let (status, meta, json) = send(router(&metrics), post_json("/json", "{ not json")).await;
    assert_problem(status, meta.as_deref(), &json, 400, "bad-request");
    let (status, meta, json) = send(router(&metrics), post_json("/json", r#"{"seed":7}"#)).await;
    assert_problem(status, meta.as_deref(), &json, 400, "bad-request");
    assert!(json["detail"].as_str().is_some_and(|d| d.contains("seed")), "{json}");

    let request = Request::builder()
        .method("POST")
        .uri("/json")
        .header(header::CONTENT_TYPE, "text/plain")
        .body(Body::from(r#"{"seed":"7"}"#))
        .expect("a request");
    let (status, meta, json) = send(router(&metrics), request).await;
    assert_problem(status, meta.as_deref(), &json, 400, "bad-request");

    let long = format!(r#"{{"seed":"{}"}}"#, "7".repeat(BODY_LIMIT));
    let (status, meta, json) = send(router(&metrics), post_json("/json", &long)).await;
    assert_problem(status, meta.as_deref(), &json, 413, PAYLOAD_TOO_LARGE_TAG);

    let (status, meta, json) = send(router(&metrics), get_request("/nowhere", None)).await;
    assert_problem(status, meta.as_deref(), &json, 404, "not-found");
    assert!(json["detail"].as_str().is_some_and(|d| d.contains("/nowhere")), "{json}");

    let (status, meta, json) = send(router(&metrics), get_request("/json", None)).await;
    assert_problem(status, meta.as_deref(), &json, 405, METHOD_NOT_ALLOWED_TAG);
}

#[tokio::test]
async fn r2_13_latency_middleware_observes_the_matched_route_and_final_status() {
    let metrics = Arc::new(Metrics::new());
    let before = metrics.requests_observed();

    send(router(&metrics), get_request("/fails", None)).await;
    send(router(&metrics), post_json("/json", r#"{"seed":7}"#)).await;
    send(router(&metrics), get_request("/nowhere", None)).await;

    assert_eq!(metrics.request_count("/fails", 404), 1);
    assert_eq!(metrics.request_count("/json", 400), 1, "the status the caller saw, not 422");
    assert_eq!(metrics.request_count(UNMATCHED_ROUTE, 404), 1);
    assert_eq!(metrics.requests_observed(), before + 3);
    metrics.observe("/x", 200, Duration::from_millis(3));
    assert_eq!(metrics.request_count("/x", 200), 1);
}

#[test]
fn r2_13_generated_request_ids_are_distinct_hex() {
    let ids: HashSet<String> = (0..1000).map(|_| generate_request_id()).collect();
    assert_eq!(ids.len(), 1000, "a thousand calls, a thousand ids");
    assert!(ids.iter().all(|id| id.len() == 16 && id.bytes().all(|b| b.is_ascii_hexdigit())));
}
