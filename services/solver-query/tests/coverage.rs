//! `GET /v1/coverage` (R2.13, plan D.4, O-28, O-146). Written red in S16 step 2: the
//! handler is a stub answering 501 until lane D lands the registry and query-role reads of
//! plan C.6. The role test stays ignored until it runs against the compose dev profile.

mod common;

use axum::http::StatusCode;
use serde_json::json;

use common::{assert_problem, get, packed_fixture};

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

#[test]
#[ignore = "R2.13: needs QUERY_DATABASE_URL from the dev profile (just dev-up, just db-migrate)"]
fn r2_13_coverage_reads_under_the_query_role() {
    unimplemented!(
        "current_user is query_login and pg_has_role(current_user, 'query', 'member'); an insert \
         into solution through the same pool fails with permission denied; coverage over the \
         seeded catalog answers 200 with database connected; healthz.database.connected is true \
         and role is query (plan D.4)"
    );
}
