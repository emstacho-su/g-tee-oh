//! Postflop size tables (R2.9, architecture decision records (ADR) 0020 and 0008).
//!
//! Mechanism: every size is an integer in basis points (bp) of the pot, so 0.33 of the pot
//! is 3,300 bp, and a table holds its sizes sorted and unique. A bet or a donk lead is
//! bucketed by its size over the pot at the node, so two bet sizes of one table in one
//! bucket can never meet ADR 0020's one size per bucket per node, and `TreeConfig::new`
//! rejects them up front (`TreeError::SameBucket`, O-137). A raise is bucketed by its
//! raise-to total over the pot at the node, outstanding bet included, which depends on the
//! line, so raises are checked node by node when the skeleton is built.
//!
//! Defaults for fields a spec leaves out follow O-136: raises are jam only, the raise cap
//! is `DEFAULT_RAISE_CAP` and the all-in threshold is `DEFAULT_ALLIN_THRESHOLD_BP`, the
//! engine's 67 percent of the stack behind.

use std::fmt;

use gto_model::{Bucket, Cbb, Street, bucket_for};

use crate::error::TreeError;
use crate::player::Player;
use crate::postflop::hash::TREE_HASH_TAG;
use crate::spec::SizingConventionSpec;
use crate::units::postflop_units;

/// bp in a whole: a pot for a size, a stack for the all-in threshold.
const BP_PER_WHOLE: u32 = 10_000;

/// The three postflop streets in canonical order.
const POSTFLOP_STREETS: [Street; 3] = [Street::Flop, Street::Turn, Street::River];

/// The most sizes one table may hold. Seven buckets bound a useful bet table, so this only
/// stops a runaway input.
const MAX_TABLE_SIZES: usize = 64;

/// Tables in a configuration: two players, three streets, three kinds.
const TABLE_COUNT: usize = 18;

/// Raises allowed per street after the opening bet when a spec names none (O-136).
pub const DEFAULT_RAISE_CAP: u8 = 3;

/// The all-in threshold in bp of the stack behind when a spec names none: a size that puts
/// in 67 percent of the stack or more becomes an all-in, as in the engine (O-136).
pub const DEFAULT_ALLIN_THRESHOLD_BP: u32 = 6_700;

/// Which table a size comes from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum SizeKind {
    /// The opening bet of a street.
    Bet,
    /// A raise facing a bet.
    Raise,
    /// An out-of-position lead into the previous street's aggressor.
    Donk,
}

impl SizeKind {
    /// The three kinds in canonical order: bet, raise, donk.
    pub const ALL: [SizeKind; 3] = [SizeKind::Bet, SizeKind::Raise, SizeKind::Donk];

    /// The lowercase name: `bet`, `raise` or `donk`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            SizeKind::Bet => "bet",
            SizeKind::Raise => "raise",
            SizeKind::Donk => "donk",
        }
    }
}

impl fmt::Display for SizeKind {
    /// The lowercase name, the same as `as_str`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// The sizes of one kind on one street for one player: sizes in bp of the pot, sorted and
/// unique, plus whether an all-in is offered beside them. The default is the empty table.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct SizeTable {
    sizes_bp: Vec<u32>,
    allin: bool,
}

impl SizeTable {
    /// A table from sizes in any order; duplicates collapse to one size.
    ///
    /// # Errors
    ///
    /// `TreeError::Spec` for a size of zero or for more than 64 sizes.
    pub fn new(sizes_bp: &[u32], allin: bool) -> Result<Self, TreeError> {
        if sizes_bp.contains(&0) {
            return Err(TreeError::Spec("a size of 0 bp of the pot offers no bet".to_owned()));
        }
        if sizes_bp.len() > MAX_TABLE_SIZES {
            let reason = format!("a table of {} sizes is above {MAX_TABLE_SIZES}", sizes_bp.len());
            return Err(TreeError::Spec(reason));
        }
        let mut sorted = sizes_bp.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        Ok(SizeTable { sizes_bp: sorted, allin })
    }

