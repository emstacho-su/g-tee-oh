//! Shared helpers of the solver-query integration tests (R2.13 to R2.15, plan C.9, O-62,
//! O-149). `packed_fixture` builds the synthetic preflop solution the way the dev profile
//! will: `gto_library::synthetic_tree` gives the nodes, `library_pack::export_dump` the
//! node dump, and `library_pack::pack` writes `preflop/<config_id>/<solution_id>/` into a
//! temporary directory, so the service reads real chunk files through the real reader.
//! `write_solution` writes hand-built nodes beside it through `gto_library::write_preflop`,
//! for the planted cases (a missing accuracy, a rare line, a suit split). The library cannot
//! enumerate keys, so the fixture carries its node list.
//!
//! The router comes from the configuration path (`Config::from_lookup` with
//! `FIXTURE_LIBRARY_PATH` set to the root), so these tests keep working when `AppState`
//! grows the registry: only `router_over` changes then.
//!
//! Every test binary includes this module and uses a subset of it, hence the dead-code
//! allowance.

#![allow(dead_code, reason = "each test binary uses a subset of these helpers")]

pub mod equity;
pub mod plant;

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use axum::Router;
use axum::body::Body;
use axum::http::{HeaderMap, Request, StatusCode, header};
use gto_library::{
    ChunkOptions, FsStore, HandSpace, ManifestConfig, SolutionMeta, SolvedHand, SolvedNode, Source,
    SyntheticParams, preflop_prefix, synthetic_tree, write_preflop,
};
use gto_model::{ActionToken, Cbb, ConfigId, NodeKey, Position, PositionPair, v1_configs};
use http_body_util::BodyExt;
use library_pack::{PackOptions, export_dump, pack};
use serde_json::Value;
use solver_query::app::{AppState, app_with};
use solver_query::config::{Config, FIXTURE_LIBRARY_VAR};
use tempfile::TempDir;
use tower::ServiceExt;

/// The seed of the packed synthetic fixture (plan C.9).
pub const FIXTURE_SEED: u64 = 7;
/// How many nodes the packed synthetic fixture holds.
pub const FIXTURE_NODES: usize = 40;
/// The solution id the packed fixture is written under.
pub const FIXTURE_SOLUTION_ID: &str = "5e7a1c2b-3d4f-8a6b-9c0d-1e2f3a4b5c6d";
/// The manifest timestamp of every solution these tests write.
pub const CREATED_AT: &str = "2026-10-21T12:00:00Z";
/// The media type of every error body (O-158).
pub const PROBLEM_JSON: &str = "application/problem+json";
/// The prefix of every problem type (plan A.7).
pub const PROBLEM_TYPE_PREFIX: &str = "urn:g-tee-oh:problem:";

/// A packed solution in a temporary directory, with what a test needs to address it.
pub struct Fixture {
    /// Keeps the directory alive for the fixture's lifetime.
    pub dir: TempDir,
    /// The library root, `FIXTURE_LIBRARY_PATH`.
    pub root: PathBuf,
    /// The solution id.
    pub solution_id: String,
    /// The configuration every node key names.
    pub config_id: ConfigId,
    /// The pair every node key names.
    pub pair: PositionPair,
    /// `preflop/<config_id>/<solution_id>`.
    pub prefix: String,
    /// The nodes in the order they were generated.
    pub nodes: Vec<SolvedNode>,
}

impl Fixture {
    /// The router over this fixture's root.
    pub fn router(&self) -> Router {
        router_over(&self.root)
    }

    /// The key text of node `index`.
    #[must_use]
    pub fn key(&self, index: usize) -> String {
        self.nodes[index].key.to_string()
    }
}

