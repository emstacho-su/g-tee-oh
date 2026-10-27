//! Shared helpers of the `library-builder` tests: fixture paths, the placeholder sizing
//! convention, a seeded in-memory queue and an environment over it with the fake solver
//! and a directory target.

#![allow(dead_code, reason = "each test binary uses a different subset of the helpers")]

use std::path::{Path, PathBuf};
use std::sync::Arc;

use gto_planner::PriorReach;
use gto_tree::{SizingConventionSpec, TreeConfig, tree_hash};
use library_builder::job::Env;
use library_builder::ops::Status;
use library_builder::queue::mem::{MemJob, MemQueue};
use library_builder::ranges::FixtureRanges;
use library_builder::solve::{FakeSolver, LineSolver};
use library_builder::store::LibraryTarget;
use serde_json::{Value, json};

/// The configuration every test job uses.
pub const CONFIG_ID: &str = "cfg_6_online_100";

/// The pair every test job uses.
pub const PAIR: &str = "BB-BTN";

/// The flop of the tiny fixtures; no fixture combo holds one of its cards.
pub const FLOP: &str = "Ah7d2c";

/// The single-raised line.
pub const LINE: &str = "r250.c";

/// This worker's name in the tests.
pub const WORKER: &str = "test-worker";

/// A fixed clock, 2026-10-27 12:00 UTC, outside the default boost window.
pub const NOON_EPOCH: u64 = 1_793_102_400;

/// `validation/fixtures/builder/<name>` from this crate's manifest directory.
pub fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../validation/fixtures/builder").join(name)
}

/// The S02 placeholder convention of `cfg_6_online_100`, as the seed stores it.
pub fn placeholder_convention() -> Value {
    json!({
        "placeholder_for": CONFIG_ID,
        "open_bb": 2.5,
        "iso_rule": { "base_bb": 3.0, "per_limper_bb": 1.0 },
        "threebet_ip": 3.0,
        "threebet_oop": 4.0,
        "fourbet": 2.2,
        "straddle_bb": null,
        "postflop": { "flop": [0.33, 0.75], "turn": [0.75], "river": [0.75] }
    })
}

/// The tree hash the placeholder convention gives.
pub fn placeholder_tree_hash() -> [u8; 32] {
    let spec = SizingConventionSpec::from_json(&placeholder_convention().to_string())
        .expect("the seed spec parses");
    tree_hash(&TreeConfig::from_spec(&spec).expect("a tree"))
}

/// A queued job on `flop` with K = 2 and the placeholder tree hash.
pub fn tiny_job(id: &str, flop: &str, priority: f32) -> MemJob {
    MemJob::queued(id, CONFIG_ID, PAIR, flop, &[LINE], placeholder_tree_hash(), 2, priority)
}

/// An in-memory queue holding the placeholder convention and `jobs`.
pub fn queue_with(jobs: Vec<MemJob>) -> MemQueue {
    let queue = MemQueue::new();
    queue.set_convention(CONFIG_ID, placeholder_convention());
    for job in jobs {
        queue.insert_job(job);
    }
    queue
}

/// An environment over `queue` with `solver`, a directory target under `root` and the
/// tiny ranges fixture.
pub fn env_with(queue: MemQueue, solver: Arc<dyn LineSolver>, root: &Path) -> Env<MemQueue> {
    let ranges = FixtureRanges::load(&fixture("tiny-bb-btn-srp.json")).expect("the tiny fixture");
    let scratch = root.join("scratch");
    let library = root.join("library");
    std::fs::create_dir_all(&scratch).expect("the scratch directory");
    std::fs::create_dir_all(&library).expect("the library directory");
    Env {
        queue: Arc::new(queue),
        solver,
        target: Some(LibraryTarget::Fs { root: library }),
        ranges: Arc::new(ranges),
        reach: Arc::new(PriorReach),
        scratch_dir: scratch,
        worker_id: WORKER.to_owned(),
        builder_threads: 2,
        status: Arc::new(Status::default()),
        limits: library_builder::settings::Limits::default(),
    }
}

/// The fake solver converging to `gains`.
pub fn fake(gains: [f64; 2]) -> Arc<dyn LineSolver> {
    Arc::new(FakeSolver::converging(gains))
}

/// Every file under `dir`, relative, with forward slashes, sorted.
pub fn files_under(dir: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(next) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&next) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if let Ok(relative) = path.strip_prefix(dir) {
                out.push(relative.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    out.sort();
    out
}
