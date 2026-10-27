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

use gto_library::{ObjectStore, Reader, SolutionHandle, SolvedNode};
use gto_model::{ActionToken, ComboId, ConfigId, HandClass, NodeKey, PositionPair, format_line};
use gto_tree::{LineKind, PreflopLine};

use crate::error::PlanError;

/// Hand classes in the preflop hand space.
const CLASS_COUNT: usize = HandClass::COUNT as usize;

/// The O-181 placeholder reach of a single-raised pot.
const PRIOR_SINGLE_RAISED: f64 = 1.0;
/// The O-181 placeholder reach of a 3-bet pot.
const PRIOR_THREE_BET: f64 = 0.25;
/// The O-181 placeholder reach of a limped pot.
const PRIOR_LIMPED: f64 = 0.2;
/// The O-181 placeholder reach of a 4-bet pot.
const PRIOR_FOUR_BET: f64 = 0.05;

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
/// 0.2 and 4-bet pots 0.05. These are hand-made placeholders, not measured from any
/// solution: they only order the queue until a preflop solution is packed.
#[must_use]
pub fn prior_reach(kind: LineKind) -> f64 {
    match kind {
        LineKind::SingleRaised => PRIOR_SINGLE_RAISED,
        LineKind::ThreeBet => PRIOR_THREE_BET,
        LineKind::Limped => PRIOR_LIMPED,
        LineKind::FourBet => PRIOR_FOUR_BET,
    }
}

/// The O-181 fallback: [`prior_reach`] for every configuration.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PriorReach;

impl ReachSource for PriorReach {
    fn line_reach(&self, _config_id: &ConfigId, line: &PreflopLine) -> Result<f64, PlanError> {
        Ok(prior_reach(line.kind))
    }
}

/// Reach read from published preflop solutions, one per configuration and pair.
pub struct LibraryReach<S: ObjectStore> {
    reader: Reader<S>,
    handles: BTreeMap<(ConfigId, PositionPair), SolutionHandle>,
}

impl<S: ObjectStore> LibraryReach<S> {
    /// Opens the preflop solution at each `(configuration, pair, prefix)` through `reader`.
    /// A configuration and pair listed twice keeps the later prefix.
    ///
    /// # Errors
    ///
    /// `PlanError::Library` when a solution cannot be opened.
    pub fn open(
        reader: Reader<S>,
        prefixes: &[(ConfigId, PositionPair, String)],
    ) -> Result<Self, PlanError> {
        let mut handles = BTreeMap::new();
        for (config_id, pair, prefix) in prefixes {
            let handle = reader.open(prefix)?;
            handles.insert((config_id.clone(), *pair), handle);
        }
        Ok(LibraryReach { reader, handles })
    }

    /// Per seat of the pair, `[oop, ip]`, the reach of each of the 169 hand classes at the
    /// flop of `line`, in `HandClass` order: the product of that class's frequencies of
    /// the actions the seat takes along the line. The builder's `LibraryRanges` spreads
    /// these over each class's combos.
    ///
    /// # Errors
    ///
    /// `PlanError::MissingReach` without a solution for the configuration and pair;
    /// `PlanError::Library` when a node of the line cannot be read;
    /// `PlanError::LineNotInSolution` when a node does not offer the line's action.
    pub fn line_classes(
        &self,
        config_id: &ConfigId,
        line: &PreflopLine,
    ) -> Result<[Vec<f64>; 2], PlanError> {
        self.action_classes(config_id, line.pair, &line.actions)
    }

    /// [`LibraryReach::line_classes`] for a line given as its pair and actions, for callers
    /// that hold the line as text rather than as a `PreflopLine`.
    ///
    /// # Errors
    ///
    /// As [`LibraryReach::line_classes`].
    pub fn action_classes(
        &self,
        config_id: &ConfigId,
        pair: PositionPair,
        actions: &[ActionToken],
    ) -> Result<[Vec<f64>; 2], PlanError> {
        let handle = self.handles.get(&(config_id.clone(), pair)).copied().ok_or_else(|| {
            PlanError::MissingReach { config_id: config_id.to_string(), line: format_line(actions) }
        })?;
        let mut classes = [vec![1.0; CLASS_COUNT], vec![1.0; CLASS_COUNT]];
        for (depth, action) in actions.iter().enumerate() {
            let key = NodeKey::preflop(config_id.clone(), pair, actions[..depth].to_vec());
            let node = self.reader.node(handle, &key)?.to_solved(&key)?;
            let mismatch = |reason: String| PlanError::LineNotInSolution {
                config_id: config_id.to_string(),
                line: format_line(actions),
                reason,
            };
            let (seat, index) = actor_and_action(&node, pair, *action).map_err(mismatch)?;
            classes[seat] = taken_frequencies(&node, index, &classes[seat]);
        }
        Ok(classes)
    }
}

/// The actor's seat index in the pair (0 out of position, 1 in position) and the index of
/// `action` among the node's actions, or why the node does not match.
fn actor_and_action(
    node: &SolvedNode,
    pair: PositionPair,
    action: ActionToken,
) -> Result<(usize, usize), String> {
    let seat = if node.to_act == pair.oop() {
        0
    } else if node.to_act == pair.ip() {
        1
    } else {
        return Err(format!("node {} is acted on by {}, outside {pair}", node.key, node.to_act));
    };
    let index = node
        .actions
        .iter()
        .position(|(token, _)| *token == action)
        .ok_or_else(|| format!("node {} does not offer {action}", node.key))?;
    Ok((seat, index))
}

