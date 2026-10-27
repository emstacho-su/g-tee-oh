//! R2.16 tests of `gto-planner`: build-job enumeration, priority from seat rotation times
//! equilibrium reach (ADR 0013, O-203), K per position pair (O-14, O-191), the storage
//! budget and `blocked_budget` (O-204): under a fixed budget, scheduling stops at the
//! budget and evicts nothing.

use std::collections::BTreeSet;

use gto_library::{
    ChunkOptions, FsStore, ManifestConfig, Reader, ReaderOptions, SolutionMeta, SolvedHand,
    SolvedNode, Source, preflop_prefix, write_preflop,
};
use gto_model::{
    Cbb, ConfigId, Flop, GameConfig, HandClass, NodeKey, PositionPair, TableSize, canonical_flops,
    v1_configs,
};
use gto_planner::{
    ConfigScope, JobKey, JobSpec, LibraryReach, PlannerSettings, PriorReach, RAW_FLOPS,
    ReachSource, enumerate, estimated_bytes, pair_lines, plan, prior_reach, schedule, seat_share,
};
use gto_tree::{LineKind, PreflopTree, SizingConventionSpec, TreeConfig, tree_hash};

/// The S02 placeholder convention of `cfg_6_online_100` (the seed migration).
const ONLINE_PLACEHOLDER: &str = r#"{
    "placeholder_for": "cfg_6_online_100", "open_bb": 2.5,
    "iso_rule": {"base_bb": 3.0, "per_limper_bb": 1.0},
    "threebet_ip": 3.0, "threebet_oop": 4.0, "fourbet": 2.2, "straddle_bb": null,
    "postflop": {"flop": [0.33, 0.75], "turn": [0.75], "river": [0.75]}
}"#;

/// Floating comparisons of products of a few frequencies.
const CLOSE: f64 = 1e-12;

fn online_100() -> GameConfig {
    v1_configs()
        .into_iter()
        .find(|config| config.config_id().to_string() == "cfg_6_online_100")
        .expect("the v1 catalog has cfg_6_online_100")
}

fn scope() -> ConfigScope {
    ConfigScope {
        config: online_100(),
        convention: SizingConventionSpec::from_json(ONLINE_PLACEHOLDER).expect("the seed spec"),
    }
}

fn bb_btn() -> PositionPair {
    "BB-BTN".parse().expect("a pair")
}

/// A hand-built job of `bytes` with a unique flop index, for the schedule tests.
fn job(index: usize, priority: f64, bytes: u64) -> JobSpec {
    let flop: Flop = canonical_flops()[index].flop;
    JobSpec {
        game_config_id: online_100().config_id(),
        position_pair: bb_btn(),
        flop,
        preflop_lines: vec!["r250.c".to_owned()],
        tree_config_hash: [7; 32],
        k_runouts: 20,
        priority,
        estimated_bytes: bytes,
    }
}

#[test]
fn r2_16_seat_share_is_two_seats_over_the_table() {
    assert!((seat_share(TableSize::SIX_MAX) - 2.0 / 6.0).abs() < CLOSE);
    assert!((seat_share(TableSize::NINE_HANDED) - 2.0 / 9.0).abs() < CLOSE);
    assert!((seat_share(TableSize::HEADS_UP) - 1.0).abs() < CLOSE);
}

#[test]
fn r2_16_estimated_bytes_is_the_s14_build_formula() {
    let settings = PlannerSettings::default();
    // 4 lines * (752,365 + 20 * 14,156,873): the S14 central build (O-180).
    assert_eq!(estimated_bytes(4, 20, &settings), 1_135_559_300);
    assert_eq!(estimated_bytes(1, 0, &settings), 752_365);
    assert_eq!(estimated_bytes(0, 20, &settings), 0);
}

