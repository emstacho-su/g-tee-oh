//! Tests for the `OpenAPI` document `solver-query` publishes (R0.7, O-116). The document
//! is produced in process by `app()`, written by the `openapi --out <path>` subcommand
//! (the process writes the file itself, never a shell redirection), and committed at
//! `packages/contracts/solver-query.openapi.json`, where `just contracts` regenerates it
//! and the contracts job fails on a diff.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;
use solver_query::app::app;
use solver_query::openapi::document_json;
use utoipa::openapi::OpenApi;

/// The committed copy, relative to this crate's manifest directory.
const COMMITTED_DOCUMENT: &str = "../../packages/contracts/solver-query.openapi.json";

/// Pretty prints a value the one way every comparison in this file uses.
fn pretty(value: &Value) -> String {
    serde_json::to_string_pretty(value).expect("a JSON value pretty prints")
}

/// The in-process document; `app()` reads the configuration, which the test environment
/// leaves well formed.
fn generated_document() -> OpenApi {
    let (_router, document) = app().expect("no malformed solver-query variable in the test env");
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
    assert_eq!(
        pretty(&committed),
        pretty(&generated),
        "{} is stale; run just contracts and commit the result",
        path.display()
    );
}