/// Each class's reach times its frequency of action `index` at `node`; a class the node
/// does not hold reaches it with zero.
fn taken_frequencies(node: &SolvedNode, index: usize, reach: &[f64]) -> Vec<f64> {
    let mut frequency = vec![0.0; CLASS_COUNT];
    for hand in &node.hands {
        if let (Some(slot), Some(value)) =
            (frequency.get_mut(usize::from(hand.hand)), hand.frequencies.get(index))
        {
            *slot = *value;
        }
    }
    reach.iter().zip(frequency).map(|(before, taken)| before * taken).collect()
}

/// `sum over classes of combos(class) / 1,326 * reach(class)` for one seat.
fn seat_reach(classes: &[f64]) -> f64 {
    HandClass::all()
        .zip(classes)
        .map(|(class, reach)| f64::from(class.combo_count()) / f64::from(ComboId::COUNT) * reach)
        .sum()
}

impl<S: ObjectStore> ReachSource for LibraryReach<S> {
    fn line_reach(&self, config_id: &ConfigId, line: &PreflopLine) -> Result<f64, PlanError> {
        let [oop, ip] = self.line_classes(config_id, line)?;
        Ok(seat_reach(&oop) * seat_reach(&ip))
    }
}

#[cfg(test)]
mod tests {
    use gto_library::{HandSpace, MemStore, ReaderOptions, SolvedHand};
    use gto_model::{Cbb, Position};

    use super::*;

    fn bb_btn() -> PositionPair {
        "BB-BTN".parse().expect("a pair")
    }

    /// A root node of BB-BTN acted on by `actor`, offering fold and call, holding classes
    /// 0 and 1 only, each folding a quarter of the time.
    fn node(actor: Position) -> SolvedNode {
        let config_id: ConfigId = "cfg_6_online_100".parse().expect("an id");
        SolvedNode {
            key: NodeKey::preflop(config_id, bb_btn(), Vec::new()),
            to_act: actor,
            pot: Cbb(150),
            stacks: [Cbb(9_900), Cbb(9_950)],
            actions: vec![(ActionToken::Fold, Cbb(0)), (ActionToken::Call, Cbb(0))],
            hand_space: HandSpace::Preflop169,
            hands: (0..2)
                .map(|hand| SolvedHand {
                    hand,
                    reach: None,
                    frequencies: vec![0.25, 0.75],
                    ev_bb: vec![0.0, 0.0],
                })
                .collect(),
            accuracy_pct_pot: None,
        }
    }

    #[test]
    fn r2_16_seat_reach_of_a_full_range_is_one() {
        let full = vec![1.0; CLASS_COUNT];
        assert!((seat_reach(&full) - 1.0).abs() < 1e-12);
        assert!(seat_reach(&vec![0.0; CLASS_COUNT]).abs() < 1e-12);
    }

    #[test]
    fn r2_16_the_actor_maps_through_the_pair() {
        assert_eq!(actor_and_action(&node(Position::Bb), bb_btn(), ActionToken::Call), Ok((0, 1)));
        assert_eq!(actor_and_action(&node(Position::Btn), bb_btn(), ActionToken::Fold), Ok((1, 0)));
        let outside = actor_and_action(&node(Position::Co), bb_btn(), ActionToken::Call);
        assert!(outside.is_err_and(|reason| reason.contains("CO")));
        let missing = actor_and_action(&node(Position::Bb), bb_btn(), ActionToken::Check);
        assert!(missing.is_err_and(|reason| reason.contains("does not offer")));
    }

    #[test]
    fn r2_16_a_class_the_node_lacks_reaches_it_with_zero() {
        let taken = taken_frequencies(&node(Position::Bb), 1, &vec![0.5; CLASS_COUNT]);
        assert!((taken[0] - 0.375).abs() < 1e-12);
        assert!((taken[1] - 0.375).abs() < 1e-12);
        assert!(taken[2..].iter().all(|reach| *reach == 0.0));
    }

    #[test]
    fn r2_16_prior_reach_ignores_the_configuration() {
        let config_id: ConfigId = "cfg_9_live_13_100".parse().expect("an id");
        let line = PreflopLine {
            pair: bb_btn(),
            actions: vec![ActionToken::Raise(Cbb(250)), ActionToken::Call],
            kind: LineKind::FourBet,
            flop_pot: Cbb(550),
            flop_stack: Cbb(9_750),
            aggressor: Some(Position::Btn),
        };
        let reach = PriorReach.line_reach(&config_id, &line).expect("the prior answers");
        assert!((reach - PRIOR_FOUR_BET).abs() < 1e-12);
    }

    #[test]
    fn r2_16_library_reach_names_its_failures() {
        let reader = Reader::new(MemStore::new(), ReaderOptions::default());
        let config_id: ConfigId = "cfg_6_online_100".parse().expect("an id");
        let absent = [(config_id.clone(), bb_btn(), "preflop/absent".to_owned())];
        let opened = LibraryReach::open(reader, &absent);
        assert!(matches!(opened, Err(PlanError::Library(_))), "{:?}", opened.err());

        let reader = Reader::new(MemStore::new(), ReaderOptions::default());
        let empty = LibraryReach::open(reader, &[]).expect("nothing to open");
        let missing = empty.action_classes(&config_id, bb_btn(), &[ActionToken::Call]);
        assert!(
            matches!(&missing, Err(PlanError::MissingReach { line, .. }) if line == "c"),
            "{missing:?}"
        );
    }
}
