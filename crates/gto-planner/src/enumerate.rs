//! Build-job enumeration and priority (R2.16, ADR 0013, O-203).
//!
//! Mechanism. For each configuration in scope, [`pair_lines`] builds the preflop tree of
//! every pair of seated positions and keeps the pairs with at least one flop line. Each
//! pair's priority is [`seat_share`] times the summed reach of its lines; the pairs are
//! ranked by that priority (ties by pair text) and the first `k_frequent_pairs` take
//! `k_runouts`, the rest `k_runouts_rare` (O-14, O-191). [`pair_jobs`] then makes one job
//! per canonical flop with the pair priority times the flop's natural frequency
//! (`weight / 22,100`, ADR 0023). The candidates of every scope are sorted by priority
//! descending, ties by [`JobKey`] ascending, so the same inputs always give the same order.

use gto_model::{ConfigId, Flop, Position, PositionPair, TableSize, canonical_flops, v1_configs};
use gto_tree::{PreflopLine, PreflopTree, TreeConfig, tree_hash};

use crate::error::PlanError;
use crate::reach::ReachSource;
use crate::settings::{ConfigScope, PlannerSettings};

/// The number of raw flops, the denominator of a flop's natural frequency.
pub const RAW_FLOPS: f64 = 22_100.0;

/// The seats of a position pair, the numerator of [`seat_share`].
const SEATS_PER_PAIR: f64 = 2.0;

/// The unique key of a `build_job` row: configuration, pair, flop text and tree hash.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct JobKey {
    /// `game_config.id`.
    pub game_config_id: String,
    /// The pair as text, for example `BB-BTN`.
    pub position_pair: String,
    /// The flop as text, for example `Ah7d2c`.
    pub flop: String,
    /// The sha256 of the postflop tree configuration.
    pub tree_config_hash: [u8; 32],
}

/// One planned flop build.
#[derive(Clone, Debug, PartialEq)]
pub struct JobSpec {
    /// The configuration.
    pub game_config_id: ConfigId,
    /// The pair.
    pub position_pair: PositionPair,
    /// The canonical flop.
    pub flop: Flop,
    /// The pair's flop lines as text, for example `r250.c`.
    pub preflop_lines: Vec<String>,
    /// `gto_tree::tree_hash` of the configuration's postflop tree.
    pub tree_config_hash: [u8; 32],
    /// Runouts to keep.
    pub k_runouts: u16,
    /// Seat rotation times equilibrium reach times flop frequency.
    pub priority: f64,
    /// `lines * (bytes_per_flop_tree + k * bytes_per_runout)`.
    pub estimated_bytes: u64,
}

impl JobSpec {
    /// The job's unique key.
    #[must_use]
    pub fn key(&self) -> JobKey {
        JobKey {
            game_config_id: self.game_config_id.to_string(),
            position_pair: self.position_pair.to_string(),
            flop: self.flop.to_string(),
            tree_config_hash: self.tree_config_hash,
        }
    }
}

/// One pair of a configuration after ranking: its flop lines, its priority (seat share
/// times summed line reach, the flop-free part) and the K its rank gives it.
#[derive(Clone, Debug, PartialEq)]
pub struct RankedPair {
    /// The pair.
    pub pair: PositionPair,
    /// Its flop lines, in the tree's order.
    pub lines: Vec<PreflopLine>,
    /// `seat_share * sum of line reaches`.
    pub priority: f64,
    /// Runouts to keep for every flop of the pair.
    pub k_runouts: u16,
}

/// The share of hands in which a hero rotating through every seat sits in one of a
/// pair's two seats: `2 / table_size`.
#[must_use]
pub fn seat_share(table_size: TableSize) -> f64 {
    SEATS_PER_PAIR / f64::from(table_size.get())
}

/// The estimated bytes of a build: `lines * (bytes_per_flop_tree + k * bytes_per_runout)`,
/// saturating at `u64::MAX`.
#[must_use]
pub fn estimated_bytes(lines: usize, k: u16, settings: &PlannerSettings) -> u64 {
    let lines = u64::try_from(lines).unwrap_or(u64::MAX);
    let per_line = settings
        .bytes_per_runout
        .saturating_mul(u64::from(k))
        .saturating_add(settings.bytes_per_flop_tree);
    lines.saturating_mul(per_line)
}

/// The flop lines of every pair of a configuration with at least one, pairs in
/// `PositionPair` order.
///
/// # Errors
///
/// `PlanError::Tree` when the preflop tree cannot be built.
pub fn pair_lines(scope: &ConfigScope) -> Result<Vec<(PositionPair, Vec<PreflopLine>)>, PlanError> {
    let config_id = scope.config.config_id();
    let mut found = Vec::new();
    for pair in seated_pairs(scope.config.table_size) {
        let tree = PreflopTree::build(&scope.convention, &scope.config, pair)
            .map_err(|source| PlanError::Tree { config_id: config_id.to_string(), source })?;
        if !tree.flop_lines().is_empty() {
            found.push((pair, tree.flop_lines().to_vec()));
        }
    }
    Ok(found)
}

