//! The card-free betting skeleton (R2.9, R2.10, architecture decision record (ADR) 0020).
//!
//! Mechanism: `ActionTree::build` walks the same betting rules as the engine's tree
//! builder, step for step in f64 big blinds on the engine's 0.01 chip grid: the size from
//! the table, rounding to the chip grid, the min-raise floor, the stack cap, the all-in
//! threshold, the removal of a repeated amount, the raise cap per street and the donk rule
//! (out of position (OOP) leading into the previous street's aggressor). Those operations
//! are correctly rounded IEEE 754 arithmetic, so x86 and arm64 build the same skeleton. One
//! engine grid step is exactly one centi-big-blind (cbb), so every amount converts to an
//! exact `Cbb`.
//!
//! The skeleton deals no cards: where the engine has a chance node with one subtree per
//! runout card, the skeleton keeps one representative subtree. The solver adapter
//! multiplies the counts per street by the number of runout cards to get the engine's node
//! counts, and walks the decision nodes once per runout card to get its storage.
//!
//! At every decision node the buckets of the sized actions (bets, raises and the all-in)
//! must be distinct, else the build fails with `TreeError::BucketCollision` and never drops
//! an action in silence (O-137). A bet is bucketed by its size and a raise by its raise-to
//! total, each over the pot at the node, outstanding bet included (the engine's `Node.pot`).

use gto_model::{ActionToken, Cbb, Street};

use crate::error::TreeError;
use crate::player::Player;
use crate::postflop::config::TreeConfig;
use crate::postflop::skeleton;

/// The most nodes of every kind a skeleton may hold before `ActionTree::build` stops with
/// `TreeError::TooLarge`. A skeleton this large is far beyond any memory cap once the
/// runout cards multiply it.
pub const MAX_SKELETON_NODES: u64 = 2_000_000;

/// Where the postflop tree starts: the first street to bet, the pot in the middle and the
/// effective stack behind each player.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct RootState {
    /// Flop, turn or river; preflop is rejected.
    pub street: Street,
    /// The pot at the root.
    pub pot: Cbb,
    /// The effective stack each player has behind at the root.
    pub stack: Cbb,
}

/// One decision node of the skeleton.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct DecisionNode {
    /// The street in progress.
    pub street: Street,
    /// The player to act.
    pub player: Player,
    /// The pot at the node, an outstanding bet included (the engine's `Node.pot`).
    pub pot: Cbb,
    /// The chips behind, `[oop, ip]`.
    pub stacks: [Cbb; 2],
    /// Every action from the root to this node, across streets, with no card tokens.
    pub line: Vec<ActionToken>,
    /// The actions at this node in the engine's order: fold and call when facing a bet,
    /// else check; then the sized actions. `Bet` carries the bet size, `Raise` the
    /// raise-to total for the street, and an all-in is `AllIn`.
    pub actions: Vec<ActionToken>,
}

/// Node counts for the part of the skeleton played on one street. Every count here takes
/// the same runout multiplier in the engine's tree: a chance node is counted on the street
/// it closes, before the card it deals.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct StreetCounts {
    /// Decision nodes.
    pub decision: u64,
    /// Chance nodes that close this street and deal the next one.
    pub chance: u64,
    /// Fold terminals.
    pub fold: u64,
    /// Showdown terminals.
    pub showdown: u64,
    /// Actions summed over the decision nodes.
    pub actions: u64,
}

impl StreetCounts {
    /// Nodes of every kind: decision, chance, fold and showdown.
    #[must_use]
    pub fn nodes(&self) -> u64 {
        self.decision + self.chance + self.fold + self.showdown
    }
}

/// Node counts per street of a skeleton.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct SkeletonCounts {
    /// Flop counts, zero when the root is on a later street.
    pub flop: StreetCounts,
    /// Turn counts, zero when the root is the river.
    pub turn: StreetCounts,
    /// River counts.
    pub river: StreetCounts,
}

impl SkeletonCounts {
    /// The counts of one street, or `None` for preflop.
    #[must_use]
    pub fn street(&self, street: Street) -> Option<&StreetCounts> {
        match street {
            Street::Preflop => None,
            Street::Flop => Some(&self.flop),
            Street::Turn => Some(&self.turn),
            Street::River => Some(&self.river),
        }
    }

    /// The three streets summed.
    #[must_use]
    pub fn total(&self) -> StreetCounts {
        let streets = [self.flop, self.turn, self.river];
        streets.iter().fold(StreetCounts::default(), |sum, street| StreetCounts {
            decision: sum.decision + street.decision,
            chance: sum.chance + street.chance,
            fold: sum.fold + street.fold,
            showdown: sum.showdown + street.showdown,
            actions: sum.actions + street.actions,
        })
    }
}

/// The betting skeleton of one postflop tree.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActionTree {
    root: RootState,
    nodes: Vec<DecisionNode>,
    counts: SkeletonCounts,
}

impl ActionTree {
    /// Builds the skeleton of `cfg` from `root`, running the ADR 0020 bucket check at
    /// every decision node.
    ///
    /// # Errors
    ///
    /// `TreeError::Root` for a preflop root, an empty pot or an empty stack,
    /// `TreeError::BucketCollision` when two sized actions at one node share a bucket, and
    /// `TreeError::TooLarge` past `MAX_SKELETON_NODES` nodes.
    pub fn build(cfg: &TreeConfig, root: RootState) -> Result<Self, TreeError> {
        check_root(root)?;
        let skeleton = skeleton::build(cfg, root)?;
        Ok(ActionTree { root, nodes: skeleton.nodes, counts: skeleton.counts })
    }

    /// The root state the skeleton was built from.
    #[must_use]
    pub fn root(&self) -> RootState {
        self.root
    }

    /// The decision nodes, depth first with a parent before its children and children in
    /// action order, the order the engine's builder creates them for one runout.
    #[must_use]
    pub fn decision_nodes(&self) -> &[DecisionNode] {
        &self.nodes
    }

    /// The node counts per street.
    #[must_use]
    pub fn counts(&self) -> SkeletonCounts {
        self.counts
    }
}

/// Refuses a root the engine cannot start from, and one whose chips overflow the cbb range
/// once pot and both stacks are added, so every amount in the skeleton fits a `Cbb`.
fn check_root(root: RootState) -> Result<(), TreeError> {
    if root.street == Street::Preflop {
        return Err(TreeError::Root("a postflop tree cannot start preflop".to_owned()));
    }
    if root.pot == Cbb::ZERO {
        return Err(TreeError::Root("the pot is empty".to_owned()));
    }
    if root.stack == Cbb::ZERO {
        return Err(TreeError::Root("the stack is empty".to_owned()));
    }
    let chips = u64::from(root.pot.get()) + 2 * u64::from(root.stack.get());
    if chips > u64::from(u32::MAX) {
        let reason = format!("{chips} cbb in pot and stacks leaves the cbb range");
        return Err(TreeError::Root(reason));
    }
    Ok(())
}
