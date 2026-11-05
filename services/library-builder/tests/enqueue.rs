//! `library-builder queue` (R2.22, O-510): one flop build queued by hand carries the tree
//! hash the planner would give it, sits at the head of the queue, and is refused when it
//! names a line the pair's tree lacks or one no range source covers.

mod common;

use common::{CONFIG_ID, FLOP, LINE, PAIR, env_with, fake, placeholder_tree_hash, queue_with};
use gto_model::canonical_flop;
use gto_tree::{PreflopTree, SizingConventionSpec};
use library_builder::enqueue::{HEAD_PRIORITY, QueueRequest, queue_one};
use library_builder::error::BuilderError;
use library_builder::job::catalog_config;
use library_builder::settings::BuilderSettings;

fn request(flop: &str, lines: &[&str]) -> QueueRequest {
    QueueRequest {
        config_id: CONFIG_ID.to_owned(),
        pair: PAIR.to_owned(),
        flop: flop.to_owned(),
        lines: lines.iter().map(|line| (*line).to_owned()).collect(),
        k_runouts: None,
        priority: None,
    }
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes.iter().fold(String::new(), |mut text, byte| {
        // Writing to a String cannot fail.
        let _ = write!(text, "{byte:02x}");
        text
    })
}

#[tokio::test]
async fn r2_22_queue_one_writes_the_head_job_with_the_planners_hash() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let env = env_with(queue_with(Vec::new()), fake([0.1, 0.1]), dir.path());
    let settings = BuilderSettings::default();

    // The fixture flop is written in its canonical form, as the planner writes its jobs.
    let (canonical, _) = canonical_flop(FLOP.parse().expect("a flop"));
    let write = queue_one(&env, &request(FLOP, &[LINE]), &settings).await.expect("queued");
    assert_eq!(write.queued, 1);
    assert_eq!(write.promoted, 0);
    assert!(write.wrote());
    assert_eq!(write.tree_config_hash, hex(&placeholder_tree_hash()));
    assert_eq!(write.given_flop, FLOP);
    assert_eq!(write.flop, canonical.to_string());
    // Without --k the pair takes the K of its rank; BB-BTN is not the top pair under the prior
    // reach (another pair ranks first), so it takes k_runouts_rare.
    assert_eq!(write.k_runouts, settings.planner.k_runouts_rare);
    assert!(write.estimated_bytes > 0);

    let jobs = env.queue.snapshot().jobs;
    assert_eq!(jobs.len(), 1);
    let job = &jobs[0];
    assert_eq!(job.game_config_id, CONFIG_ID);
    assert_eq!(job.position_pair, PAIR);
    assert_eq!(job.flop, canonical.to_string());
    assert_eq!(job.preflop_lines, vec![LINE.to_owned()]);
    assert_eq!(job.tree_config_hash, placeholder_tree_hash().to_vec());
    assert_eq!(job.k_runouts, i16::try_from(settings.planner.k_runouts_rare).expect("fits"));
    assert_eq!(job.status, "queued");
    assert!((f64::from(job.priority) - HEAD_PRIORITY).abs() < 1.0, "{}", job.priority);

    // The same key again: nothing is written, and the command reports it.
    let again = queue_one(&env, &request(FLOP, &[LINE]), &settings).await.expect("answers");
    assert_eq!(again.queued, 0);
    assert!(!again.wrote());
    assert_eq!(env.queue.snapshot().jobs.len(), 1);
}

