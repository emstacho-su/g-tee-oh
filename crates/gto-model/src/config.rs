//! Stakes, configurations and the configuration identifier (R2.2, architecture decision
//! record (ADR) 0014, 01 section 3). Solutions are keyed by stake, so the same action at
//! 1/3 and at 2/5 resolves to different solutions; the `ConfigId` is where that keying
//! happens. Its grammar:
//!
//! ```text
//! cfg_<table size>_<format>[_<stake slug>]_<depth bb>[_straddle][_ante<cbb>]
//! ```
//!
//! The stake slug is the label lowercased with every character outside `[a-z0-9]` removed:
//! `1/3` becomes `13` and `2/5` becomes `25`. The slug segment is omitted when it equals
//! the format name, so the online rows, whose stake is labelled `online`, read
//! `cfg_6_online_100` rather than repeating the word, while the live rows keep their slug.
//! The depth is written in whole big blinds (bb) when the centi-big-blinds (cbb) divide
//! evenly and as `<cbb>cbb` otherwise. A3's example `cfg_9_live_13_150` is 9-handed live
//! at 1/3 with 150 bb stacks, no straddle, no ante.
//!
//! The v1 catalog (R0.6, O-72): one online stake and the live stakes 1/3 and 2/5; eleven
//! straddle-off configurations, online 6-max at 100, 150 and 200 bb and live 9-handed at
//! each stake at 100, 150, 200 and 300 bb. The ante field exists per O-33 and is zero in
//! every catalog row. The database seed, `db/migrations/20261020001100_seed_catalog.sql`,
//! is the catalog of record until O-7 settles the online rake set, and this module mirrors
//! it exactly (O-112): `tests/catalog_seed.rs` reads the seed and compares every row.
//!
//! Owner: the rake-and-buckets agent (files `rake.rs`, `buckets.rs` and `config.rs`).

use crate::rake::{LIVE_CAP_1_3_CENTS, LIVE_CAP_2_5_CENTS};
use crate::types::{
    Cbb, ConfigId, GameConfig, GameFormat, ModelError, RakeModel, Stake, TableSize,
};

/// The prefix of every configuration identifier.
pub const CONFIG_ID_PREFIX: &str = "cfg";

/// The separator between the segments of a configuration identifier.
pub const CONFIG_ID_SEPARATOR: &str = "_";

/// The segment appended when a straddle is posted.
pub const CONFIG_ID_STRADDLE: &str = "straddle";

/// The prefix of the ante segment; the ante in cbb follows it.
pub const CONFIG_ID_ANTE_PREFIX: &str = "ante";

/// The suffix of a depth that is not a whole number of big blinds.
pub const CONFIG_ID_CBB_SUFFIX: &str = "cbb";

/// The label of the live 1/3 stake row.
pub const LIVE_1_3_LABEL: &str = "1/3";

/// The label of the live 2/5 stake row.
pub const LIVE_2_5_LABEL: &str = "2/5";

/// The label of the one online stake row. It equals the format name, so its slug is left
/// out of configuration identifiers (see the module grammar).
pub const ONLINE_STAKE_LABEL: &str = "online";

/// Live 1/3 blinds in cents: $1 and $3.
const LIVE_1_3_BLINDS_CENTS: (u32, u32) = (100, 300);

/// Live 2/5 blinds in cents: $2 and $5.
const LIVE_2_5_BLINDS_CENTS: (u32, u32) = (200, 500);

/// Online blinds in cents: 25 and 50, the seed row's placeholder until O-7 settles which
/// online rake set defines the profile and with it the stake it is keyed at.
const ONLINE_BLINDS_CENTS: (u32, u32) = (25, 50);

/// Online catalog depths in big blinds (01 section 3).
pub const ONLINE_DEPTHS_BB: [u32; 3] = [100, 150, 200];

/// Live catalog depths in big blinds (01 section 3).
pub const LIVE_DEPTHS_BB: [u32; 4] = [100, 150, 200, 300];