/// Every pair of two different seated positions, in `PositionPair` order.
fn seated_pairs(table_size: TableSize) -> Vec<PositionPair> {
    let seats: &[Position] = Position::seated(table_size);
    let mut pairs: Vec<PositionPair> = seats
        .iter()
        .enumerate()
        .flat_map(|(index, a)| {
            seats[index + 1..].iter().filter_map(move |b| PositionPair::new(*a, *b).ok())
        })
        .collect();
    pairs.sort_unstable();
    pairs.dedup();
    pairs
}

/// Every candidate job of the configurations in scope, sorted by priority descending with
/// ties broken by `JobKey`, so the order is deterministic.
///
/// # Errors
///
/// `PlanError::UnknownConfig` for a configuration outside `v1_configs` (O-182),
/// `PlanError::Tree`, `PlanError::InvalidReach` for a reach that is not a probability, and
/// the reach source's errors.
pub fn enumerate(
    scopes: &[ConfigScope],
    reach: &dyn ReachSource,
    settings: &PlannerSettings,
) -> Result<Vec<JobSpec>, PlanError> {
    let mut keyed: Vec<(JobKey, JobSpec)> = Vec::new();
    for scope in scopes {
        let config_id = known_config(scope)?;
        let hash = scope_tree_hash(scope, &config_id)?;
        for ranked in rank_pairs(scope, reach, settings)? {
            let jobs = pair_jobs(&config_id, &ranked, hash, settings);
            keyed.extend(jobs.into_iter().map(|job| (job.key(), job)));
        }
    }
    keyed.sort_by(|(key_a, a), (key_b, b)| {
        b.priority.total_cmp(&a.priority).then_with(|| key_a.cmp(key_b))
    });
    Ok(keyed.into_iter().map(|(_, job)| job).collect())
}

/// The configuration's identifier when it is in the v1 catalog (O-182).
fn known_config(scope: &ConfigScope) -> Result<ConfigId, PlanError> {
    let config_id = scope.config.config_id();
    if v1_configs().iter().any(|config| config.config_id() == config_id) {
        Ok(config_id)
    } else {
        Err(PlanError::UnknownConfig(config_id.to_string()))
    }
}

/// `tree_hash` of the scope's postflop tree configuration.
fn scope_tree_hash(scope: &ConfigScope, config_id: &ConfigId) -> Result<[u8; 32], PlanError> {
    TreeConfig::from_spec(&scope.convention)
        .map(|tree| tree_hash(&tree))
        .map_err(|source| PlanError::Tree { config_id: config_id.to_string(), source })
}

/// The pairs of one configuration with their priority and K, highest priority first, ties
/// by pair text.
///
/// # Errors
///
/// `PlanError::Tree`, `PlanError::InvalidReach` and the reach source's errors.
pub fn rank_pairs(
    scope: &ConfigScope,
    reach: &dyn ReachSource,
    settings: &PlannerSettings,
) -> Result<Vec<RankedPair>, PlanError> {
    let config_id = scope.config.config_id();
    let share = seat_share(scope.config.table_size);
    let mut scored = Vec::new();
    for (pair, lines) in pair_lines(scope)? {
        let total = summed_reach(&config_id, &lines, reach)?;
        scored.push((pair, lines, share * total));
    }
    scored.sort_by(|(pair_a, _, a), (pair_b, _, b)| {
        b.total_cmp(a).then_with(|| pair_a.to_string().cmp(&pair_b.to_string()))
    });
    let frequent = usize::from(settings.k_frequent_pairs);
    Ok(scored
        .into_iter()
        .enumerate()
        .map(|(rank, (pair, lines, priority))| RankedPair {
            pair,
            lines,
            priority,
            k_runouts: if rank < frequent { settings.k_runouts } else { settings.k_runouts_rare },
        })
        .collect())
}

/// The sum of the lines' reaches, each checked to be a probability.
fn summed_reach(
    config_id: &ConfigId,
    lines: &[PreflopLine],
    reach: &dyn ReachSource,
) -> Result<f64, PlanError> {
    let mut total = 0.0;
    for line in lines {
        let value = reach.line_reach(config_id, line)?;
        if !(value.is_finite() && (0.0..=1.0).contains(&value)) {
            return Err(PlanError::InvalidReach {
                config_id: config_id.to_string(),
                line: line.text(),
                value,
            });
        }
        total += value;
    }
    Ok(total)
}