/// The synthetic preflop fixture: seed 7, 40 dense `preflop_169` nodes, packed through
/// library-pack into a fresh temporary directory (plan C.9, O-149).
#[must_use]
pub fn packed_fixture() -> Fixture {
    let params = SyntheticParams {
        seed: FIXTURE_SEED,
        nodes: FIXTURE_NODES,
        hand_space: HandSpace::Preflop169,
        ..SyntheticParams::default()
    };
    let nodes = synthetic_tree(&params);
    let meta = solution_meta(&nodes, FIXTURE_SOLUTION_ID, None);
    let dump = export_dump(&meta, &nodes);
    let dir = tempfile::tempdir().expect("a temporary directory");
    let dump_path = dir.path().join("synthetic-dump.json");
    let bytes = serde_json::to_vec_pretty(&dump).expect("the dump serializes");
    fs::write(&dump_path, bytes).expect("the dump is written");
    let root = dir.path().join("library");
    fs::create_dir(&root).expect("the library root is created");
    let options = PackOptions {
        solution_id: Some(FIXTURE_SOLUTION_ID.to_owned()),
        created_at: Some(CREATED_AT.to_owned()),
        synthetic: true,
        ..PackOptions::default()
    };
    pack(&dump_path, &root, &options).expect("the synthetic dump packs");
    let prefix = preflop_prefix(&meta.config_id, FIXTURE_SOLUTION_ID);
    let (config_id, pair) = (meta.config_id.clone(), meta.pair);
    Fixture {
        dir,
        root,
        solution_id: FIXTURE_SOLUTION_ID.to_owned(),
        config_id,
        pair,
        prefix,
        nodes,
    }
}

/// An empty library root in a fresh temporary directory, for planted solutions.
#[must_use]
pub fn empty_root() -> (TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let root = dir.path().join("library");
    fs::create_dir(&root).expect("the library root is created");
    (dir, root)
}

/// The manifest configuration of the v1 catalog row the nodes' configuration names.
#[must_use]
pub fn manifest_config(config_id: &ConfigId) -> ManifestConfig {
    let config = v1_configs()
        .into_iter()
        .find(|config| &config.config_id() == config_id)
        .expect("the configuration is in the v1 catalog");
    ManifestConfig {
        format: config.format,
        table_size: config.table_size,
        stake: config.stake.label.clone(),
        depth_cbb: config.depth_cbb,
        straddle: config.straddle,
        ante_cbb: config.ante_cbb,
    }
}

/// Synthetic reference metadata for `nodes` under `solution_id`, with an optional manifest
/// exploitability per seat (O-22 precedence: the record's accuracy, else this, else the
/// 0.02 bb fallback).
#[must_use]
pub fn solution_meta(
    nodes: &[SolvedNode],
    solution_id: &str,
    exploitability_pct_pot: Option<[f64; 2]>,
) -> SolutionMeta {
    let first = &nodes[0].key;
    SolutionMeta {
        id: solution_id.to_owned(),
        source: Source::Reference,
        engine_version: "synthetic".to_owned(),
        config: manifest_config(&first.config_id),
        config_id: first.config_id.clone(),
        pair: first.pair,
        tree_hash: "00".repeat(32),
        seed: None,
        iterations: None,
        exploitability_pct_pot,
        synthetic: true,
        created_at: CREATED_AT.to_owned(),
    }
}

/// Writes `nodes` as a preflop solution under `root` through the library writer and returns
/// its prefix. The solution id must be a lowercase UUID the registry will index.
pub fn write_solution(
    root: &Path,
    solution_id: &str,
    nodes: &[SolvedNode],
    exploitability_pct_pot: Option<[f64; 2]>,
) -> String {
    let meta = solution_meta(nodes, solution_id, exploitability_pct_pot);
    let mut store = FsStore::new(root).expect("the root exists");
    write_preflop(&mut store, &meta, nodes, &ChunkOptions::default())
        .expect("the planted solution writes");
    preflop_prefix(&meta.config_id, solution_id)
}

/// The router over `root` through the configuration path (`FIXTURE_LIBRARY_PATH`).
pub fn router_over(root: &Path) -> Router {
    let value: OsString = root.as_os_str().to_owned();
    let config = Config::from_lookup(|name| (name == FIXTURE_LIBRARY_VAR).then(|| value.clone()))
        .expect("one well formed variable");
    app_with(AppState::from(&config)).0
}

/// A preflop node key under `config_id` and `pair` with the given dotted line.
#[must_use]
pub fn preflop_key(config_id: &ConfigId, pair: PositionPair, line: Vec<ActionToken>) -> NodeKey {
    NodeKey::preflop(config_id.clone(), pair, line)
}

/// A hand-built node: `actions` as (token, total wager), `hands` as built by `hand`.
#[must_use]
pub fn planted_node(
    key: NodeKey,
    to_act: Position,
    pot: Cbb,
    actions: Vec<(ActionToken, Cbb)>,
    hand_space: HandSpace,
    hands: Vec<SolvedHand>,
    accuracy_pct_pot: Option<f32>,
) -> SolvedNode {
    let behind = Cbb(10_000);
    SolvedNode {
        key,
        to_act,
        pot,
        stacks: [behind, behind],
        actions,
        hand_space,
        hands,
        accuracy_pct_pot,
    }
}

