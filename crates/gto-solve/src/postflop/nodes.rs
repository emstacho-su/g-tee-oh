//! The root-street node strategies of a solved game (R2.11, O-135): per decision node on
//! the root board, the actor, the pot and stacks, the actions as tokens, and per live
//! combo the reach, the average frequencies and the expected value (EV) of each action.
//! Gate G4's engine-side node dump is built from this; the engine stays behind
//! `gto-model` and `gto-tree` types.
//!
//! Mechanism. [`root_street_nodes`] walks the engine tree from the root through decision
//! nodes only, in action order, and stops at the first chance node and at every terminal,
//! so every node it returns sits on the root board: no runout, no suit isomorphism. Along
//! the path it carries both players' reach vectors, each player's root range weights
//! multiplied by that player's average strategy at the nodes where that player acted. At a
//! node where `hero` acts:
//!
//! - the frequencies are `Solver::average_strategy`, action-major, per live combo;
//! - the EV of action `a` for combo `i` is `br::subtree_values` at the child of `a` with
//!   the opponent's reach at the node, divided by the opponent mass compatible with `i`
//!   (`NlheGame::compatible_mass`), plus half the root pot, in big blinds (bb): the
//!   pot-inclusive figure of `NlheGame::ev_pot_share`, which at the root is exactly
//!   `NlheGame::root_combo_evs`; a combo no opponent hand can be matched with reports
//!   half the root pot, as `root_combo_evs` reports zero net;
//! - the reach of combo `i` for the actor is its matchup weight, the actor's reach times
//!   the compatible opponent mass, normalised to sum 1 over the node's hands; the reach
//!   for the opponent is the same matchup weight of that hand in the opponent's own live
//!   list, zero when the opponent cannot hold it. The pair order is `[oop, ip]`.
//!
//! Chips come off the engine's 0.01 grid through `cbb_of_chips`, so pots, stacks and sizes
//! are exact cbb. Action labels map to tokens as fold `f`, check `x`, call `c`, bet
//! `b<cbb>` and raise `r<cbb>` with the street total the label carries, and all-in `a`.
//!
//! Runouts (S18, O-173, O-174, R2.12). [`select_nodes`] with [`NodeSelection::Runout`]
//! walks past the root street along one chosen turn and river: every decision branch is
//! followed, and at a chance node only the child dealt the chosen card, with both reach
//! vectors compacted to the child's live combos through the engine's `parent_of_child` map.
//! It returns the turn and river decision nodes of that runout; reach stays normalised per
//! node and the EV keeps the root-street offset of half the root pot (O-175, O-202).

use gto_model::{ActionToken, Card, Cbb, ComboId};
use gto_tree::Player;
use postflop_engine::br;
use postflop_engine::cfr::{AverageStrategy, Solver};
use postflop_engine::game::{Game, NodeInfo};
use postflop_engine::nlhe::NlheGame;
use postflop_engine::tree::{ActionLabel, NodeKind};

use super::engine_map::cbb_of_chips;
use super::error::SolveError;
use super::solve::SolvedGame;

/// The share of the root pot each player is credited with in the pot-inclusive EV.
const HALF: f64 = 0.5;

/// One live combo's strategy at a node.
#[derive(Clone, Debug, PartialEq)]
pub struct HandStrategy {
    /// The combo.
    pub combo: ComboId,
    /// The matchup weight of the hand for each player, `[oop, ip]`, each column
    /// normalised over that player's live combos at the node.
    pub reach: [f64; 2],
    /// The average frequency of each action, in action order.
    pub frequencies: Vec<f32>,
    /// The EV of each action in bb, pot-inclusive, in action order.
    pub ev_bb: Vec<f64>,
}

/// One decision node of a solved game.
#[derive(Clone, Debug, PartialEq)]
pub struct NodeStrategy {
    /// The actions from the root to this node, every street concatenated.
    pub line: Vec<ActionToken>,
    /// The actions from the root to this node, one list per street from the root street:
    /// one list on the root street, two on the next, three on the river of a flop root.
    pub street_lines: Vec<Vec<ActionToken>>,
    /// The cards dealt below the root on the way to this node, in deal order; empty on
    /// the root street.
    pub dealt: Vec<Card>,
    /// The player to act.
    pub player: Player,
    /// The pot at the node, an outstanding bet included.
    pub pot: Cbb,
    /// The chips behind, `[oop, ip]`.
    pub stacks: [Cbb; 2],
    /// The actions at the node in the engine's order.
    pub actions: Vec<ActionToken>,
    /// The actor's live combos in canonical order.
    pub hands: Vec<HandStrategy>,
}

