//! Stakes, configurations and the configuration identifier (R2.2, ADR 0014, 01 section 3).
//! Solutions are keyed by stake, so the same action at 1/3 and at 2/5 resolves to different
//! solutions; the `ConfigId` is where that keying happens. Its grammar:
//!
//! ```text
//! cfg_<table size>_<format>_<stake slug>_<depth bb>[_straddle][_ante<cbb>]
//! ```
//!
//! The stake slug is the label lowercased with every character outside `[a-z0-9]` removed:
//! `1/3` becomes `13`, `2/5` becomes `25`, `NL25` becomes `nl25`. The depth is written in
//! whole big blinds when the cbb divide evenly and as `<cbb>cbb` otherwise. A3's example
//! `cfg_9_live_13_150` is 9-handed live at 1/3 with 150 bb stacks, no straddle, no ante.
//!
//! The v1 catalog (R0.6, O-72): one online stake and the live stakes 1/3 and 2/5; eleven
//! straddle-off configurations, online 6-max at 100, 150 and 200 bb and live 9-handed at
//! each stake at 100, 150, 200 and 300 bb.
//!
//! Owner: the rake-and-buckets agent (files `rake.rs`, `buckets.rs` and `config.rs`).

#![allow(
    unused_variables,
    clippy::unused_self,
    clippy::needless_pass_by_value,
    reason = "stub bodies are todo!() until the rake-and-buckets agent fills them in"
)]

use crate::types::{
    Cbb, ConfigId, GameConfig, GameFormat, ModelError, RakeModel, Stake, TableSize,
};

/// The prefix of every configuration identifier.
pub const CONFIG_ID_PREFIX: &str = "cfg";

/// The label of the one online stake row.
pub const ONLINE_STAKE_LABEL: &str = "NL25";

/// Online catalog depths in big blinds (01 section 3).
pub const ONLINE_DEPTHS_BB: [u32; 3] = [100, 150, 200];

/// Live catalog depths in big blinds (01 section 3).
pub const LIVE_DEPTHS_BB: [u32; 4] = [100, 150, 200, 300];

impl Stake {
    /// A validated stake row.
    ///
    /// # Errors
    ///
    /// `ModelError::InvalidStake` for an empty label, a zero big blind, or a small blind
    /// above the big blind.
    pub fn new(
        label: impl Into<String>,
        sb_cents: u32,
        bb_cents: u32,
        rake: RakeModel,
    ) -> Result<Stake, ModelError> {
        todo!()
    }

    /// Live 1/3: blinds $1 and $3, rake 10 percent capped at $5 (ADR 0014).
    #[must_use]
    pub fn live_1_3() -> Stake {
        todo!()
    }

    /// Live 2/5: blinds $2 and $5, rake 10 percent capped at the $5 default (O-2, O-66).
    #[must_use]
    pub fn live_2_5() -> Stake {
        todo!()
    }

    /// The one online stake row, `NL25` with blinds 10 and 25 cents and the online profile.
    #[must_use]
    pub fn online() -> Stake {
        todo!()
    }

    /// The label as it appears inside a configuration identifier.
    #[must_use]
    pub fn slug(&self) -> String {
        todo!()
    }
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
        todo!()
    }

    /// The identifier in the grammar above. Two configurations that differ only in stake
    /// get different identifiers (ADR 0014).
    #[must_use]
    pub fn config_id(&self) -> ConfigId {
        todo!()
    }
}

/// The eleven straddle-off v1 configurations (R0.6, O-72), online first, in catalog order.
#[must_use]
pub fn v1_configs() -> Vec<GameConfig> {
    todo!()
}
