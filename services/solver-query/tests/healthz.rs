//! Health endpoint tests for `solver-query` (R0.7). `GET /healthz` is the probe the
//! compose health check and the end-to-end job read, and its `fixture_library` block is
//! how the job observes the `FIXTURE_LIBRARY_PATH` mount (O-62). The requests go through
//! `tower::ServiceExt::oneshot`, so no port is opened.

use std::path::PathBuf;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use http_body_util::BodyExt;
use serde_json::Value;
use solver_query::app::{AppState, app, app_with};
use tower::ServiceExt;

/// Sends `GET /healthz` to `router` and returns the status, content type and JSON body.
async fn get_healthz(router: Router) -> (StatusCode, Option<String>, Value) {
    let request = Request::builder().uri("/healthz").body(Body::empty()).expect("a valid request");
    let response = router.oneshot(request).await.expect("the router answers every request");
    let status = response.status();
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let bytes = response.into_body().collect().await.expect("the body is readable").to_bytes();
    let json: Value = serde_json::from_slice(&bytes).expect("the body is JSON");
    (status, content_type, json)
}

#[tokio::test]
async fn r0_7_healthz_returns_ok_json() {
    let (router, _document) = app().expect("no malformed solver-query variable in the test env");

    let (status, content_type, json) = get_healthz(router).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(content_type.as_deref(), Some("application/json"));
    assert_eq!(json["status"], "ok", "body was {json}");
    assert_eq!(json["service"], "solver-query", "body was {json}");
    assert_eq!(json["version"], env!("CARGO_PKG_VERSION"), "body was {json}");
    let fixture_library = &json["fixture_library"];
    assert!(fixture_library["present"].is_boolean(), "body was {json}");
    assert!(
        fixture_library["path"].is_null() || fixture_library["path"].is_string(),
        "body was {json}"
    );
}

#[tokio::test]
async fn r0_7_healthz_reports_the_fixture_library() {
    let existing = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let missing = existing.join("no-such-fixture-library");

    let with_path =
        |path: Option<PathBuf>| AppState { fixture_library_path: path, ..AppState::empty() };

    let (router, _) = app_with(with_path(Some(existing.clone())));
    let (_, _, json) = get_healthz(router).await;
    assert_eq!(json["fixture_library"]["path"], existing.to_string_lossy().as_ref());
    assert_eq!(json["fixture_library"]["present"], true, "body was {json}");

    let (router, _) = app_with(with_path(Some(missing.clone())));
    let (_, _, json) = get_healthz(router).await;
    assert_eq!(json["fixture_library"]["path"], missing.to_string_lossy().as_ref());
    assert_eq!(json["fixture_library"]["present"], false, "body was {json}");

    let (router, _) = app_with(with_path(None));
    let (_, _, json) = get_healthz(router).await;
    assert!(json["fixture_library"]["path"].is_null(), "body was {json}");
    assert_eq!(json["fixture_library"]["present"], false, "body was {json}");
}
