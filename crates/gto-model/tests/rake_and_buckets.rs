//! R2.2 and R2.3 vectors for the rake-and-buckets module: the live caps in cbb, no flop no
//! drop, the one online profile, configuration identifiers keyed by stake (architecture
//! decision record (ADR) 0014), the v1 catalog, and the bet-bucket mapping with its
//! inclusive upper edges (ADR 0008).

use std::collections::BTreeSet;

use gto_model::buckets::{BUCKET_EDGES_PCT, Bucket, bucket_for};
use gto_model::config::v1_configs;
use gto_model::keys::NodeKey;
use gto_model::rake::{
    LIVE_CAP_1_3_CENTS, LIVE_RAKE_PERCENT_BP, ONLINE_CAP_BB, ONLINE_RAKE_PERCENT_BP,
};
use gto_model::tokens::ActionToken;
use gto_model::types::{
    Cbb, GameConfig, GameFormat, ModelError, Position, PositionPair, RakeModel, Stake, Street,
    TableSize,
};

fn live(stake: Stake, depth_bb: u32) -> GameConfig {
    GameConfig::new(GameFormat::Live, TableSize::NINE_HANDED, stake, Cbb::from_bb(depth_bb))
}

#[test]
fn r2_2_live_1_3_cap_is_167_cbb() {
    // $5 over a $3 big blind: 500 * 100 / 300 = 166.67, rounded to 167 (ADR 0014).
    let stake = Stake::live_1_3();
    assert_eq!(stake.label, "1/3");
    assert_eq!((stake.sb_cents, stake.bb_cents), (100, 300));
    assert_eq!(stake.rake, RakeModel { percent_bp: 1_000, cap_cents: 500, no_flop_no_drop: true });
    assert_eq!(stake.rake_cap_cbb(), Cbb(167));
    assert_eq!(stake.rake.cap_cbb(300), Cbb(167));
    assert_eq!(RakeModel::live(LIVE_CAP_1_3_CENTS), stake.rake);
    assert_eq!(LIVE_RAKE_PERCENT_BP, 1_000);
}

#[test]
fn r2_2_live_2_5_default_cap_is_100_cbb() {
    // $5 default over a $5 big blind (O-2, O-66): exactly one big blind.
    let stake = Stake::live_2_5();
    assert_eq!(stake.label, "2/5");
    assert_eq!((stake.sb_cents, stake.bb_cents), (200, 500));
    assert_eq!(stake.rake.cap_cents, 500);
    assert_eq!(stake.rake.percent_bp, 1_000);
    assert_eq!(stake.rake_cap_cbb(), Cbb(100));
    assert_ne!(Stake::live_1_3().rake_cap_cbb(), stake.rake_cap_cbb());
}

#[test]
fn r2_2_no_rake_at_a_preflop_terminal() {
    let stake = Stake::live_1_3();
    assert_eq!(stake.rake_cbb(Cbb(600), Street::Preflop), Cbb::ZERO);
    assert_eq!(stake.rake_cbb(Cbb(30_000), Street::Preflop), Cbb::ZERO);
    assert_eq!(stake.rake_cbb(Cbb(600), Street::Flop), Cbb(60));
    assert_eq!(Stake::live_2_5().rake_cbb(Cbb(600), Street::Preflop), Cbb::ZERO);
    // The online seed row carries no flop no drop as false (a placeholder pending O-7), so
    // its preflop terminal pays the 5 percent: 30 cbb of 600.
    assert_eq!(Stake::online().rake_cbb(Cbb(600), Street::Preflop), Cbb(30));
    let drop_preflop = RakeModel { no_flop_no_drop: false, ..stake.rake };
    assert_eq!(drop_preflop.rake_cbb(Cbb(600), 300, Street::Preflop), Cbb(60));
}