/// One job per canonical flop of a ranked pair, in canonical flop order, with priority
/// `pair priority * weight / 22,100` and the S14 size estimate.
#[must_use]
pub fn pair_jobs(
    config_id: &ConfigId,
    ranked: &RankedPair,
    tree_config_hash: [u8; 32],
    settings: &PlannerSettings,
) -> Vec<JobSpec> {
    let texts: Vec<String> = ranked.lines.iter().map(PreflopLine::text).collect();
    let bytes = estimated_bytes(ranked.lines.len(), ranked.k_runouts, settings);
    canonical_flops()
        .iter()
        .map(|canonical| JobSpec {
            game_config_id: config_id.clone(),
            position_pair: ranked.pair,
            flop: canonical.flop,
            preflop_lines: texts.clone(),
            tree_config_hash,
            k_runouts: ranked.k_runouts,
            priority: ranked.priority * f64::from(canonical.weight) / RAW_FLOPS,
            estimated_bytes: bytes,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::cmp::Ordering;

    use gto_model::{GameConfig, TableSize, v1_configs};
    use gto_tree::SizingConventionSpec;

    use super::*;
    use crate::reach::PriorReach;

    const ONLINE_PLACEHOLDER: &str = r#"{
        "placeholder_for": "cfg_6_online_100", "open_bb": 2.5,
        "iso_rule": {"base_bb": 3.0, "per_limper_bb": 1.0},
        "threebet_ip": 3.0, "threebet_oop": 4.0, "fourbet": 2.2, "straddle_bb": null,
        "postflop": {"flop": [0.33, 0.75], "turn": [0.75], "river": [0.75]}
    }"#;

    fn online_100() -> GameConfig {
        v1_configs()
            .into_iter()
            .find(|config| config.config_id().as_str() == "cfg_6_online_100")
            .expect("the catalog")
    }

    fn scope() -> ConfigScope {
        ConfigScope {
            config: online_100(),
            convention: SizingConventionSpec::from_json(ONLINE_PLACEHOLDER).expect("spec"),
        }
    }

    /// A reach source answering one value for every line.
    struct Fixed(f64);

    impl ReachSource for Fixed {
        fn line_reach(&self, _: &ConfigId, _: &PreflopLine) -> Result<f64, PlanError> {
            Ok(self.0)
        }
    }

    #[test]
    fn r2_16_estimated_bytes_saturates() {
        let settings = PlannerSettings { bytes_per_runout: u64::MAX, ..Default::default() };
        assert_eq!(estimated_bytes(2, 2, &settings), u64::MAX);
    }

    #[test]
    fn r2_16_seated_pairs_cover_every_two_seats() {
        assert_eq!(seated_pairs(TableSize::SIX_MAX).len(), 15);
        assert_eq!(seated_pairs(TableSize::HEADS_UP).len(), 1);
    }

    #[test]
    fn r2_16_a_reach_outside_zero_and_one_is_refused() {
        for bad in [1.5, -0.1, f64::NAN, f64::INFINITY] {
            let result = enumerate(&[scope()], &Fixed(bad), &PlannerSettings::default());
            assert!(matches!(result, Err(PlanError::InvalidReach { .. })), "{bad}");
        }
    }

    #[test]
    fn r2_16_a_configuration_outside_the_catalog_is_named() {
        let mut outside = scope();
        outside.config.table_size = TableSize::HEADS_UP;
        let result = enumerate(&[outside], &PriorReach, &PlannerSettings::default());
        assert!(matches!(result, Err(PlanError::UnknownConfig(_))), "{result:?}");
    }

    #[test]
    fn r2_16_a_tree_that_cannot_be_built_is_named() {
        let mut straddled = scope();
        straddled.config.straddle = true;
        let result = pair_lines(&straddled);
        assert!(
            matches!(&result, Err(PlanError::Tree { config_id, .. }) if config_id.contains("straddle")),
            "{result:?}"
        );
    }

    #[test]
    fn r2_16_pairs_rank_by_priority_then_text() {
        let ranked = rank_pairs(&scope(), &Fixed(0.5), &PlannerSettings::default()).expect("ok");
        let texts: Vec<String> = ranked.iter().map(|pair| pair.pair.to_string()).collect();
        for window in ranked.windows(2) {
            let order = window[1].priority.total_cmp(&window[0].priority);
            assert_ne!(order, Ordering::Greater, "{texts:?}");
            if order == Ordering::Equal {
                assert!(window[0].pair.to_string() < window[1].pair.to_string(), "{texts:?}");
            }
        }
        assert_eq!(ranked[0].k_runouts, 20);
        assert!(ranked[1..].iter().all(|pair| pair.k_runouts == 10));
        assert!(ranked.iter().all(|pair| pair.lines.iter().all(|line| line.pair == pair.pair)));
    }
}