    /// The sizes in bp of the pot, ascending.
    #[must_use]
    pub fn sizes_bp(&self) -> &[u32] {
        &self.sizes_bp
    }

    /// True when an all-in is offered beside the sizes.
    #[must_use]
    pub fn allin(&self) -> bool {
        self.allin
    }

    /// The number of sizes, at most `MAX_TABLE_SIZES`, for the canonical bytes.
    #[allow(
        clippy::cast_possible_truncation,
        reason = "SizeTable::new keeps at most MAX_TABLE_SIZES sizes, far below u32::MAX"
    )]
    pub(crate) fn count(&self) -> u32 {
        self.sizes_bp.len() as u32
    }

    /// True when the table offers no size and no all-in.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.sizes_bp.is_empty() && !self.allin
    }
}

/// The three tables of one street.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct StreetSizes {
    /// Opening bets.
    pub bet: SizeTable,
    /// Raises.
    pub raise: SizeTable,
    /// Donk leads.
    pub donk: SizeTable,
}

impl StreetSizes {
    /// The table of one kind.
    #[must_use]
    pub fn kind(&self, kind: SizeKind) -> &SizeTable {
        match kind {
            SizeKind::Bet => &self.bet,
            SizeKind::Raise => &self.raise,
            SizeKind::Donk => &self.donk,
        }
    }
}

/// One player's tables on the three postflop streets.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct PlayerSizes {
    /// Flop tables.
    pub flop: StreetSizes,
    /// Turn tables.
    pub turn: StreetSizes,
    /// River tables.
    pub river: StreetSizes,
}

impl PlayerSizes {
    /// The tables of one street, or `None` for preflop.
    #[must_use]
    pub fn street(&self, street: Street) -> Option<&StreetSizes> {
        match street {
            Street::Preflop => None,
            Street::Flop => Some(&self.flop),
            Street::Turn => Some(&self.turn),
            Street::River => Some(&self.river),
        }
    }
}

/// A validated postflop tree configuration: both players' tables, the raise cap per street
/// and the all-in threshold in bp of the stack behind.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct TreeConfig {
    oop: PlayerSizes,
    ip: PlayerSizes,
    raise_cap: u8,
    allin_threshold_bp: u32,
}

impl TreeConfig {
    /// A configuration from its parts.
    ///
    /// # Errors
    ///
    /// `TreeError::SameBucket` when two bet or two donk sizes of one table fall in one
    /// bucket, and `TreeError::Spec` for an all-in threshold of zero or above 10,000 bp.
    pub fn new(
        oop: PlayerSizes,
        ip: PlayerSizes,
        raise_cap: u8,
        allin_threshold_bp: u32,
    ) -> Result<Self, TreeError> {
        if allin_threshold_bp == 0 || allin_threshold_bp > BP_PER_WHOLE {
            let reason =
                format!("allin_threshold_bp {allin_threshold_bp} is outside 1..={BP_PER_WHOLE}");
            return Err(TreeError::Spec(reason));
        }
        check_buckets(Player::Oop, &oop)?;
        check_buckets(Player::Ip, &ip)?;
        Ok(TreeConfig { oop, ip, raise_cap, allin_threshold_bp })
    }

    /// The configuration a spec describes, the same tables for both players, with the
    /// O-136 defaults for the fields the spec leaves out.
    ///
    /// # Errors
    ///
    /// The errors of `TreeConfig::new`, and `TreeError::OffGrid` or `TreeError::Spec` for
    /// a spec that did not come through `SizingConventionSpec::from_json`.
    pub fn from_spec(spec: &SizingConventionSpec) -> Result<Self, TreeError> {
        let postflop = &spec.postflop;
        let units = postflop_units(postflop)?;
        let bet_allin = postflop.bet_allin.unwrap_or(false);
        let raise_allin = postflop.raise_allin.unwrap_or(true);
        let raise_sizes = units.raise_sizes.unwrap_or_default();
        let street = |index: usize| -> Result<StreetSizes, TreeError> {
            Ok(StreetSizes {
                bet: SizeTable::new(&units.bet_sizes[index], bet_allin)?,
                raise: SizeTable::new(&raise_sizes[index], raise_allin)?,
                donk: SizeTable::default(),
            })
        };
        let sizes = PlayerSizes { flop: street(0)?, turn: street(1)?, river: street(2)? };
        TreeConfig::new(
            sizes.clone(),
            sizes,
            postflop.raise_cap.unwrap_or(DEFAULT_RAISE_CAP),
            units.allin_threshold_bp.unwrap_or(DEFAULT_ALLIN_THRESHOLD_BP),
        )
    }