impl Stake {
    /// A validated stake row.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidStake` for a label with no letter or digit (so its slug would be
    /// empty), a zero big blind, or a small blind above the big blind.
    pub fn new(
        label: impl Into<String>,
        sb_cents: u32,
        bb_cents: u32,
        rake: RakeModel,
    ) -> Result<Stake, ModelError> {
        let label = label.into();
        if slug_of(&label).is_empty() {
            return Err(ModelError::InvalidStake(format!(
                "label {label:?} has no letter or digit to name the stake"
            )));
        }
        if bb_cents == 0 {
            return Err(ModelError::InvalidStake(format!("stake {label} has a zero big blind")));
        }
        if sb_cents > bb_cents {
            return Err(ModelError::InvalidStake(format!(
                "stake {label} has a small blind of {sb_cents} cents above its big blind of {bb_cents} cents"
            )));
        }
        Ok(Stake { label, sb_cents, bb_cents, rake })
    }

    /// Live 1/3: blinds $1 and $3, rake 10 percent capped at $5 (ADR 0014).
    #[must_use]
    pub fn live_1_3() -> Stake {
        let (sb_cents, bb_cents) = LIVE_1_3_BLINDS_CENTS;
        Stake {
            label: LIVE_1_3_LABEL.to_owned(),
            sb_cents,
            bb_cents,
            rake: RakeModel::live(LIVE_CAP_1_3_CENTS),
        }
    }

    /// Live 2/5: blinds $2 and $5, rake 10 percent capped at the $5 default (O-2, O-66).
    #[must_use]
    pub fn live_2_5() -> Stake {
        let (sb_cents, bb_cents) = LIVE_2_5_BLINDS_CENTS;
        Stake {
            label: LIVE_2_5_LABEL.to_owned(),
            sb_cents,
            bb_cents,
            rake: RakeModel::live(LIVE_CAP_2_5_CENTS),
        }
    }

    /// The one online stake row, labelled `online`, with blinds 25 and 50 cents and the
    /// online profile (ADR 0014). The row is a placeholder that mirrors the database seed
    /// (O-112) until O-7 settles the online rake set.
    #[must_use]
    pub fn online() -> Stake {
        let (sb_cents, bb_cents) = ONLINE_BLINDS_CENTS;
        Stake {
            label: ONLINE_STAKE_LABEL.to_owned(),
            sb_cents,
            bb_cents,
            rake: RakeModel::online_profile(bb_cents),
        }
    }

    /// The label as it appears inside a configuration identifier: lowercased, with every
    /// character outside `[a-z0-9]` removed.
    #[must_use]
    pub fn slug(&self) -> String {
        slug_of(&self.label)
    }
}

/// The slug rule shared by `Stake::new` and `Stake::slug`.
fn slug_of(label: &str) -> String {
    label.chars().filter(char::is_ascii_alphanumeric).map(|c| c.to_ascii_lowercase()).collect()
}

impl GameConfig {
    /// A configuration with no straddle and no ante.
    #[must_use]
    pub fn new(
        format: GameFormat,
        table_size: TableSize,
        stake: Stake,
        depth_cbb: Cbb,
    ) -> GameConfig {
        GameConfig { format, table_size, stake, depth_cbb, straddle: false, ante_cbb: Cbb::ZERO }
    }

