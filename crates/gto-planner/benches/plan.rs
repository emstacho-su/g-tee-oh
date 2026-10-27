//! Criterion bench `plan/enumerate_pair` (O-190): the planner's enumeration of one position
//! pair. The setup ranks the pairs of `cfg_6_online_100` under the S02 placeholder
//! convention with the O-181 prior and takes the top-ranked pair (every pair has 1,755
//! canonical flops, so the choice changes only the number of line texts copied); the
//! measured call is `pair_jobs`, which makes that pair's 1,755 jobs with priority and size.

use criterion::{Criterion, criterion_group, criterion_main};
use gto_model::v1_configs;
use gto_planner::{ConfigScope, PlannerSettings, PriorReach, pair_jobs, rank_pairs};
use gto_tree::{SizingConventionSpec, TreeConfig, tree_hash};

/// The S02 placeholder convention of `cfg_6_online_100` (the seed migration).
const ONLINE_PLACEHOLDER: &str = r#"{
    "placeholder_for": "cfg_6_online_100", "open_bb": 2.5,
    "iso_rule": {"base_bb": 3.0, "per_limper_bb": 1.0},
    "threebet_ip": 3.0, "threebet_oop": 4.0, "fourbet": 2.2, "straddle_bb": null,
    "postflop": {"flop": [0.33, 0.75], "turn": [0.75], "river": [0.75]}
}"#;

fn bench(c: &mut Criterion) {
    let config = v1_configs()
        .into_iter()
        .find(|config| config.config_id().as_str() == "cfg_6_online_100")
        .expect("the v1 catalog has cfg_6_online_100");
    let convention = SizingConventionSpec::from_json(ONLINE_PLACEHOLDER).expect("the seed spec");
    let hash = tree_hash(&TreeConfig::from_spec(&convention).expect("a tree"));
    let scope = ConfigScope { config, convention };
    let settings = PlannerSettings::default();
    let ranked = rank_pairs(&scope, &PriorReach, &settings).expect("the pairs");
    let top = ranked.first().expect("at least one pair");
    let config_id = scope.config.config_id();
    c.bench_function("plan/enumerate_pair", |b| {
        b.iter(|| pair_jobs(&config_id, std::hint::black_box(top), hash, &settings));
    });
}

criterion_group!(benches, bench);
criterion_main!(benches);