#[test]
fn r2_16_prior_reach_orders_the_line_kinds() {
    assert!((prior_reach(LineKind::SingleRaised) - 1.0).abs() < CLOSE);
    assert!((prior_reach(LineKind::ThreeBet) - 0.25).abs() < CLOSE);
    assert!((prior_reach(LineKind::Limped) - 0.2).abs() < CLOSE);
    assert!((prior_reach(LineKind::FourBet) - 0.05).abs() < CLOSE);
    let lines = pair_lines(&scope()).expect("the pairs");
    let (_, bb_btn_lines) =
        lines.iter().find(|(pair, _)| *pair == bb_btn()).expect("BB-BTN has flop lines");
    for line in bb_btn_lines {
        let reach =
            PriorReach.line_reach(&online_100().config_id(), line).expect("the prior answers");
        assert!((reach - prior_reach(line.kind)).abs() < CLOSE, "{}", line.text());
    }
}

#[test]
fn r2_16_pair_lines_come_from_the_preflop_tree() {
    let lines = pair_lines(&scope()).expect("the pairs");
    assert_ne!(lines.len(), 0);
    for (pair, pair_lines) in &lines {
        assert!(!pair_lines.is_empty(), "{pair} is listed without a flop line");
        let tree = PreflopTree::build(&scope().convention, &online_100(), *pair).expect("a tree");
        assert_eq!(pair_lines.as_slice(), tree.flop_lines(), "{pair}");
    }
    let (_, bb_btn_lines) =
        lines.iter().find(|(pair, _)| *pair == bb_btn()).expect("BB-BTN has flop lines");
    let texts: Vec<String> = bb_btn_lines.iter().map(gto_tree::PreflopLine::text).collect();
    assert_eq!(texts, ["r250.c", "r250.r1000.c", "r250.r1000.r2200.c"]);
}

#[test]
fn r2_16_enumerate_covers_every_flop_with_seat_rotation_times_reach() {
    let settings = PlannerSettings::default();
    let jobs = enumerate(&[scope()], &PriorReach, &settings).expect("the candidates");
    let pairs = pair_lines(&scope()).expect("the pairs");
    assert_eq!(jobs.len(), pairs.len() * canonical_flops().len());
    let hash = tree_hash(&TreeConfig::from_spec(&scope().convention).expect("a tree"));
    for window in jobs.windows(2) {
        let order = window[1]
            .priority
            .total_cmp(&window[0].priority)
            .then_with(|| window[0].key().cmp(&window[1].key()));
        assert_eq!(order, std::cmp::Ordering::Less, "sorted by priority, then key");
    }
    let share = seat_share(TableSize::SIX_MAX);
    for job in &jobs {
        assert_eq!(job.tree_config_hash, hash);
        let (_, lines) = pairs.iter().find(|(pair, _)| *pair == job.position_pair).expect("pair");
        let texts: Vec<String> = lines.iter().map(gto_tree::PreflopLine::text).collect();
        assert_eq!(job.preflop_lines, texts);
        let reach: f64 = lines.iter().map(|line| prior_reach(line.kind)).sum();
        let weight = canonical_flops()
            .iter()
            .find(|canonical| canonical.flop == job.flop)
            .expect("a canonical flop")
            .weight;
        let expected = share * reach * f64::from(weight) / RAW_FLOPS;
        assert!((job.priority - expected).abs() < CLOSE, "{:?}", job.key());
        let k = job.k_runouts;
        assert_eq!(job.estimated_bytes, estimated_bytes(lines.len(), k, &settings));
    }
}

#[test]
fn r2_16_k_is_twenty_for_the_top_pair_and_ten_for_the_rest() {
    let mut settings = PlannerSettings::default();
    let jobs = enumerate(&[scope()], &PriorReach, &settings).expect("the candidates");
    let top = jobs[0].position_pair;
    for job in &jobs {
        let expected = if job.position_pair == top { 20 } else { 10 };
        assert_eq!(job.k_runouts, expected, "{}", job.position_pair);
    }
    settings.k_frequent_pairs = 2;
    settings.k_runouts = 12;
    settings.k_runouts_rare = 3;
    let jobs = enumerate(&[scope()], &PriorReach, &settings).expect("the candidates");
    let frequent: BTreeSet<String> = jobs
        .iter()
        .filter(|job| job.k_runouts == 12)
        .map(|job| job.position_pair.to_string())
        .collect();
    assert_eq!(frequent.len(), 2, "two pairs take k_runouts");
    assert!(jobs.iter().all(|job| job.k_runouts == 12 || job.k_runouts == 3));
}

