//! Tests for the `OpenAPI` document `solver-query` publishes (R0.7, O-116). The document
//! is produced in process by `app_with` over `AppState::empty` (the routes describe
//! themselves, so no environment, library, pool or runtime is involved, exactly as the
//! subcommand builds it), written by the `openapi --out <path>` subcommand
//! (the process writes the file itself, never a shell redirection), and committed at
//! `packages/contracts/solver-query.openapi.json`, where `just contracts` regenerates it
//! and the contracts job fails on a diff.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;
use solver_query::app::{AppState, app_with};
use solver_query::openapi::document_json;
use utoipa::openapi::OpenApi;

/// The committed copy, relative to this crate's manifest directory.
const COMMITTED_DOCUMENT: &str = "../../packages/contracts/solver-query.openapi.json";

/// Every A5 section 2 operation plus `/metrics` (plan C.1), as (path, method).
const A5_OPERATIONS: [(&str, &str); 9] = [
    ("/v1/nodes", "get"),
    ("/v1/grade", "post"),
    ("/v1/insights", "get"),
    ("/v1/deal", "post"),
    ("/v1/deal/{id}/reveal", "get"),
    ("/v1/sample-action", "post"),
    ("/v1/coverage", "get"),
    ("/healthz", "get"),
    ("/metrics", "get"),
];

/// The one error schema every error response references (O-158).
const PROBLEM_REF: &str = "#/components/schemas/Problem";

/// The media type of every error response.
const PROBLEM_JSON: &str = "application/problem+json";

/// The lowest status that is an error response.
const FIRST_ERROR_STATUS: u16 = 400;

/// Pretty prints a value the one way every comparison in this file uses.
fn pretty(value: &Value) -> String {
    serde_json::to_string_pretty(value).expect("a JSON value pretty prints")
}

/// The in-process document over an empty state, as `main.rs` builds it for the
/// subcommand: it never reads the environment, so a `QUERY_DB_PASSWORD` in the test
/// environment cannot make it need a database or a runtime.
fn generated_document() -> OpenApi {
    let (_router, document) = app_with(AppState::empty());
    document
}

/// The shape every copy of the document must have: an `OpenAPI` 3 document titled after
/// the crate, at the crate version, with `/healthz` answering 200.
fn assert_describes_healthz(document: &Value) {
    let version = document["openapi"].as_str().unwrap_or_default();
    assert!(version.starts_with("3."), "openapi version was {version:?}");
    assert_eq!(document["info"]["title"], "solver-query", "document was {document}");
    assert_eq!(document["info"]["version"], env!("CARGO_PKG_VERSION"), "document was {document}");
    let ok = &document["paths"]["/healthz"]["get"]["responses"]["200"];
    assert!(ok.is_object(), "no 200 response for GET /healthz in {document}");
    assert!(
        ok["content"]["application/json"]["schema"].is_object(),
        "the 200 response carries no JSON schema in {document}"
    );
}

/// A fresh directory under the system temporary directory, unique per test process.
fn scratch_dir(label: &str) -> PathBuf {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let dir =
        std::env::temp_dir().join(format!("solver-query-{label}-{}-{nanos}", std::process::id()));
    fs::create_dir_all(&dir).expect("the scratch directory is creatable");
    dir
}

/// Every A5 section 2 operation is present, every error response of every operation is an
/// `application/problem+json` body referencing the one `Problem` schema, and every JSON
/// success carries a schema.
fn assert_describes_every_a5_endpoint(document: &Value) {
    let paths = document["paths"].as_object().expect("paths is an object");
    for (path, method) in A5_OPERATIONS {
        let operation = &paths[path][method];
        assert!(operation.is_object(), "no {method} {path} in {document}");
        let responses = operation["responses"].as_object().expect("responses is an object");
        for (status, response) in responses {
            let code: u16 = status.parse().expect("a numeric status");
            if code < FIRST_ERROR_STATUS {
                continue;
            }
            let schema = &response["content"][PROBLEM_JSON]["schema"];
            assert_eq!(schema["$ref"], PROBLEM_REF, "{method} {path} {status}: {response}");
        }
        let ok = &responses["200"]["content"];
        assert!(ok.is_object(), "{method} {path} has no 200 content");
    }
    assert!(document["components"]["schemas"]["Problem"].is_object(), "no Problem schema");
}

#[test]
fn r2_13_openapi_document_describes_every_a5_endpoint() {
    let document = serde_json::to_value(generated_document()).expect("the document serializes");

    assert_describes_every_a5_endpoint(&document);

    let paths = document["paths"].as_object().expect("paths is an object");
    assert_eq!(paths.len(), A5_OPERATIONS.len(), "one path item per operation, no extra route");
}

#[test]
fn r0_7_openapi_document_describes_healthz() {
    let document = generated_document();

    let value = serde_json::to_value(&document).expect("the document serializes");

    assert_describes_healthz(&value);
}

#[test]
fn r0_7_openapi_subcommand_writes_the_document() {
    let dir = scratch_dir("openapi");
    let out = dir.join("doc.json");

    let output = Command::new(env!("CARGO_BIN_EXE_solver-query"))
        .args(["openapi", "--out"])
        .arg(&out)
        .output()
        .expect("the solver-query binary built by cargo should start");
    assert!(
        output.status.success(),
        "exit status was {:?}, stderr: {}",
        output.status,
        String::from_utf8_lossy(&output.stderr)
    );

    let text = fs::read_to_string(&out).expect("the subcommand wrote the document");
    assert!(text.ends_with('\n'), "the document ends with one newline");
    assert!(!text.ends_with("\n\n"), "the document ends with exactly one newline");
    assert!(!text.contains('\r'), "the document uses LF line endings only");
    let value: Value = serde_json::from_str(&text).expect("the document is JSON");
    assert_describes_healthz(&value);
    let in_process = document_json(&generated_document()).expect("the document serializes");
    assert_eq!(text, in_process, "the file is the in-process document, byte for byte");

    if let Err(error) = fs::remove_dir_all(&dir) {
        eprintln!("could not remove {}: {error}", dir.display());
    }
}

#[test]
fn r0_7_committed_document_matches_generated() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(COMMITTED_DOCUMENT);
    let committed = fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!("cannot read {}: {error}; run just contracts", path.display())
    });
    let committed: Value = serde_json::from_str(&committed).expect("the committed file is JSON");

    let generated = serde_json::to_value(generated_document()).expect("the document serializes");

    assert_describes_healthz(&committed);
    assert_describes_every_a5_endpoint(&committed);
    assert_eq!(
        pretty(&committed),
        pretty(&generated),
        "{} is stale; run just contracts and commit the result",
        path.display()
    );
}
