//! Runout extraction E6b, the glue between a solve and the library (R2.12, O-17, O-101,
//! O-173): walked nodes (`gto-solve`'s `NodeStrategy`, labelled with the canonical flop
//! the solve ran on) become the library's `SolvedNode`s, relabelled to the raw flop the
//! job names.
//!
//! Mechanism: [`to_solved_node`] builds the node key from the job's preflop line, the
//! canonical flop and the node's street lines and dealt cards (`NodeKey::with_flop`,
//! `with_turn`, `with_river`); maps the actor through the pair to a position; gives each
//! action its total wager in cbb from its token; and keeps every hand's combo index,
//! reach, frequencies and per-action EV (O-175, O-202) in the 1,326-combo space. Then
//! `gto_library::permute_node` applies the canonical-to-raw suit permutation to the key's
//! cards and to every per-combo array (A2 section 3). [`extract_line`] does this for the
//! root street (the flop file) and for each runout (the runout files) and relabels the
//! runout cards the same way. The property `extract(permute(input)) ==
//! permute(extract(input))` is tested over [`permute_strategies`].
//!
//! Wagers. A fold or a check wagers 0 and a bet or raise its street total. A call and an
//! all-in need the chips already in on the street, which the node's current street line
//! gives: replayed in turn order (the actor at the node acts after the last token, so the
//! tokens alternate back from it), a bet or raise sets its player's street total, a call
//! matches the larger total, and an all-in puts in the street's starting stack. Every
//! street before a decision node closed with equal contributions, so both players start a
//! street with the same stack, which is the actor's stack at the node plus the actor's
//! total so far (the actor has not gone all-in, or it would not be acting). A call then
//! wagers the larger street total (the last bet or raise, or that starting stack after an
//! all-in, 0 when nothing was bet) and an all-in wagers the starting stack.

use gto_library::{HandSpace, LineBuild, RunoutSpec, SolvedHand, SolvedNode, permute_node};
use gto_model::{
    ActionToken, Cbb, ComboId, ConfigId, Flop, NodeKey, PositionPair, SuitPermutation,
};
use gto_solve::postflop::{HandStrategy, NodeStrategy};
use gto_tree::Player;

use crate::error::BuilderError;
use crate::solve::SolvedLine;

/// Streets below the flop a runout deals: the turn and the river.
const MAX_DEALT: usize = 2;

/// What every node of one line shares.
#[derive(Clone, Debug, PartialEq)]
pub struct ExtractContext {
    /// The configuration in the keys.
    pub config_id: ConfigId,
    /// The pair in the keys.
    pub pair: PositionPair,
    /// The preflop actions of the line.
    pub preflop: Vec<ActionToken>,
    /// The flop the solve ran on (canonical for a planner job).
    pub solved_flop: Flop,
    /// The permutation from the solved flop's labels to the job's raw labels.
    pub to_raw: SuitPermutation,
    /// The accuracy every node records, percent of the pot (O-22, O-130).
    pub accuracy_pct_pot: Option<f32>,
}

/// One walked node as a library node in the solved flop's labels (no permutation).
///
/// # Errors
///
/// `BuilderError::Model` when the key cannot be built; `BuilderError::Malformed` when the
/// node's street lines and dealt cards disagree.
pub fn to_solved_node(
    ctx: &ExtractContext,
    node: &NodeStrategy,
) -> Result<SolvedNode, BuilderError> {
    let key = node_key(ctx, node)?;
    let to_act = match node.player {
        Player::Oop => ctx.pair.oop(),
        Player::Ip => ctx.pair.ip(),
    };
    let current = node.street_lines.last().map_or(&[][..], Vec::as_slice);
    let actions = node
        .actions
        .iter()
        .map(|token| (*token, wager(*token, current, node.stacks[node.player.index()])))
        .collect();
    Ok(SolvedNode {
        key,
        to_act,
        pot: node.pot,
        stacks: node.stacks,
        actions,
        hand_space: HandSpace::Postflop1326,
        hands: node.hands.iter().map(solved_hand).collect(),
        accuracy_pct_pot: ctx.accuracy_pct_pot,
    })
}

/// The key of `node`: the preflop line, the solved flop with the first street line, then
/// a turn and a river section per dealt card.
fn node_key(ctx: &ExtractContext, node: &NodeStrategy) -> Result<NodeKey, BuilderError> {
    if node.street_lines.len() != node.dealt.len() + 1 || node.dealt.len() > MAX_DEALT {
        return Err(BuilderError::Malformed {
            path: format!("node {:?}", node.line),
            reason: format!(
                "{} street lines for {} dealt cards; a node has one line per street",
                node.street_lines.len(),
                node.dealt.len()
            ),
        });
    }
    let mut lines = node.street_lines.iter().cloned();
    let flop_line = lines.next().unwrap_or_default();
    let mut key = NodeKey::preflop(ctx.config_id.clone(), ctx.pair, ctx.preflop.clone())
        .with_flop(ctx.solved_flop, flop_line)?;
    for (index, (card, line)) in node.dealt.iter().zip(lines).enumerate() {
        key = if index == 0 { key.with_turn(*card, line)? } else { key.with_river(*card, line)? };
    }
    Ok(key)
}

/// The total wager of `token` for the actor at a node whose current street line is
/// `street` and whose stack is `stack` (see the module docs).
fn wager(token: ActionToken, street: &[ActionToken], stack: Cbb) -> Cbb {
    match token {
        ActionToken::Bet(total) | ActionToken::Raise(total) => total,
        ActionToken::Call => street_totals(street, stack).0,
        ActionToken::AllIn => street_totals(street, stack).1,
        _ => Cbb(0),
    }
}