    /// One player's tables.
    #[must_use]
    pub fn player(&self, player: Player) -> &PlayerSizes {
        match player {
            Player::Oop => &self.oop,
            Player::Ip => &self.ip,
        }
    }

    /// Raises allowed per street after the opening bet.
    #[must_use]
    pub fn raise_cap(&self) -> u8 {
        self.raise_cap
    }

    /// The all-in threshold in bp of the stack behind.
    #[must_use]
    pub fn allin_threshold_bp(&self) -> u32 {
        self.allin_threshold_bp
    }

    /// A readable text of every value the tree hash covers, one table per line in the
    /// canonical order, for the golden snapshot and for logs.
    #[must_use]
    pub fn canonical_description(&self) -> String {
        let header = [
            TREE_HASH_TAG.to_owned(),
            format!("allin_threshold_bp {}", self.allin_threshold_bp),
            format!("raise_cap {}", self.raise_cap),
        ];
        let tables = self.tables().into_iter().map(|(player, street, kind, table)| {
            let sizes: Vec<String> = table.sizes_bp().iter().map(u32::to_string).collect();
            format!(
                "{player} {street} {kind} sizes_bp [{}] allin {}",
                sizes.join(", "),
                table.allin()
            )
        });
        header.into_iter().chain(tables).collect::<Vec<_>>().join("\n")
    }

    /// Every table with its player, street and kind, in the canonical order: players OOP
    /// then IP, streets flop to river, kinds bet, raise, donk.
    pub(crate) fn tables(&self) -> Vec<(Player, Street, SizeKind, &SizeTable)> {
        let mut out = Vec::with_capacity(TABLE_COUNT);
        for player in Player::ALL {
            let sizes = self.player(player);
            for (street, tables) in POSTFLOP_STREETS.into_iter().zip(sizes.streets()) {
                for kind in SizeKind::ALL {
                    out.push((player, street, kind, tables.kind(kind)));
                }
            }
        }
        out
    }
}

impl PlayerSizes {
    /// The flop, turn and river tables, in that order.
    fn streets(&self) -> [&StreetSizes; 3] {
        [&self.flop, &self.turn, &self.river]
    }
}

/// The bucket of a size in bp of the pot: the bucket of that many cbb against a pot of
/// `BP_PER_WHOLE` cbb, which is the same ratio in exact integers.
fn bucket_of_bp(size_bp: u32) -> Result<Bucket, TreeError> {
    Ok(bucket_for(Cbb(size_bp), Cbb(BP_PER_WHOLE))?)
}

/// Rejects two bet or two donk sizes of one table in one bucket (O-137). The sizes are
/// sorted and buckets rise with size, so only neighbours can share a bucket.
fn check_buckets(player: Player, sizes: &PlayerSizes) -> Result<(), TreeError> {
    for (street, tables) in POSTFLOP_STREETS.into_iter().zip(sizes.streets()) {
        for kind in [SizeKind::Bet, SizeKind::Donk] {
            for pair in tables.kind(kind).sizes_bp().windows(2) {
                let bucket = bucket_of_bp(pair[0])?;
                if bucket == bucket_of_bp(pair[1])? {
                    return Err(TreeError::SameBucket { player, street, kind, bucket });
                }
            }
        }
    }
    Ok(())
}