/// One hand with explicit reach per seat (out of position first), frequencies and EVs.
#[must_use]
pub fn hand(index: u16, reach: [f64; 2], frequencies: Vec<f64>, ev_bb: Vec<f64>) -> SolvedHand {
    SolvedHand { hand: index, reach: Some(reach), frequencies, ev_bb }
}

/// The three-action shape every planted preflop node shares: fold, call 2.5 bb, raise to 8 bb.
#[must_use]
pub fn fold_call_raise() -> Vec<(ActionToken, Cbb)> {
    vec![
        (ActionToken::Fold, Cbb::ZERO),
        (ActionToken::Call, Cbb(250)),
        (ActionToken::Raise(Cbb(800)), Cbb(800)),
    ]
}

/// The response status, headers and JSON body of one request through `router`.
async fn send(router: Router, request: Request<Body>) -> (StatusCode, HeaderMap, Value) {
    let response = router.oneshot(request).await.expect("the router answers every request");
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.expect("the body is readable").to_bytes();
    let json = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or_else(|_| Value::String(lossy(&bytes)))
    };
    (status, headers, json)
}

fn lossy(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

/// `GET uri` through `router`.
pub async fn get(router: Router, uri: &str) -> (StatusCode, HeaderMap, Value) {
    let request = Request::builder().uri(uri).body(Body::empty()).expect("a valid request");
    send(router, request).await
}

/// `POST uri` with a JSON body through `router`.
pub async fn post(router: Router, uri: &str, body: &Value) -> (StatusCode, HeaderMap, Value) {
    let request = Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .expect("a valid request");
    send(router, request).await
}

/// `POST uri` with a raw body and content type, for malformed inputs.
pub async fn post_raw(router: Router, uri: &str, body: &str) -> (StatusCode, HeaderMap, Value) {
    let request = Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_owned()))
        .expect("a valid request");
    send(router, request).await
}

/// Asserts an RFC 9457 problem answer: the status, the content type, and a body whose
/// `type` carries the prefix and `tag`, whose `title` is non-empty and whose `status` echoes
/// the response status (O-158).
pub fn assert_problem(
    status: StatusCode,
    headers: &HeaderMap,
    json: &Value,
    expected: StatusCode,
    tag: &str,
) {
    assert_eq!(status, expected, "body was {json}");
    let content_type = headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok());
    assert_eq!(content_type, Some(PROBLEM_JSON), "body was {json}");
    assert_eq!(json["type"], format!("{PROBLEM_TYPE_PREFIX}{tag}"), "body was {json}");
    assert!(json["title"].as_str().is_some_and(|t| !t.is_empty()), "body was {json}");
    assert_eq!(json["status"], u64::from(expected.as_u16()), "body was {json}");
    assert!(json["detail"].is_string(), "body was {json}");
}

/// `GET /v1/nodes` for one hand filter.
pub async fn get_node(
    router: Router,
    solution_id: &str,
    key: &str,
    hands: Option<&str>,
) -> (StatusCode, HeaderMap, Value) {
    let mut uri = format!("/v1/nodes?solution_id={solution_id}&node_key={}", encode(key));
    if let Some(hands) = hands {
        uri.push_str("&hands=");
        uri.push_str(hands);
    }
    get(router, &uri).await
}

/// `POST /v1/grade` for one decision.
pub async fn grade(
    router: Router,
    solution_id: &str,
    key: &str,
    hand: &str,
    action: usize,
) -> (StatusCode, HeaderMap, Value) {
    let body = serde_json::json!({
        "solution_id": solution_id,
        "node_key": key,
        "hand": hand,
        "action_index": action,
    });
    post(router, "/v1/grade", &body).await
}

/// Percent-encodes the characters of a node key that a query string cannot carry raw.
#[must_use]
pub fn encode(text: &str) -> String {
    text.replace('|', "%7C").replace('/', "%2F")
}

/// The sum of a JSON array of numbers.
#[must_use]
pub fn sum(values: &Value) -> f64 {
    values.as_array().expect("an array").iter().map(|v| v.as_f64().expect("a number")).sum()
}

/// A JSON number as f32, panicking with the whole value on anything else.
#[must_use]
pub fn f32_of(value: &Value) -> f32 {
    let number = value.as_f64().unwrap_or_else(|| panic!("expected a number, got {value}"));
    #[expect(clippy::cast_possible_truncation, reason = "the contract carries f32 values")]
    let narrowed = number as f32;
    narrowed
}