/// Which decision nodes of a solved game [`select_nodes`] returns.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NodeSelection {
    /// Every decision node on the root street (what [`root_street_nodes`] returns).
    RootStreet,
    /// Every decision node on the turn and river of one runout of a flop root: the turn
    /// dealt `turn`, then the river dealt `river`, every action branch kept.
    Runout {
        /// The turn card.
        turn: Card,
        /// The river card.
        river: Card,
    },
}

/// The decision nodes `selection` names, depth first with a parent before its children
/// and children in action order.
///
/// # Errors
///
/// `SolveError::Engine` as for [`root_street_nodes`]; `SolveError::Problem` when a runout
/// is asked of a root that is not a flop, or names a card on the board or twice.
pub fn select_nodes(
    game_solved: &SolvedGame,
    selection: &NodeSelection,
) -> Result<Vec<NodeStrategy>, SolveError> {
    match selection {
        NodeSelection::RootStreet => root_street_nodes(game_solved),
        NodeSelection::Runout { turn, river } => Err(SolveError::Problem(format!(
            "the runout walk ({turn}{river}) is not implemented yet (S18 lane X)"
        ))),
    }
}

/// Every decision node on the root street of a solved game, depth first with a parent
/// before its children and children in action order.
///
/// # Errors
///
/// `SolveError::Engine` when an engine amount sits off the 0.01 grid or a node names a
/// player other than 0 or 1.
pub fn root_street_nodes(game_solved: &SolvedGame) -> Result<Vec<NodeStrategy>, SolveError> {
    let solver = game_solved.solver();
    let game = solver.game();
    let walk = Walk {
        game,
        solver,
        profile: solver.average(),
        half_pot_bb: HALF * game.config().starting_pot,
    };
    let reach = [game.root_weights(0).to_vec(), game.root_weights(1).to_vec()];
    let mut nodes = Vec::new();
    walk.visit(game.root(), &[], &reach, &mut nodes)?;
    Ok(nodes)
}

/// The walk's shared state.
struct Walk<'a> {
    game: &'a NlheGame,
    solver: &'a Solver<NlheGame>,
    profile: AverageStrategy<'a, NlheGame>,
    half_pot_bb: f64,
}