/// Replays `street` for the actor who acts after its last token with `stack` behind:
/// the larger street total a call matches, and the street's starting stack.
fn street_totals(street: &[ActionToken], stack: Cbb) -> (Cbb, Cbb) {
    // Totals indexed by distance parity from the actor: 0 the actor, 1 the opponent.
    let mut totals = [0_u32; 2];
    let mut all_in = [false; 2];
    for (index, token) in street.iter().enumerate() {
        let who = (street.len() - index) % 2;
        match token {
            ActionToken::Bet(total) | ActionToken::Raise(total) => totals[who] = total.get(),
            ActionToken::Call => totals[who] = totals[0].max(totals[1]),
            ActionToken::AllIn => all_in[who] = true,
            _ => {}
        }
    }
    let starting = stack.get().saturating_add(totals[0]);
    for (total, went_all_in) in totals.iter_mut().zip(all_in) {
        if went_all_in {
            *total = starting;
        }
    }
    (Cbb(totals[0].max(totals[1])), Cbb(starting))
}

/// One walked hand in the library's terms: reach kept, frequencies widened to `f64`.
fn solved_hand(hand: &HandStrategy) -> SolvedHand {
    SolvedHand {
        hand: u16::from(hand.combo),
        reach: Some(hand.reach),
        frequencies: hand.frequencies.iter().map(|f| f64::from(*f)).collect(),
        ev_bb: hand.ev_bb.clone(),
    }
}

/// Walked nodes as library nodes, relabelled by `ctx.to_raw`.
///
/// # Errors
///
/// As [`to_solved_node`] and `permute_node`.
pub fn extract_nodes(
    ctx: &ExtractContext,
    nodes: &[NodeStrategy],
) -> Result<Vec<SolvedNode>, BuilderError> {
    nodes.iter().map(|node| Ok(permute_node(&to_solved_node(ctx, node)?, ctx.to_raw)?)).collect()
}

/// A solved line as the library's `LineBuild` on the raw flop: the flop nodes, and per
/// runout (relabelled) its turn and river nodes.
///
/// # Errors
///
/// As [`extract_nodes`].
pub fn extract_line(
    ctx: &ExtractContext,
    line: &str,
    tree_hash: &str,
    seed: u64,
    solved: &SolvedLine,
) -> Result<LineBuild, BuilderError> {
    let runouts = solved
        .runout_nodes
        .iter()
        .map(|(runout, nodes)| {
            Ok((permute_runout(*runout, ctx.to_raw), extract_nodes(ctx, nodes)?))
        })
        .collect::<Result<Vec<_>, BuilderError>>()?;
    Ok(LineBuild {
        line: line.to_owned(),
        tree_hash: tree_hash.to_owned(),
        seed,
        iterations: u64::from(solved.report.iterations),
        exploitability_pct_pot: solved.gains_pct_pot,
        flop_nodes: extract_nodes(ctx, &solved.root_nodes)?,
        runouts,
    })
}

/// Walked nodes relabelled by `perm`: dealt cards and every hand's combo, hands re-sorted
/// by combo index. The test-side half of the R2.12 property.
///
/// # Errors
///
/// `BuilderError::Model` when a combo cannot be rebuilt.
pub fn permute_strategies(
    nodes: &[NodeStrategy],
    perm: SuitPermutation,
) -> Result<Vec<NodeStrategy>, BuilderError> {
    nodes
        .iter()
        .map(|node| {
            let mut hands = node
                .hands
                .iter()
                .map(|hand| {
                    let (a, b) = hand.combo.cards();
                    let combo = ComboId::from_cards(perm.apply(a), perm.apply(b))?;
                    Ok(HandStrategy { combo, ..hand.clone() })
                })
                .collect::<Result<Vec<_>, BuilderError>>()?;
            hands.sort_by_key(|hand| u16::from(hand.combo));
            let dealt = node.dealt.iter().map(|card| perm.apply(*card)).collect();
            Ok(NodeStrategy { dealt, hands, ..node.clone() })
        })
        .collect()
}

/// A runout relabelled by `perm`.
#[must_use]
pub fn permute_runout(runout: RunoutSpec, perm: SuitPermutation) -> RunoutSpec {
    RunoutSpec { turn: perm.apply(runout.turn), river: perm.apply(runout.river) }
}

#[cfg(test)]
mod tests {
    use gto_model::{ActionToken, Cbb};

    use super::wager;

    const X: ActionToken = ActionToken::Check;

    /// R2.12: a call matches the last bet or raise of its street, an all-in puts in the
    /// street's starting stack, and a call facing an all-in matches that stack.
    #[test]
    fn r2_12_wagers_follow_the_street_line() {
        let bet = ActionToken::Bet(Cbb(400));
        let raise = ActionToken::Raise(Cbb(1_200));
        assert_eq!(wager(ActionToken::Call, &[X, bet], Cbb(8_600)), Cbb(400));
        assert_eq!(wager(ActionToken::Call, &[bet, raise], Cbb(8_600)), Cbb(1_200));
        assert_eq!(wager(ActionToken::Call, &[], Cbb(9_000)), Cbb(0));
        assert_eq!(wager(ActionToken::AllIn, &[X, bet], Cbb(9_000)), Cbb(9_000));
        // The actor bet 400 and faces an all-in: 8,600 behind plus 400 in.
        assert_eq!(wager(ActionToken::AllIn, &[bet, raise], Cbb(8_600)), Cbb(9_000));
        assert_eq!(wager(ActionToken::Call, &[bet, ActionToken::AllIn], Cbb(8_600)), Cbb(9_000));
        assert_eq!(wager(ActionToken::Fold, &[bet], Cbb(9_000)), Cbb(0));
        assert_eq!(wager(raise, &[bet], Cbb(9_000)), Cbb(1_200));
    }
}