#[test]
fn r2_2_live_rake_is_ten_percent_to_the_cap() {
    let one_three = Stake::live_1_3();
    let two_five = Stake::live_2_5();
    for street in [Street::Flop, Street::Turn, Street::River] {
        assert_eq!(one_three.rake_cbb(Cbb(1_000), street), Cbb(100), "{street}");
        assert_eq!(one_three.rake_cbb(Cbb(1_670), street), Cbb(167), "{street}");
        assert_eq!(one_three.rake_cbb(Cbb(1_680), street), Cbb(167), "{street}");
        assert_eq!(one_three.rake_cbb(Cbb(3_000), street), Cbb(167), "{street}");
        assert_eq!(two_five.rake_cbb(Cbb(1_000), street), Cbb(100), "{street}");
        assert_eq!(two_five.rake_cbb(Cbb(3_000), street), Cbb(100), "{street}");
    }
    // Rounded to the nearest cbb with halves up: 10 percent of 1,005 is 100.5.
    assert_eq!(one_three.rake_cbb(Cbb(1_005), Street::Flop), Cbb(101));
    assert_eq!(one_three.rake_cbb(Cbb(1_004), Street::Flop), Cbb(100));
    assert_eq!(one_three.rake_cbb(Cbb::ZERO, Street::River), Cbb::ZERO);
}

#[test]
fn r2_2_online_is_one_profile() {
    // The seed row (O-112): label online, blinds 25 and 50 cents, 5 percent capped at 150
    // cents (3 bb), no flop no drop false, all placeholders pending O-7.
    let online = Stake::online();
    assert_eq!(online.label, "online");
    assert_eq!((online.sb_cents, online.bb_cents), (25, 50));
    assert_eq!(online.rake, RakeModel { percent_bp: 500, cap_cents: 150, no_flop_no_drop: false });
    assert_eq!(online.rake, RakeModel::online_profile(online.bb_cents));
    assert_eq!(online.rake_cap_cbb(), Cbb::from_bb(ONLINE_CAP_BB));
    assert_eq!(online.rake.percent_bp, ONLINE_RAKE_PERCENT_BP);
    assert!(!online.rake.no_flop_no_drop);
    assert_eq!(online.rake_cbb(Cbb(1_000), Street::Flop), Cbb(50));
    assert_eq!(online.rake_cbb(Cbb(30_000), Street::Flop), Cbb(300));
    let configs = v1_configs();
    let online_stakes: BTreeSet<&str> = configs
        .iter()
        .filter(|config| config.format == GameFormat::Online)
        .map(|config| config.stake.label.as_str())
        .collect();
    assert_eq!(online_stakes.len(), 1);
}

#[test]
fn r2_2_stake_validation_and_slug() {
    assert_eq!(Stake::live_1_3().slug(), "13");
    assert_eq!(Stake::live_2_5().slug(), "25");
    assert_eq!(Stake::online().slug(), "online");
    let rake = RakeModel::live(500);
    assert_eq!(Stake::new("5/10", 500, 1_000, rake).unwrap().slug(), "510");
    assert!(matches!(Stake::new("", 100, 300, rake), Err(ModelError::InvalidStake(_))));
    assert!(matches!(Stake::new("1/3", 100, 0, rake), Err(ModelError::InvalidStake(_))));
    assert!(matches!(Stake::new("3/1", 300, 100, rake), Err(ModelError::InvalidStake(_))));
}

#[test]
fn r2_2_stake_deserializes_through_new() {
    // A stake read from JavaScript Object Notation (JSON) passes Stake::new (O-111), so a
    // zero big blind fails at the read instead of at the first cap conversion.
    let zero_bb = concat!(
        r#"{"label":"1/3","sb_cents":100,"bb_cents":0,"#,
        r#""rake":{"percent_bp":1000,"cap_cents":500,"no_flop_no_drop":true}}"#
    );
    let parsed = serde_json::from_str::<Stake>(zero_bb);
    let err = parsed.expect_err("a zero big blind must not deserialize");
    assert!(err.to_string().contains("zero big blind"), "{err}");
    let text = serde_json::to_string(&Stake::live_1_3()).unwrap();
    assert_eq!(serde_json::from_str::<Stake>(&text).unwrap(), Stake::live_1_3());
}

#[test]
fn r2_2_config_id_differs_between_1_3_and_2_5() {
    // The same action at 1/3 and at 2/5 resolves to different solutions (ADR 0014,
    // success criterion 11).
    let one_three = live(Stake::live_1_3(), 150);
    let two_five = live(Stake::live_2_5(), 150);
    assert_eq!(one_three.config_id().as_str(), "cfg_9_live_13_150");
    assert_eq!(two_five.config_id().as_str(), "cfg_9_live_25_150");
    assert_ne!(one_three.config_id(), two_five.config_id());
    let pair = PositionPair::new(Position::Bb, Position::Btn).unwrap();
    let action = vec![ActionToken::Raise(Cbb(300)), ActionToken::Call];
    let at_1_3 = NodeKey::preflop(one_three.config_id(), pair, action.clone());
    let at_2_5 = NodeKey::preflop(two_five.config_id(), pair, action);
    assert_ne!(at_1_3, at_2_5);
    assert_ne!(at_1_3.to_string(), at_2_5.to_string());
    assert_eq!(at_1_3.to_string(), "cfg_9_live_13_150/BB-BTN/r300.c");
    assert_eq!(at_2_5.to_string(), "cfg_9_live_25_150/BB-BTN/r300.c");
}

