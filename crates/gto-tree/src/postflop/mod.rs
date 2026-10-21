//! Postflop trees (R2.9). Three parts, each in its own file:
//!
//! - `config`: the size tables per player, street and kind (`TreeConfig`), with sizes in
//!   basis points (bp) of the pot, and the configuration-level bucket check.
//! - `hash`: the canonical bytes of a `TreeConfig` and their Secure Hash Algorithm 256
//!   (SHA-256) digest, the tree hash a solve records.
//! - `action_tree`: the card-free betting skeleton in centi-big-blinds (cbb), built with
//!   the engine's own sizing arithmetic, and the node-level bucket check of architecture
//!   decision record (ADR) 0020.

mod action_tree;
mod config;
mod hash;
mod skeleton;

pub use action_tree::{
    ActionTree, DecisionNode, MAX_SKELETON_NODES, RootState, SkeletonCounts, StreetCounts,
};
pub use config::{
    DEFAULT_ALLIN_THRESHOLD_BP, DEFAULT_RAISE_CAP, PlayerSizes, SizeKind, SizeTable, StreetSizes,
    TreeConfig,
};
pub use hash::{TREE_HASH_TAG, canonical_bytes, tree_hash, tree_hash_hex};
