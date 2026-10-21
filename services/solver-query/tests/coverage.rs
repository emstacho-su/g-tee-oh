//! `GET /v1/coverage` (R2.13, plan D.4, O-28, O-146). The first test needs no database:
//! the registry over the packed fixture answers the preflop block and `database` says
//! `unconfigured`. The role test runs only against the compose dev profile with
//! `QUERY_DATABASE_URL` set (`cargo test -p solver-query --test coverage -- --ignored`):
//! it proves the pool connects as `query_login`, a member of the `query` group role, that
//! the role cannot write, and that coverage and `/healthz` report the connection.

mod common;

use std::ffi::OsString;

use axum::Router;
use axum::http::StatusCode;
use serde_json::json;
use solver_query::app::{AppState, app_with};
use solver_query::config::{Config, DATABASE_URL_VAR, FIXTURE_LIBRARY_VAR};
use solver_query::db::{Db, INSUFFICIENT_PRIVILEGE, QUERY_ROLE};

use common::{Fixture, assert_problem, get, packed_fixture};

/// The login the dev profile's init script creates for the query role (`.env.example`).
const QUERY_LOGIN: &str = "query_login";

/// A seeded catalog configuration the fixture does not cover (`20261020001100_seed_catalog`).
const SEEDED_CONFIG_ID: &str = "cfg_9_live_25_300";

/// A write the query role must be refused (`20261020001000_grants.sql`: select only).
const INSERT_SOLUTION_SQL: &str = "insert into solution \
    (kind, source, game_config_id, position_pair, manifest_uri, status) \
    values ('preflop', 'own', $1, $2, 'memory://refused', 'published')";

#[tokio::test]
async fn r2_13_coverage_without_a_database_reports_fixture_preflop_availability() {
    let fixture = packed_fixture();
    let uri = format!("/v1/coverage?config_id={}&pair={}", fixture.config_id, fixture.pair);

    let (status, _, json) = get(fixture.router(), &uri).await;

    assert_eq!(status, StatusCode::OK, "body was {json}");
    assert_eq!(json["config_id"], fixture.config_id.as_str());
    assert_eq!(json["pair"], fixture.pair.to_string());
    assert_eq!(json["preflop"]["available"], true, "{json}");
    assert_eq!(json["preflop"]["solution_ids"], json!([fixture.solution_id]), "{json}");
    assert_eq!(json["preflop"]["sources"], json!(["fixture"]), "{json}");
    assert_eq!(json["flops"], json!([]), "{json}");
    assert_eq!(json["textures"], json!([]), "{json}");
    assert_eq!(json["queue"], json!([]), "{json}");
    assert_eq!(json["database"], "unconfigured", "{json}");

    let other = format!("/v1/coverage?config_id=cfg_9_live_25_300&pair={}", fixture.pair);
    let (status, _, json) = get(fixture.router(), &other).await;
    assert_eq!(status, StatusCode::OK, "a catalog configuration with nothing held: {json}");
    assert_eq!(json["preflop"]["available"], false, "{json}");
    assert_eq!(json["preflop"]["solution_ids"], json!([]), "{json}");

    let malformed = format!("/v1/coverage?config_id=Nope!&pair={}", fixture.pair);
    let (status, headers, json) = get(fixture.router(), &malformed).await;
    assert_problem(status, &headers, &json, StatusCode::BAD_REQUEST, "bad-request");

    let reversed = format!("/v1/coverage?config_id={}&pair=BTN-BB", fixture.config_id);
    let (status, headers, json) = get(fixture.router(), &reversed).await;
    assert_problem(status, &headers, &json, StatusCode::BAD_REQUEST, "bad-request");

    let unknown = format!("/v1/coverage?config_id={}&pair=XX-YY", fixture.config_id);
    let (status, headers, json) = get(fixture.router(), &unknown).await;
    assert_problem(status, &headers, &json, StatusCode::BAD_REQUEST, "bad-request");
}

#[tokio::test]
#[ignore = "R2.13: needs QUERY_DATABASE_URL from the dev profile (just dev-up, just db-migrate)"]
async fn r2_13_coverage_reads_under_the_query_role() {
    let url = std::env::var_os(DATABASE_URL_VAR)
        .expect("QUERY_DATABASE_URL names the dev profile's query login (see .env.example)");
    let fixture = packed_fixture();
    let root: OsString = fixture.root.as_os_str().to_owned();
    let config = Config::from_lookup(|name| match name {
        FIXTURE_LIBRARY_VAR => Some(root.clone()),
        DATABASE_URL_VAR => Some(url.clone()),
        _ => None,
    })
    .expect("two well formed variables");
    let state = AppState::from_config(&config).expect("the lazy pool opens inside the runtime");
    let db = state.db.clone().expect("QUERY_DATABASE_URL opens a pool");
    let router = app_with(state).0;

    let probe = db.probe_role().await.expect("the role probe answers");
    assert_eq!(probe.current_user, QUERY_LOGIN, "{probe:?}");
    assert!(probe.is_query_member, "query_login is a member of query: {probe:?}");
    assert_eq!(probe.role(), QUERY_ROLE);
    assert_write_refused(&db, &fixture).await;
    assert_coverage_and_healthz_connected(router, &fixture).await;
    println!(
        "r2_13_coverage_reads_under_the_query_role: connected as {} (member of {QUERY_ROLE}: \
         {}), insert refused with SQLSTATE {INSUFFICIENT_PRIVILEGE}, coverage and healthz \
         report connected",
        probe.current_user, probe.is_query_member
    );
}

/// An insert into `solution` through the same pool is refused with `insufficient_privilege`.
async fn assert_write_refused(db: &Db, fixture: &Fixture) {
    let refused = sqlx::query(INSERT_SOLUTION_SQL)
        .bind(fixture.config_id.as_str())
        .bind(fixture.pair.to_string())
        .execute(db.pool())
        .await
        .expect_err("the query role has no insert on solution");
    let sqlx::Error::Database(denied) = refused else {
        panic!("expected a database error, got {refused}");
    };
    assert_eq!(denied.code().as_deref(), Some(INSUFFICIENT_PRIVILEGE), "{denied}");
    assert!(denied.message().contains("permission denied"), "{denied}");
}

/// Coverage over the fixture and over a seeded catalog configuration answers 200 with the
/// database connected, and `/healthz` reports the connection under the query role.
async fn assert_coverage_and_healthz_connected(router: Router, fixture: &Fixture) {
    let uri = format!("/v1/coverage?config_id={}&pair={}", fixture.config_id, fixture.pair);
    let (status, _, json) = get(router.clone(), &uri).await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    assert_eq!(json["database"], "connected", "{json}");
    assert_eq!(json["preflop"]["available"], true, "{json}");
    assert_eq!(json["preflop"]["sources"], json!(["fixture"]), "{json}");

    let seeded = format!("/v1/coverage?config_id={SEEDED_CONFIG_ID}&pair={}", fixture.pair);
    let (status, _, json) = get(router.clone(), &seeded).await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    assert_eq!(json["database"], "connected", "{json}");
    assert_eq!(json["preflop"]["available"], false, "nothing held yet: {json}");
    assert_eq!(json["flops"], json!([]), "{json}");
    assert_eq!(json["queue"], json!([]), "{json}");

    let (status, _, json) = get(router, "/healthz").await;
    assert_eq!(status, StatusCode::OK, "body was {json}");
    assert_eq!(json["database"]["configured"], true, "{json}");
    assert_eq!(json["database"]["connected"], true, "{json}");
    assert_eq!(json["database"]["role"], QUERY_ROLE, "{json}");
}