#[test]
fn r2_16_schedule_stops_at_the_budget_and_skips_nothing_ahead() {
    let candidates = vec![job(0, 4.0, 40), job(1, 3.0, 30), job(2, 2.0, 50), job(3, 1.0, 10)];
    let plan = schedule(candidates.clone(), &BTreeSet::new(), 0, 100);
    assert_eq!(plan.queued, candidates[..2].to_vec());
    // The 10-byte job would fit after the 50-byte one is refused, but scheduling stops.
    assert_eq!(plan.blocked, candidates[2..].to_vec());
    assert_eq!(plan.committed_bytes, 70);

    let full = schedule(candidates.clone(), &BTreeSet::new(), 80, 100);
    assert!(full.queued.is_empty(), "committed bytes count against the budget");
    assert_eq!(full.blocked, candidates);
    assert_eq!(full.committed_bytes, 80);

    let exact = schedule(vec![job(0, 1.0, 100)], &BTreeSet::new(), 0, 100);
    assert_eq!(exact.queued.len(), 1, "a job that lands exactly on the budget fits");
}

#[test]
fn r2_16_schedule_evicts_nothing_already_planned() {
    let candidates = vec![job(0, 4.0, 40), job(1, 3.0, 30), job(2, 2.0, 50)];
    let existing: BTreeSet<JobKey> = [candidates[0].key(), candidates[2].key()].into();
    let plan = schedule(candidates.clone(), &existing, 40, 100);
    assert_eq!(plan.queued, vec![candidates[1].clone()]);
    assert_eq!(plan.blocked, Vec::new());
    assert_eq!(plan.committed_bytes, 70);
    for spec in plan.queued.iter().chain(&plan.blocked) {
        assert!(!existing.contains(&spec.key()), "an existing key is never planned again");
    }
}

#[test]
fn r2_16_plan_under_a_fixed_budget() {
    let settings = PlannerSettings {
        budget_bytes: 3 * estimated_bytes(3, 20, &PlannerSettings::default()),
        ..PlannerSettings::default()
    };
    let plan = plan(&[scope()], &PriorReach, &settings, &BTreeSet::new(), 0).expect("a plan");
    assert_ne!(plan.queued.len(), 0);
    assert_ne!(plan.blocked.len(), 0);
    assert!(plan.committed_bytes <= settings.budget_bytes);
    let queued: u64 = plan.queued.iter().map(|spec| spec.estimated_bytes).sum();
    assert_eq!(queued, plan.committed_bytes);
    let head = &plan.blocked[0];
    assert!(plan.committed_bytes + head.estimated_bytes > settings.budget_bytes);
    let lowest_queued = plan.queued.last().expect("queued").priority;
    assert!(plan.blocked.iter().all(|spec| spec.priority <= lowest_queued));
}

/// The frequency of action `index` of `count` at every preflop node of the fixture:
/// `(index + 1) / (1 + 2 + ... + count)`, the same for every hand class.
fn fixture_frequency(index: usize, count: usize) -> f64 {
    let total = count * (count + 1) / 2;
    f64::from(u32::try_from(index + 1).expect("small"))
        / f64::from(u32::try_from(total).expect("small"))
}

/// `fixture_frequency` as the library reads it back: rows are stored at 1/255 by the
/// largest-remainder method and renormalized on read (gto-library's `quantize` module), so
/// a row such as 1/6, 2/6, 3/6 does not read back exactly.
fn stored_frequency(index: usize, count: usize) -> f64 {
    let row: Vec<f64> = (0..count).map(|i| fixture_frequency(i, count)).collect();
    let stored = gto_library::quantize::quantize_frequencies(&row).expect("a valid row");
    f64::from(gto_library::quantize::dequantize_frequencies(&stored)[index])
}