    /// The identifier in the grammar above. Two configurations that differ only in stake
    /// get different identifiers because the slug is a segment (ADR 0014); the segment is
    /// omitted when the slug repeats the format name, so the online rows read
    /// `cfg_6_online_100` (O-112).
    #[must_use]
    pub fn config_id(&self) -> ConfigId {
        let format = self.format.to_string();
        let slug = self.stake.slug();
        let stake_segment = if slug == format { None } else { Some(slug) };
        let ante = self.ante_cbb;
        let segments = [
            Some(CONFIG_ID_PREFIX.to_owned()),
            Some(self.table_size.to_string()),
            Some(format),
            stake_segment,
            Some(depth_segment(self.depth_cbb)),
            self.straddle.then(|| CONFIG_ID_STRADDLE.to_owned()),
            (ante != Cbb::ZERO).then(|| format!("{CONFIG_ID_ANTE_PREFIX}{ante}")),
        ];
        let id = segments.into_iter().flatten().collect::<Vec<String>>().join(CONFIG_ID_SEPARATOR);
        // Every segment is digits, a lowercase name or the separator, which is exactly the
        // ConfigId alphabet, so validation cannot fail here.
        match ConfigId::new(id) {
            Ok(id) => id,
            Err(err) => unreachable!("a config id built from validated segments: {err}"),
        }
    }
}

/// The depth segment: whole big blinds when the cbb divide evenly, else `<cbb>cbb`.
fn depth_segment(depth: Cbb) -> String {
    if depth.is_whole_bb() {
        depth.whole_bb().to_string()
    } else {
        format!("{depth}{CONFIG_ID_CBB_SUFFIX}")
    }
}

/// The eleven straddle-off v1 configurations (R0.6, O-72), online first, in catalog order:
/// online 6-max at each of `ONLINE_DEPTHS_BB`, then live 9-handed at 1/3 and at 2/5 at each
/// of `LIVE_DEPTHS_BB`.
#[must_use]
pub fn v1_configs() -> Vec<GameConfig> {
    let online = ONLINE_DEPTHS_BB.into_iter().map(|depth_bb| {
        GameConfig::new(
            GameFormat::Online,
            TableSize::SIX_MAX,
            Stake::online(),
            Cbb::from_bb(depth_bb),
        )
    });
    let live = [Stake::live_1_3(), Stake::live_2_5()].into_iter().flat_map(|stake| {
        LIVE_DEPTHS_BB.into_iter().map(move |depth_bb| {
            GameConfig::new(
                GameFormat::Live,
                TableSize::NINE_HANDED,
                stake.clone(),
                Cbb::from_bb(depth_bb),
            )
        })
    });
    online.chain(live).collect()
}

#[cfg(test)]
mod tests {
    use super::{LIVE_1_3_LABEL, depth_segment, slug_of};
    use crate::rake::LIVE_CAP_1_3_CENTS;
    use crate::types::{Cbb, ModelError, RakeModel, Stake};

    #[test]
    fn r2_2_catalog_rows_pass_their_own_validation() {
        let rake = RakeModel::live(LIVE_CAP_1_3_CENTS);
        assert_eq!(Stake::new(LIVE_1_3_LABEL, 100, 300, rake), Ok(Stake::live_1_3()));
        assert_eq!(Stake::new("2/5", 200, 500, RakeModel::live(500)), Ok(Stake::live_2_5()));
        let online = Stake::online();
        assert_eq!(Stake::new("online", 25, 50, online.rake), Ok(online));
    }

    #[test]
    fn r2_2_slug_keeps_only_ascii_letters_and_digits() {
        assert_eq!(slug_of("1/3"), "13");
        assert_eq!(slug_of("NL 50 fast"), "nl50fast");
        assert_eq!(slug_of("$1-$2"), "12");
        assert_eq!(slug_of("//"), "");
    }

    #[test]
    fn r2_2_a_label_without_a_slug_is_rejected() {
        let rake = RakeModel::live(500);
        assert!(matches!(Stake::new("/", 100, 300, rake), Err(ModelError::InvalidStake(_))));
    }

    #[test]
    fn r2_2_depth_segment_is_whole_bb_or_cbb() {
        assert_eq!(depth_segment(Cbb::from_bb(150)), "150");
        assert_eq!(depth_segment(Cbb(1_250)), "1250cbb");
        assert_eq!(depth_segment(Cbb::ZERO), "0");
    }
}