impl Walk<'_> {
    /// Records `node` when it is a decision node and descends through its actions with the
    /// actor's reach multiplied by the average strategy; chance nodes and terminals end
    /// the walk.
    fn visit(
        &self,
        node: u32,
        line: &[ActionToken],
        reach: &[Vec<f32>; 2],
        out: &mut Vec<NodeStrategy>,
    ) -> Result<(), SolveError> {
        let NodeInfo::Decision { player, num_actions } = self.game.node(node) else {
            return Ok(());
        };
        let actor = Player::from_u8(player)
            .ok_or_else(|| SolveError::Engine(format!("node {node} names player {player}")))?;
        let strategy = self.solver.average_strategy(node);
        let actions = self.actions_at(node)?;
        let hands = self.hands_at(node, actor, &strategy, reach)?;
        let tree_node = self.game.node_at(node);
        out.push(NodeStrategy {
            line: line.to_vec(),
            street_lines: vec![line.to_vec()],
            dealt: Vec::new(),
            player: actor,
            pot: cbb_of_chips(tree_node.pot)?,
            stacks: [cbb_of_chips(tree_node.stacks[0])?, cbb_of_chips(tree_node.stacks[1])?],
            actions: actions.clone(),
            hands,
        });
        let combos = self.game.combo_count(node, player);
        for (action, token) in actions.into_iter().enumerate().take(num_actions) {
            let mut next = reach.clone();
            for (i, weight) in next[actor.index()].iter_mut().enumerate() {
                *weight *= strategy[action * combos + i];
            }
            let child_line = [line, &[token]].concat();
            self.visit(self.game.child(node, action), &child_line, &next, out)?;
        }
        Ok(())
    }

    /// The action tokens of a decision node, in the engine's order.
    fn actions_at(&self, node: u32) -> Result<Vec<ActionToken>, SolveError> {
        match &self.game.node_at(node).kind {
            NodeKind::Decision { actions, .. } => {
                actions.iter().map(|action| token_of(action.label)).collect()
            }
            _ => Err(SolveError::Engine(format!("node {node} is not a decision node"))),
        }
    }

    /// The actor's hands at `node`: combo, reach pair, frequencies and per-action EVs.
    fn hands_at(
        &self,
        node: u32,
        actor: Player,
        strategy: &[f32],
        reach: &[Vec<f32>; 2],
    ) -> Result<Vec<HandStrategy>, SolveError> {
        let hero = actor.as_u8();
        let opp_reach = &reach[actor.other().index()];
        let indices = self.game.combo_indices(node, hero);
        let combos = indices.len();
        let mass = self.game.compatible_mass(node, hero, opp_reach);
        let evs = self.action_evs(node, hero, opp_reach, &mass);
        let actor_reach = normalised(&reach[actor.index()], &mass);
        let opponent_reach = self.opponent_reach(node, actor, reach);
        indices
            .iter()
            .enumerate()
            .map(|(i, &index)| {
                let combo = ComboId::from_index(u16::try_from(index).unwrap_or(u16::MAX))
                    .map_err(|err| SolveError::Engine(format!("combo index {index}: {err}")))?;
                let mut pair = [0.0; 2];
                pair[actor.index()] = actor_reach[i];
                pair[actor.other().index()] = opponent_reach[index as usize];
                Ok(HandStrategy {
                    combo,
                    reach: pair,
                    frequencies: (0..evs.len()).map(|a| strategy[a * combos + i]).collect(),
                    ev_bb: evs.iter().map(|per_action| per_action[i]).collect(),
                })
            })
            .collect()
    }

    /// Per action, the pot-inclusive EV of each hero combo at the child of that action.
    fn action_evs(&self, node: u32, hero: u8, opp_reach: &[f32], mass: &[f32]) -> Vec<Vec<f64>> {
        let NodeInfo::Decision { num_actions, .. } = self.game.node(node) else {
            return Vec::new();
        };
        let mut values = vec![0.0f32; mass.len()];
        (0..num_actions)
            .map(|action| {
                let child = self.game.child(node, action);
                br::subtree_values(
                    self.game,
                    child,
                    hero,
                    &self.profile,
                    opp_reach,
                    false,
                    &mut values,
                );
                values
                    .iter()
                    .zip(mass)
                    .map(|(&value, &m)| {
                        let net = if m > 0.0 { f64::from(value) / f64::from(m) } else { 0.0 };
                        net + self.half_pot_bb
                    })
                    .collect()
            })
            .collect()
    }

    /// The opponent's matchup weight by canonical combo index, zero for a combo the
    /// opponent cannot hold at `node`.
    fn opponent_reach(&self, node: u32, actor: Player, reach: &[Vec<f32>; 2]) -> Vec<f64> {
        let opp = actor.other();
        let mass = self.game.compatible_mass(node, opp.as_u8(), &reach[actor.index()]);
        let weights = normalised(&reach[opp.index()], &mass);
        let mut by_index = vec![0.0; usize::from(ComboId::COUNT)];
        for (&index, weight) in self.game.combo_indices(node, opp.as_u8()).iter().zip(weights) {
            by_index[index as usize] = weight;
        }
        by_index
    }
}

/// `reach[i] * mass[i]` normalised to sum 1; all zero when nothing reaches the node.
fn normalised(reach: &[f32], mass: &[f32]) -> Vec<f64> {
    let products: Vec<f64> =
        reach.iter().zip(mass).map(|(&w, &m)| f64::from(w) * f64::from(m)).collect();
    let total: f64 = products.iter().sum();
    if total > 0.0 { products.into_iter().map(|p| p / total).collect() } else { products }
}

/// The token of an engine action label; bets and raises carry the street total.
fn token_of(label: ActionLabel) -> Result<ActionToken, SolveError> {
    Ok(match label {
        ActionLabel::Fold => ActionToken::Fold,
        ActionLabel::Check => ActionToken::Check,
        ActionLabel::Call => ActionToken::Call,
        ActionLabel::Bet(total) => ActionToken::Bet(cbb_of_chips(total)?),
        ActionLabel::Raise(total) => ActionToken::Raise(cbb_of_chips(total)?),
        ActionLabel::AllIn => ActionToken::AllIn,
    })
}

