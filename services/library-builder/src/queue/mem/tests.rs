//! Unit tests of the in-memory queue (R2.16, R2.17).

use gto_model::{ConfigId, Flop, PositionPair};
use gto_planner::{JobSpec, Plan};

use super::{MemJob, MemQueue};
use crate::queue::{BudgetGate, Claim, Failure, JobQueue, PlanWrite, Publication};

fn gate(budget_bytes: u64) -> BudgetGate {
    BudgetGate { budget_bytes, bytes_per_runout: 10, bytes_per_flop_tree: 5 }
}

fn job(id: &str, flop: &str, priority: f32) -> MemJob {
    MemJob::queued(id, "cfg_6_online_100", "BB-BTN", flop, &["r250.c"], [7; 32], 2, priority)
}

fn spec(flop: &str) -> JobSpec {
    JobSpec {
        game_config_id: ConfigId::new("cfg_6_online_100").expect("an id"),
        position_pair: "BB-BTN".parse::<PositionPair>().expect("a pair"),
        flop: flop.parse::<Flop>().expect("a flop"),
        preflop_lines: vec!["r250.c".to_owned()],
        tree_config_hash: [7; 32],
        k_runouts: 2,
        priority: 0.5,
        estimated_bytes: 25,
    }
}

fn publication(job_id: &str, build_id: &str) -> Publication {
    Publication {
        job_id: job_id.to_owned(),
        build_id: build_id.to_owned(),
        config_id: "cfg_6_online_100".to_owned(),
        pair: "BB-BTN".to_owned(),
        flop: "Ah7d2c".to_owned(),
        flop_weight: 24,
        engine_version: "test".to_owned(),
        manifest_uri: format!("builds/x/{build_id}/manifest.json"),
        exploitability_pct_pot: [0.1, 0.2],
        scenarios: Vec::new(),
        bytes: 40,
    }
}

#[tokio::test]
async fn r2_17_ties_go_to_the_row_inserted_first_and_a_named_claim_needs_queued() {
    let queue = MemQueue::new();
    queue.insert_job(job("a", "Ah7d2c", 1.0));
    queue.insert_job(job("b", "Kh7d2c", 1.0));
    let named = queue.claim("w", Some("b"), &gate(u64::MAX)).await.expect("a claim");
    assert!(matches!(named, Claim::Job(ref j) if j.id == "b"), "{named:?}");
    let again = queue.claim("w", Some("b"), &gate(u64::MAX)).await.expect("a claim");
    assert_eq!(again, Claim::Empty, "a running job is not claimable by name");
    let head = queue.claim("w", None, &gate(u64::MAX)).await.expect("a claim");
    assert!(matches!(head, Claim::Job(ref j) if j.id == "a"), "{head:?}");
}

#[tokio::test]
async fn r2_17_publish_needs_the_lock_and_supersedes_the_previous_build() {
    let queue = MemQueue::new();
    queue.insert_job(job("a", "Ah7d2c", 1.0));
    let lost = queue.publish("w", &publication("a", "b1")).await;
    assert!(lost.is_err(), "a queued job cannot publish");
    let Claim::Job(_) = queue.claim("w", None, &gate(u64::MAX)).await.expect("claim") else {
        panic!("a job");
    };
    queue.publish("w", &publication("a", "b1")).await.expect("publishes");
    queue.insert_job(job("a2", "Ah7d2c", 1.0));
    let Claim::Job(_) = queue.claim("w", Some("a2"), &gate(u64::MAX)).await.expect("claim") else {
        panic!("a job");
    };
    queue.publish("w", &publication("a2", "b2")).await.expect("publishes");
    let state = queue.snapshot();
    let statuses: Vec<&str> = state.solutions.iter().map(|s| s.status.as_str()).collect();
    assert_eq!(statuses, ["superseded", "published"]);
    assert_eq!(state.ledger_bytes, 80);
    let builds = queue.published_builds().await.expect("builds");
    assert_eq!(builds.len(), 1);
    let broken = crate::queue::Unavailable {
        solution_id: "b2".to_owned(),
        tree_config_hash: Some(vec![7; 32]),
        bytes: 40,
        reason: "checksum".to_owned(),
    };
    queue.mark_unavailable(&broken).await.expect("marks");
    assert_eq!(queue.job("a2").expect("job").status, "queued");
    assert_eq!(queue.job("a2").expect("job").attempts, 0);
    assert_eq!(queue.published_builds().await.expect("builds"), Vec::new());
    assert_eq!(queue.snapshot().ledger_bytes, 40, "the build's bytes are given back");
}

#[tokio::test]
async fn r2_17_the_budget_gate_counts_the_ledger_and_running_jobs() {
    let queue = MemQueue::new();
    queue.insert_job(job("a", "Ah7d2c", 2.0));
    queue.insert_job(job("b", "Kh7d2c", 1.0));
    queue.set_ledger_bytes(10);
    let gate = gate(10 + 2 * queue.job("a").expect("a").estimate(&gate(0)) - 1);
    let first = queue.claim("w", None, &gate).await.expect("a claim");
    assert!(matches!(first, Claim::Job(_)), "{first:?}");
    let second = queue.claim("w", None, &gate).await.expect("a claim");
    let Claim::Blocked { job_id, reason } = second else { panic!("blocked: {second:?}") };
    assert_eq!(job_id, "b");
    assert!(reason.contains("budget"), "{reason}");
    let failure = Failure { job_id: "b".to_owned(), error: "x".to_owned(), ..failure() };
    assert!(queue.fail("w", &failure, 3).await.is_err(), "an unlocked job cannot fail");
}

fn failure() -> Failure {
    Failure { job_id: String::new(), error: String::new(), exploitability_pct_pot: None }
}

#[tokio::test]
async fn r2_16_a_plan_inserts_once_and_promotes_blocked_rows() {
    let queue = MemQueue::new();
    let plan =
        Plan { queued: vec![spec("Ah7d2c")], blocked: vec![spec("Kh7d2c")], committed_bytes: 0 };
    let first = queue.write_plan(&plan).await.expect("written");
    assert_eq!(first, PlanWrite { queued: 1, blocked: 1, promoted: 0 });
    let again = queue.write_plan(&plan).await.expect("written");
    assert_eq!(again, PlanWrite::default());
    let (keys, committed) = queue.plan_inputs(&gate(0)).await.expect("inputs");
    assert_eq!(keys.len(), 1, "blocked rows are not existing keys");
    assert_eq!(committed, gate(0).estimate(1, 2));
    let promote = Plan { queued: vec![spec("Kh7d2c")], blocked: vec![], committed_bytes: 0 };
    let promoted = queue.write_plan(&promote).await.expect("written");
    assert_eq!(promoted, PlanWrite { queued: 0, blocked: 0, promoted: 1 });
    let depth = queue.queue_depth().await.expect("depth");
    assert_eq!(depth, vec![("queued".to_owned(), 2)]);
}