/// Writes a preflop solution of the BB-BTN pair tree whose frequencies follow
/// `fixture_frequency`, and returns the library root and its prefix.
fn packed_pair_solution(dir: &std::path::Path) -> String {
    let config = online_100();
    let config_id = config.config_id();
    let tree = PreflopTree::build(&scope().convention, &config, bb_btn()).expect("a tree");
    let nodes: Vec<SolvedNode> = tree
        .nodes()
        .iter()
        .map(|node| SolvedNode {
            key: NodeKey::preflop(config_id.clone(), bb_btn(), node.line.clone()),
            to_act: node.actor,
            pot: node.pot,
            stacks: [Cbb(9_000), Cbb(9_000)],
            actions: node
                .actions
                .iter()
                .map(|action| (*action, action.size().unwrap_or(Cbb(0))))
                .collect(),
            hand_space: gto_library::HandSpace::Preflop169,
            hands: HandClass::all()
                .map(|class| SolvedHand {
                    hand: u16::from(class.index()),
                    reach: None,
                    frequencies: (0..node.actions.len())
                        .map(|index| fixture_frequency(index, node.actions.len()))
                        .collect(),
                    ev_bb: vec![0.0; node.actions.len()],
                })
                .collect(),
            accuracy_pct_pot: None,
        })
        .collect();
    let meta = SolutionMeta {
        id: "0192f000-0000-7000-8000-000000000016".to_owned(),
        source: Source::Reference,
        engine_version: "fixture".to_owned(),
        config: ManifestConfig {
            format: config.format,
            table_size: config.table_size,
            stake: config.stake.label.clone(),
            depth_cbb: config.depth_cbb,
            straddle: config.straddle,
            ante_cbb: config.ante_cbb,
        },
        config_id: config_id.clone(),
        pair: bb_btn(),
        tree_hash: "00".repeat(32),
        seed: None,
        iterations: None,
        exploitability_pct_pot: None,
        synthetic: true,
        created_at: "2026-10-27T00:00:00Z".to_owned(),
    };
    let mut store = FsStore::new(dir).expect("the root exists");
    write_preflop(&mut store, &meta, &nodes, &ChunkOptions::default())
        .expect("the solution writes");
    preflop_prefix(&config_id, &meta.id)
}

#[test]
fn r2_16_library_reach_is_the_product_of_the_line_frequencies() {
    let dir = tempfile::tempdir().expect("a scratch directory");
    let prefix = packed_pair_solution(dir.path());
    let reader = Reader::new(FsStore::new(dir.path()).expect("root"), ReaderOptions::default());
    let config_id: ConfigId = online_100().config_id();
    let reach = LibraryReach::open(reader, &[(config_id.clone(), bb_btn(), prefix)])
        .expect("the solution opens");
    let tree = PreflopTree::build(&scope().convention, &online_100(), bb_btn()).expect("a tree");
    for line in tree.flop_lines() {
        // Every class plays the same frequencies, so the class-weighted sum of each seat's
        // reach is the product of the frequencies of the actions taken along the line.
        let mut expected = 1.0;
        for (depth, action) in line.actions.iter().enumerate() {
            let node = tree
                .nodes()
                .iter()
                .find(|node| node.line.as_slice() == &line.actions[..depth])
                .expect("the node before each action");
            let index = node.actions.iter().position(|a| a == action).expect("the action");
            expected *= stored_frequency(index, node.actions.len());
        }
        let got = reach.line_reach(&config_id, line).expect("the line's reach");
        assert!((got - expected).abs() < 1e-6, "{}: {got} against {expected}", line.text());
        let classes = reach.line_classes(&config_id, line).expect("per-class reach");
        assert_eq!(classes[0].len(), usize::from(HandClass::COUNT));
        assert_eq!(classes[1].len(), usize::from(HandClass::COUNT));
    }
    let missing =
        reach.line_reach(&"cfg_6_online_150".parse().expect("an id"), &tree.flop_lines()[0]);
    assert!(missing.is_err(), "a configuration without a solution has no reach");
}