#[test]
fn r2_2_config_id_grammar() {
    let online =
        GameConfig::new(GameFormat::Online, TableSize::SIX_MAX, Stake::online(), Cbb::from_bb(100));
    // The stake segment is omitted when the slug repeats the format name (O-112), so the
    // seed's online rows read cfg_6_online_100; any other online label keeps its slug.
    assert_eq!(online.config_id().as_str(), "cfg_6_online_100");
    assert!(!online.straddle);
    assert_eq!(online.ante_cbb, Cbb::ZERO);
    let other_label = Stake::new("NL50", 25, 50, RakeModel::online_profile(50)).unwrap();
    let keyed_by_label =
        GameConfig::new(GameFormat::Online, TableSize::SIX_MAX, other_label, Cbb::from_bb(100));
    assert_eq!(keyed_by_label.config_id().as_str(), "cfg_6_online_nl50_100");
    let straddled = GameConfig { straddle: true, ..live(Stake::live_1_3(), 150) };
    assert_eq!(straddled.config_id().as_str(), "cfg_9_live_13_150_straddle");
    let ante = GameConfig { ante_cbb: Cbb(50), ..live(Stake::live_1_3(), 300) };
    assert_eq!(ante.config_id().as_str(), "cfg_9_live_13_300_ante50");
    let both = GameConfig { straddle: true, ante_cbb: Cbb(50), ..live(Stake::live_2_5(), 200) };
    assert_eq!(both.config_id().as_str(), "cfg_9_live_25_200_straddle_ante50");
    let odd_depth = GameConfig { depth_cbb: Cbb(1_250), ..live(Stake::live_1_3(), 0) };
    assert_eq!(odd_depth.config_id().as_str(), "cfg_9_live_13_1250cbb");
}

#[test]
fn r2_2_v1_catalog_has_11_distinct_configs() {
    let configs = v1_configs();
    assert_eq!(configs.len(), 11);
    let ids: BTreeSet<String> =
        configs.iter().map(|config| config.config_id().to_string()).collect();
    assert_eq!(ids.len(), 11);
    assert!(ids.contains("cfg_6_online_100"));
    assert!(ids.contains("cfg_6_online_200"));
    assert!(ids.contains("cfg_9_live_13_100"));
    assert!(ids.contains("cfg_9_live_25_300"));
    assert!(configs.iter().all(|config| !config.straddle && config.ante_cbb == Cbb::ZERO));
    assert_eq!(configs.iter().filter(|config| config.format == GameFormat::Online).count(), 3);
    assert_eq!(configs.iter().filter(|config| config.format == GameFormat::Live).count(), 8);
    assert_eq!(configs[0].config_id().as_str(), "cfg_6_online_100");
}

#[test]
fn r2_3_bucket_edges_are_the_adr_0008_numbers() {
    assert_eq!(BUCKET_EDGES_PCT, [25, 50, 75, 110, 150]);
    assert_eq!(Bucket::ALL.len(), 7);
    assert_eq!(Bucket::ALL[6], Bucket::AllIn);
    let vectors = [
        (Bucket::Tiny, "Tiny", "tiny", Some((0, Some(25)))),
        (Bucket::Small, "Small", "small", Some((25, Some(50)))),
        (Bucket::Medium, "Medium", "medium", Some((50, Some(75)))),
        (Bucket::Pot, "Pot", "pot", Some((75, Some(110)))),
        (Bucket::OverbetSmall, "Overbet small", "overbet-small", Some((110, Some(150)))),
        (Bucket::OverbetLarge, "Overbet large", "overbet-large", Some((150, None))),
        (Bucket::AllIn, "All-in", "all-in", None),
    ];
    for (bucket, label, name, range) in vectors {
        assert_eq!(bucket.label(), label);
        assert_eq!(bucket.as_str(), name);
        assert_eq!(bucket.to_string(), name);
        assert_eq!(bucket.range_pct(), range);
    }
}

