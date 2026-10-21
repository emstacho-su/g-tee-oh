//! Shared fixtures for the gto-tree integration tests (R2.9, R1.6; R IDs are requirement
//! identifiers). Each test binary uses a subset, so the module declaration in each file
//! allows dead code.
//!
//! The two placeholder specs are the seed rows of
//! `db/migrations/20261020001100_seed_catalog.sql` for the online and live 1/3 100 big
//! blind (bb) configurations, written as JavaScript Object Notation (JSON). Strategies give
//! raw size tables in basis points (bp) of the pot; `RawPlayer::build` turns them into
//! `PlayerSizes` inside a test body, so a stub that panics fails the test rather than the
//! generator.

use gto_model::{GameConfig, PositionPair, v1_configs};
use gto_tree::{PlayerSizes, SizeTable, SizingConventionSpec, StreetSizes, TreeError};
use proptest::prelude::*;

/// The online placeholder spec of `cfg_6_online_100`, as the seed builds it.
pub const ONLINE_PLACEHOLDER_JSON: &str = r#"{
  "placeholder_for": "cfg_6_online_100",
  "open_bb": 2.5,
  "iso_rule": {"base_bb": 3.0, "per_limper_bb": 1.0},
  "threebet_ip": 3.0,
  "threebet_oop": 4.0,
  "fourbet": 2.2,
  "straddle_bb": null,
  "postflop": {"flop": [0.33, 0.75], "turn": [0.75], "river": [0.75]}
}"#;

/// The live placeholder spec of `cfg_9_live_13_100`, as the seed builds it.
pub const LIVE_PLACEHOLDER_JSON: &str = r#"{
  "placeholder_for": "cfg_9_live_13_100",
  "open_bb": 4.0,
  "iso_rule": {"base_bb": 4.0, "per_limper_bb": 1.0},
  "threebet_ip": 3.0,
  "threebet_oop": 3.5,
  "fourbet": 2.3,
  "straddle_bb": null,
  "postflop": {"flop": [0.33, 0.75], "turn": [0.75], "river": [0.75]}
}"#;

/// One size per size bucket, each at least 1,200 bp from every bucket edge: tiny, small,
/// medium, pot, overbet small, overbet large. Rounding a bet to the one centi-big-blind
/// (cbb) chip grid moves it by at most 0.5 percent of a pot of 100 cbb or more, so these
/// sizes never cross an edge.
pub const BUCKET_INTERIOR_BP: [u32; 6] = [1_500, 3_700, 6_200, 9_200, 13_000, 20_000];

/// The smallest and largest raw size the strategies draw, in bp of the pot.
pub const SIZE_RANGE_BP: std::ops::RangeInclusive<u32> = 500..=30_000;

/// A raw size table: sizes in bp of the pot in any order, and the all-in flag.
#[derive(Clone, Debug)]
pub struct RawTable {
    /// Sizes in bp, possibly repeated.
    pub sizes_bp: Vec<u32>,
    /// True when an all-in is offered.
    pub allin: bool,
}

impl RawTable {
    /// The validated table.
    pub fn build(&self) -> Result<SizeTable, TreeError> {
        SizeTable::new(&self.sizes_bp, self.allin)
    }
}

/// Raw tables of one street.
#[derive(Clone, Debug)]
pub struct RawStreet {
    /// Opening bets.
    pub bet: RawTable,
    /// Raises.
    pub raise: RawTable,
    /// Donk leads.
    pub donk: RawTable,
}

/// Raw tables of one player.
#[derive(Clone, Debug)]
pub struct RawPlayer {
    /// Flop tables.
    pub flop: RawStreet,
    /// Turn tables.
    pub turn: RawStreet,
    /// River tables.
    pub river: RawStreet,
}

impl RawStreet {
    fn build(&self) -> Result<StreetSizes, TreeError> {
        Ok(StreetSizes {
            bet: self.bet.build()?,
            raise: self.raise.build()?,
            donk: self.donk.build()?,
        })
    }
}

impl RawPlayer {
    /// The validated tables.
    pub fn build(&self) -> Result<PlayerSizes, TreeError> {
        Ok(PlayerSizes {
            flop: self.flop.build()?,
            turn: self.turn.build()?,
            river: self.river.build()?,
        })
    }
}

/// Up to `max_sizes` sizes drawn anywhere in `SIZE_RANGE_BP`.
pub fn free_table(max_sizes: usize) -> impl Strategy<Value = RawTable> + Clone {
    (prop::collection::vec(SIZE_RANGE_BP, 0..=max_sizes), any::<bool>())
        .prop_map(|(sizes_bp, allin)| RawTable { sizes_bp, allin })
}

/// Up to `max_sizes` sizes from `BUCKET_INTERIOR_BP`, at most one per bucket.
pub fn bucket_safe_table(max_sizes: usize) -> impl Strategy<Value = RawTable> + Clone {
    (prop::sample::subsequence(BUCKET_INTERIOR_BP.to_vec(), 0..=max_sizes), any::<bool>())
        .prop_map(|(sizes_bp, allin)| RawTable { sizes_bp, allin })
}

/// A player whose bet and donk tables come from `bets` and raise tables from `raises`.
pub fn raw_player(
    bets: impl Strategy<Value = RawTable> + Clone,
    raises: impl Strategy<Value = RawTable> + Clone,
) -> impl Strategy<Value = RawPlayer> {
    let street =
        (bets.clone(), raises, bets).prop_map(|(bet, raise, donk)| RawStreet { bet, raise, donk });
    (street.clone(), street.clone(), street).prop_map(|(flop, turn, river)| RawPlayer {
        flop,
        turn,
        river,
    })
}

/// A spec parsed from JSON, panicking with the error when it does not parse.
pub fn spec(json: &str) -> SizingConventionSpec {
    SizingConventionSpec::from_json(json).unwrap_or_else(|err| panic!("spec does not parse: {err}"))
}

/// The v1 catalog configuration with this identifier.
pub fn config(id: &str) -> GameConfig {
    v1_configs()
        .into_iter()
        .find(|config| config.config_id().as_str() == id)
        .unwrap_or_else(|| panic!("no v1 configuration {id}"))
}

/// A position pair from its canonical text, such as `BB-BTN`.
pub fn pair(text: &str) -> PositionPair {
    text.parse().unwrap_or_else(|err| panic!("{text} is not a pair: {err}"))
}

/// Every pair of two seats at the configuration's table.
pub fn seated_pairs(config: &GameConfig) -> Vec<PositionPair> {
    let seats = gto_model::Position::seated(config.table_size);
    seats
        .iter()
        .enumerate()
        .flat_map(|(index, a)| seats[index + 1..].iter().map(move |b| (*a, *b)))
        .map(|(a, b)| PositionPair::new(a, b).expect("two distinct seats"))
        .collect()
}
