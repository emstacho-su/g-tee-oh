//! Suit relabelling of solved nodes (S18, R2.12, A2 section 3, O-173).
//!
//! A flop build is solved on the canonical representative of its flop and stored under the
//! raw flop the job names. [`permute_node`] applies one suit permutation to a node: the
//! flop, turn and river cards of its key, and every hand of a 1,326-combo node, whose
//! reach, frequencies and expected values move with it. The hands are re-sorted by combo
//! index afterwards, the order the writer requires. A 169-class preflop node carries no
//! suits and comes back unchanged. Every function returns a new value.

use gto_model::{ComboId, NodeKey, StreetSection, SuitPermutation};

use crate::error::LibraryError;
use crate::record::{HandSpace, SolvedHand, SolvedNode};

/// The 1,326-combo index `hand` maps to under `perm`.
///
/// # Errors
///
/// `LibraryError::Model` when `hand` is not a combo index.
pub fn permute_combo(hand: u16, perm: SuitPermutation) -> Result<u16, LibraryError> {
    let (a, b) = ComboId::from_index(hand)?.cards();
    Ok(u16::from(ComboId::from_cards(perm.apply(a), perm.apply(b))?))
}

/// `key` with its flop, turn and river relabelled by `perm`; actions are unchanged. The
/// flop is re-sorted into written order by `SuitPermutation::apply_flop`.
///
/// # Errors
///
/// `LibraryError::Model` when the relabelled key fails its own checks.
pub fn permute_key(key: &NodeKey, perm: SuitPermutation) -> Result<NodeKey, LibraryError> {
    let permuted = NodeKey {
        flop: key.flop.as_ref().map(|section| StreetSection {
            cards: perm.apply_flop(section.cards),
            actions: section.actions.clone(),
        }),
        turn: key.turn.as_ref().map(|section| StreetSection {
            cards: perm.apply(section.cards),
            actions: section.actions.clone(),
        }),
        river: key.river.as_ref().map(|section| StreetSection {
            cards: perm.apply(section.cards),
            actions: section.actions.clone(),
        }),
        ..key.clone()
    };
    permuted.validate()?;
    Ok(permuted)
}

/// `node` relabelled by `perm` (see the module docs).
///
/// # Errors
///
/// `LibraryError::Model` when a hand index is not a combo or the key fails its checks.
pub fn permute_node(node: &SolvedNode, perm: SuitPermutation) -> Result<SolvedNode, LibraryError> {
    if node.hand_space == HandSpace::Preflop169 {
        return Ok(node.clone());
    }
    let mut hands = node
        .hands
        .iter()
        .map(|hand| Ok(SolvedHand { hand: permute_combo(hand.hand, perm)?, ..hand.clone() }))
        .collect::<Result<Vec<_>, LibraryError>>()?;
    hands.sort_by_key(|hand| hand.hand);
    Ok(SolvedNode { key: permute_key(&node.key, perm)?, hands, ..node.clone() })
}

#[cfg(test)]
mod tests {
    use gto_model::{ActionToken, Cbb, ConfigId, NodeKey, Position, PositionPair, SuitPermutation};

    use super::permute_key;

    /// R2.12: a key with no board comes back equal, and a flop key's cards are re-sorted.
    #[test]
    fn r2_12_permute_key_relabels_and_resorts_the_flop() {
        let pair = PositionPair::new(Position::Bb, Position::Btn).expect("two seats");
        let config = ConfigId::new("cfg_6_online_100").expect("a config id");
        let preflop = NodeKey::preflop(config, pair, vec![ActionToken::Raise(Cbb(250))]);
        let perm = SuitPermutation::all()[7];
        assert_eq!(permute_key(&preflop, perm).expect("permutes"), preflop);
        let flop = "Ah7d2c".parse().expect("a flop");
        let key = preflop.with_flop(flop, vec![ActionToken::Check]).expect("a flop key");
        let permuted = permute_key(&key, perm).expect("permutes");
        let section = permuted.flop.as_ref().expect("a flop section");
        assert_eq!(section.cards, perm.apply_flop(flop));
        assert_eq!(section.actions, vec![ActionToken::Check]);
    }
}