#[test]
fn r2_3_bucket_upper_edge_inclusive() {
    // At a 100 bb pot one cbb is 0.01 percent: 2,499 is 24.99 percent and 2,501 is 25.01.
    let pot = Cbb(10_000);
    let vectors = [
        (0, Bucket::Tiny),
        (1, Bucket::Tiny),
        (2_499, Bucket::Tiny),
        (2_500, Bucket::Tiny),
        (2_501, Bucket::Small),
        (5_000, Bucket::Small),
        (5_001, Bucket::Medium),
        (7_500, Bucket::Medium),
        (7_501, Bucket::Pot),
        (10_000, Bucket::Pot),
        (11_000, Bucket::Pot),
        (11_001, Bucket::OverbetSmall),
        (15_000, Bucket::OverbetSmall),
        (15_001, Bucket::OverbetLarge),
        (30_000, Bucket::OverbetLarge),
        (1_000_000, Bucket::OverbetLarge),
    ];
    for (size, bucket) in vectors {
        assert_eq!(bucket_for(Cbb(size), pot).unwrap(), bucket, "{size} at {pot}");
    }
}

#[test]
fn r2_3_bucket_one_tick_above_an_edge_at_any_pot() {
    // Integer arithmetic: 83 of 333 is 24.92 percent and 84 is 25.23 percent.
    let vectors = [
        (83, 333, Bucket::Tiny),
        (84, 333, Bucket::Small),
        (166, 333, Bucket::Small),
        (167, 333, Bucket::Medium),
        (250, 1_000, Bucket::Tiny),
        (251, 1_000, Bucket::Small),
        (500, 1_000, Bucket::Small),
        (501, 1_000, Bucket::Medium),
        (750, 1_000, Bucket::Medium),
        (751, 1_000, Bucket::Pot),
        (1_100, 1_000, Bucket::Pot),
        (1_101, 1_000, Bucket::OverbetSmall),
        (1_500, 1_000, Bucket::OverbetSmall),
        (1_501, 1_000, Bucket::OverbetLarge),
        (1, 1, Bucket::Pot),
        (2, 1, Bucket::OverbetLarge),
    ];
    for (size, pot, bucket) in vectors {
        assert_eq!(bucket_for(Cbb(size), Cbb(pot)).unwrap(), bucket, "{size} at {pot}");
    }
}

#[test]
fn r2_3_all_in_is_its_own_bucket() {
    let pot = Cbb(10_000);
    assert_eq!(Bucket::of_action(ActionToken::AllIn, pot).unwrap(), Some(Bucket::AllIn));
    assert_eq!(Bucket::of_action(ActionToken::AllIn, Cbb(1)).unwrap(), Some(Bucket::AllIn));
    assert_eq!(Bucket::of_action(ActionToken::Bet(Cbb(2_000)), pot).unwrap(), Some(Bucket::Tiny));
    assert_eq!(Bucket::of_action(ActionToken::Raise(Cbb(9_000)), pot).unwrap(), Some(Bucket::Pot));
    let huge = Bucket::of_action(ActionToken::Bet(Cbb(40_000)), pot).unwrap();
    assert_eq!(huge, Some(Bucket::OverbetLarge));
    let passive = [
        ActionToken::Fold,
        ActionToken::Check,
        ActionToken::Call,
        ActionToken::Limp,
        ActionToken::Straddle(Cbb(200)),
    ];
    for action in passive {
        assert_eq!(Bucket::of_action(action, pot).unwrap(), None, "{action}");
    }
    assert!(Bucket::ALL[..6].iter().all(|bucket| *bucket != Bucket::AllIn));
}

#[test]
fn r2_3_bucket_zero_pot_is_an_error() {
    assert_eq!(bucket_for(Cbb(100), Cbb::ZERO), Err(ModelError::ZeroPot));
    assert_eq!(Bucket::of_action(ActionToken::Bet(Cbb(100)), Cbb::ZERO), Err(ModelError::ZeroPot));
    assert_eq!(Bucket::of_action(ActionToken::AllIn, Cbb::ZERO), Ok(Some(Bucket::AllIn)));
    assert_eq!(Bucket::of_action(ActionToken::Call, Cbb::ZERO), Ok(None));
}