#[tokio::test]
async fn r2_22_queue_one_canonicalizes_the_flop_and_takes_k_and_priority() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let env = env_with(queue_with(Vec::new()), fake([0.1, 0.1]), dir.path());
    let given = "Kd7s2h";
    let (canonical, _) = canonical_flop(given.parse().expect("a flop"));
    let mut req = request(given, &[LINE]);
    req.k_runouts = Some(5);
    req.priority = Some(2.0);

    let write = queue_one(&env, &req, &BuilderSettings::default()).await.expect("queued");
    assert_eq!(write.given_flop, given);
    assert_eq!(write.flop, canonical.to_string());
    assert_eq!(write.k_runouts, 5);
    assert!((write.priority - 2.0).abs() < f64::EPSILON);
    let job = &env.queue.snapshot().jobs[0];
    assert_eq!(job.flop, canonical.to_string());
    assert_eq!(job.k_runouts, 5);
}

/// R2.22, O-191, code review: without --k a pair gets the K the planner gives its rank, so a
/// rare pair gets `k_runouts_rare`; and a key that already exists is not reported as queued.
#[tokio::test]
async fn r2_22_queue_one_takes_k_by_the_pairs_rank_and_reports_an_existing_key() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let env = env_with(queue_with(Vec::new()), fake([0.1, 0.1]), dir.path());
    let mut settings = BuilderSettings::default();
    settings.planner.k_runouts = 20;
    settings.planner.k_runouts_rare = 7;
    settings.planner.k_frequent_pairs = 1;

    let spec = SizingConventionSpec::from_json(&common::placeholder_convention().to_string())
        .expect("the seed spec parses");
    let config = catalog_config(CONFIG_ID).expect("the v1 configuration");
    let scope = gto_planner::ConfigScope { config, convention: spec };
    let ranked = gto_planner::rank_pairs(&scope, &gto_planner::PriorReach, &settings.planner)
        .expect("the ranking");
    let expected = ranked
        .iter()
        .find(|pair| pair.pair.to_string() == PAIR)
        .map(|pair| pair.k_runouts)
        .expect("BB-BTN is ranked");
    assert!(ranked.iter().any(|pair| pair.k_runouts == 7), "some pair is rare");

    let write = queue_one(&env, &request(FLOP, &[LINE]), &settings).await.expect("queued");
    assert_eq!(write.k_runouts, expected);
    let again = queue_one(&env, &request(FLOP, &[LINE]), &settings).await.expect("answers");
    assert_eq!((again.queued, again.promoted, again.wrote()), (0, 0, false));
}

#[tokio::test]
async fn r2_22_queue_one_refuses_an_unknown_line_and_a_line_without_ranges() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let env = env_with(queue_with(Vec::new()), fake([0.1, 0.1]), dir.path());
    let settings = BuilderSettings::default();

    let unknown = queue_one(&env, &request(FLOP, &["r250.r9999.c"]), &settings).await;
    assert!(
        matches!(unknown, Err(BuilderError::UnknownLine { ref line, .. }) if line == "r250.r9999.c"),
        "{unknown:?}"
    );

    // A real flop line of the pair that the tiny ranges fixture does not cover.
    let spec = SizingConventionSpec::from_json(&common::placeholder_convention().to_string())
        .expect("the seed spec parses");
    let config = catalog_config(CONFIG_ID).expect("the v1 configuration");
    let tree = PreflopTree::build(&spec, &config, PAIR.parse().expect("a pair")).expect("a tree");
    let uncovered = tree
        .flop_lines()
        .iter()
        .map(gto_tree::PreflopLine::text)
        .find(|text| text != LINE)
        .expect("the pair has more than one flop line");
    let missing = queue_one(&env, &request(FLOP, &[&uncovered]), &settings).await;
    assert!(
        matches!(missing, Err(BuilderError::MissingRanges { ref line, .. }) if *line == uncovered),
        "{missing:?}"
    );

    let none = queue_one(&env, &request(FLOP, &[]), &settings).await;
    assert!(matches!(none, Err(BuilderError::Usage(_))), "{none:?}");
    let twice = queue_one(&env, &request(FLOP, &[LINE, LINE]), &settings).await;
    assert!(matches!(twice, Err(BuilderError::Usage(_))), "{twice:?}");
    assert_eq!(env.queue.snapshot().jobs, Vec::new());
}
