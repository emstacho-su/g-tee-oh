//! Suit relabelling of solved nodes (S18, R2.12, A2 section 3, O-173).
//!
//! A flop build is solved on the canonical representative of its flop and stored under the
//! raw flop the job names. [`permute_node`] applies one suit permutation to a node: the
//! flop, turn and river cards of its key, and every hand of a 1,326-combo node, whose
//! reach, frequencies and expected values move with it. The hands are re-sorted by combo
//! index afterwards, the order the writer requires. A 169-class preflop node carries no
//! suits and comes back unchanged. Every function returns a new value.

use gto_model::{NodeKey, SuitPermutation};

use crate::error::LibraryError;
use crate::record::SolvedNode;

/// The 1,326-combo index `hand` maps to under `perm`.
///
/// # Errors
///
/// `LibraryError::Model` when `hand` is not a combo index.
pub fn permute_combo(hand: u16, perm: SuitPermutation) -> Result<u16, LibraryError> {
    let _ = perm;
    Err(LibraryError::InvalidRequest(format!(
        "permute_combo({hand}) is not implemented yet (S18 lane X)"
    )))
}

/// `key` with its flop, turn and river relabelled by `perm`; actions are unchanged.
///
/// # Errors
///
/// `LibraryError::Model` when the relabelled key fails its own checks.
pub fn permute_key(key: &NodeKey, perm: SuitPermutation) -> Result<NodeKey, LibraryError> {
    let _ = perm;
    Err(LibraryError::InvalidRequest(format!(
        "permute_key({key}) is not implemented yet (S18 lane X)"
    )))
}

/// `node` relabelled by `perm` (see the module docs).
///
/// # Errors
///
/// `LibraryError::Model` when a hand index is not a combo or the key fails its checks.
pub fn permute_node(node: &SolvedNode, perm: SuitPermutation) -> Result<SolvedNode, LibraryError> {
    let _ = perm;
    Err(LibraryError::InvalidRequest(format!(
        "permute_node({}) is not implemented yet (S18 lane X)",
        node.key
    )))
}