#[cfg(test)]
mod tests {
    use gto_model::{
        ActionToken, Board, Cbb, GameConfig, GameFormat, Position, PositionPair, Stake, TableSize,
    };
    use gto_tree::{
        DEFAULT_ALLIN_THRESHOLD_BP, DEFAULT_RAISE_CAP, LineKind, PlayerSizes, PreflopLine,
        SizeTable, StreetSizes, TreeConfig,
    };

    use super::super::options::{NoProgress, StopRule};
    use super::super::problem::{PostflopProblem, Range};
    use super::super::solve::solve_postflop;
    use super::root_street_nodes;

    /// Per-combo closeness of the walk's root EV to the engine's own `root_combo_evs`,
    /// both computed from the same `f32` figures.
    const EV_CLOSE_BB: f64 = 1e-4;

    /// A river root with three combos a side and one 75 percent bet, raises all-in only.
    fn river_problem() -> PostflopProblem {
        let street = || StreetSizes {
            bet: SizeTable::new(&[7_500], false).expect("a valid table"),
            raise: SizeTable::new(&[], true).expect("a valid table"),
            donk: SizeTable::default(),
        };
        let player = PlayerSizes { flop: street(), turn: street(), river: street() };
        let tree =
            TreeConfig::new(player.clone(), player, DEFAULT_RAISE_CAP, DEFAULT_ALLIN_THRESHOLD_BP)
                .expect("a valid tree");
        let line = PreflopLine {
            pair: PositionPair::new(Position::Bb, Position::Btn).expect("two seats"),
            actions: vec![ActionToken::Raise(Cbb(250)), ActionToken::Call],
            kind: LineKind::SingleRaised,
            flop_pot: Cbb(550),
            flop_stack: Cbb(9_750),
            aggressor: Some(Position::Btn),
        };
        let config = GameConfig::new(
            GameFormat::Online,
            TableSize::SIX_MAX,
            Stake::online(),
            Cbb::from_bb(100),
        );
        let flop = "Ah7d2c".parse().expect("a valid flop");
        let board = Board::new(
            flop,
            Some("Ks".parse().expect("a card")),
            Some("9h".parse().expect("a card")),
        )
        .expect("a valid board");
        let ranges = [
            Range::parse("AdAs,KcKh,6s5s").expect("a range"),
            Range::parse("JdJh,TdTh,8c8s").expect("a range"),
        ];
        let problem = PostflopProblem {
            config,
            line,
            board,
            ranges,
            pot: Cbb(2_500),
            stacks: [Cbb(8_775); 2],
            tree,
        };
        problem.validate().expect("a valid problem");
        problem
    }

    /// R2.11: at the root, the frequency-weighted sum of each combo's per-action EVs is
    /// the engine's `root_combo_evs` figure through `ev_pot_share`, combo for combo.
    #[test]
    fn r2_11_root_evs_agree_with_root_combo_evs() {
        let stop =
            StopRule { target_exploitability_pct_pot: 0.0, max_iterations: 20, max_seconds: 60 };
        let (game_solved, _) =
            solve_postflop(&river_problem(), stop, 0, &NoProgress).expect("solves");
        let nodes = root_street_nodes(&game_solved).expect("the walk");
        let root = &nodes[0];
        let cfr = game_solved.solver();
        let game = cfr.game();
        let engine = game.root_combo_evs(0, &cfr.average());
        assert_eq!(engine.len(), root.hands.len());
        for (hand, &figure) in root.hands.iter().zip(&engine) {
            let expected = f64::from(game.ev_pot_share(0, figure));
            let walked: f64 =
                hand.frequencies.iter().zip(&hand.ev_bb).map(|(f, ev)| f64::from(*f) * ev).sum();
            assert!(
                (walked - expected).abs() < EV_CLOSE_BB,
                "{}: {walked} against {expected}",
                hand.combo
            );
        }
        assert_eq!(root.actions, vec![ActionToken::Check, ActionToken::Bet(Cbb(1_875))]);
        assert_eq!(nodes.len(), 6, "a river root with one bet size and all-in raises");
    }
}
