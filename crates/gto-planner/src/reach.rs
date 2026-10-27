//! Equilibrium reach per preflop line (ADR 0013, O-181).
//!
//! Preflop solutions are stored one per configuration and position pair (O-132), on the
//! pair's two-seat tree with the other seats folded. [`LibraryReach`] reads them through
//! `gto-library`'s reader: walking the line's preflop nodes, each seat of the pair keeps a
//! per-class reach, the product of that class's frequencies of the actions the seat takes
//! along the line ([`LibraryReach::line_classes`]). The reach of the line is the product
//! over the two seats of `sum over classes of combos(class) / 1,326 * reach(class)`, the
//! seats' card removal against each other ignored. [`PriorReach`] is the fallback before
//! the first pack (O-181): one hand-made constant per line kind, a placeholder that only
//! orders pairs and lines, never a measured number.

use std::collections::BTreeMap;

use gto_library::{ObjectStore, Reader, SolutionHandle};
use gto_model::{ConfigId, PositionPair};
use gto_tree::{LineKind, PreflopLine};

use crate::error::PlanError;

/// Where the planner reads equilibrium reach from.
pub trait ReachSource {
    /// The probability that preflop play under equilibrium reaches `line`'s flop.
    ///
    /// # Errors
    ///
    /// `PlanError::MissingReach` when the source knows nothing of the configuration and
    /// pair; `PlanError::Library` when the solution cannot be read.
    fn line_reach(&self, config_id: &ConfigId, line: &PreflopLine) -> Result<f64, PlanError>;
}

/// The O-181 prior of a line kind: single-raised pots 1.0, 3-bet pots 0.25, limped pots
/// 0.2 and 4-bet pots 0.05, hand-made placeholders that order the queue until a preflop
/// solution is packed.
#[must_use]
pub fn prior_reach(kind: LineKind) -> f64 {
    let _ = kind;
    0.0
}

/// The O-181 fallback: [`prior_reach`] for every configuration.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PriorReach;

impl ReachSource for PriorReach {
    fn line_reach(&self, _config_id: &ConfigId, _line: &PreflopLine) -> Result<f64, PlanError> {
        Err(PlanError::NotImplemented("PriorReach::line_reach"))
    }
}

/// Reach read from published preflop solutions, one per configuration and pair.
pub struct LibraryReach<S: ObjectStore> {
    reader: Reader<S>,
    handles: BTreeMap<(ConfigId, PositionPair), SolutionHandle>,
}

impl<S: ObjectStore> LibraryReach<S> {
    /// Opens the preflop solution at each `(configuration, pair, prefix)` through `reader`.
    ///
    /// # Errors
    ///
    /// `PlanError::Library` when a solution cannot be opened.
    pub fn open(
        reader: Reader<S>,
        prefixes: &[(ConfigId, PositionPair, String)],
    ) -> Result<Self, PlanError> {
        let _ = prefixes;
        let _unopened = LibraryReach { reader, handles: BTreeMap::new() };
        Err(PlanError::NotImplemented("LibraryReach::open"))
    }

    /// Per seat of the pair, `[oop, ip]`, the reach of each of the 169 hand classes at the
    /// flop of `line`, in `HandClass` order: the product of that class's frequencies of
    /// the actions the seat takes along the line. The builder's `LibraryRanges` spreads
    /// these over each class's combos.
    ///
    /// # Errors
    ///
    /// `PlanError::MissingReach` without a solution for the configuration and pair;
    /// `PlanError::Library` when a node of the line cannot be read.
    pub fn line_classes(
        &self,
        config_id: &ConfigId,
        line: &PreflopLine,
    ) -> Result<[Vec<f64>; 2], PlanError> {
        let _ = (&self.reader, &self.handles, config_id, line);
        Err(PlanError::NotImplemented("LibraryReach::line_classes"))
    }
}

impl<S: ObjectStore> ReachSource for LibraryReach<S> {
    fn line_reach(&self, config_id: &ConfigId, line: &PreflopLine) -> Result<f64, PlanError> {
        let _ = (&self.reader, &self.handles, config_id, line);
        Err(PlanError::NotImplemented("LibraryReach::line_reach"))
    }
}
