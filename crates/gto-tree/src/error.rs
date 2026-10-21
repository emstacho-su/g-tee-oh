//! The one error type of the crate. Every fallible function in `gto-tree` returns
//! `TreeError`, so a caller such as the solver adapter wraps it whole. A size that breaks
//! the one-size-per-bucket rule of architecture decision record (ADR) 0020 is always an
//! error and never an action dropped in silence (O-137).

use gto_model::{Bucket, ModelError, Street};
use thiserror::Error;

use crate::player::Player;
use crate::postflop::SizeKind;

/// Every error this crate reports.
#[derive(Clone, Debug, PartialEq, Error)]
pub enum TreeError {
    /// The sizing convention spec does not parse, holds an unknown field, or breaks a rule
    /// named in the message (a size that is zero or negative, for example).
    #[error("invalid sizing convention spec: {0}")]
    Spec(String),
    /// A spec value is off its integer grid by more than 1e-9: big blinds to 0.01, pot
    /// fractions to 0.0001 and multipliers to 0.01.
    #[error("{field} is {value}, which is off its integer grid")]
    OffGrid {
        /// The spec field, as a dotted path such as `postflop.flop`.
        field: &'static str,
        /// The value as written.
        value: f64,
    },
    /// Two bet or two donk sizes of one table fall in one bucket, so the configuration can
    /// never satisfy ADR 0020 (O-137).
    #[error("two {kind} sizes for {player} on the {street} fall in the {bucket} bucket")]
    SameBucket {
        /// The player whose table holds the sizes.
        player: Player,
        /// The street of the table.
        street: Street,
        /// Bet or donk.
        kind: SizeKind,
        /// The bucket both sizes fall in.
        bucket: Bucket,
    },
    /// Out of position (OOP) holds donk sizes but no bet sizes on a street. The donk table
    /// applies only after a street the in-position player closed as the aggressor, never on
    /// the root street, so from a root on that street OOP could not lead at all; the engine
    /// refuses the same shape and the skeleton must not model it in silence (O-137).
    #[error("OOP has donk sizes but no bet sizes on the {street}, so it could not lead there")]
    DonkWithoutBet {
        /// The street whose OOP donk table is set while its bet table is empty.
        street: Street,
    },
    /// Two sized actions at one node of the betting skeleton fall in one bucket (ADR 0020,
    /// O-137). Raises are bucketed by their raise-to total over the pot at the node.
    #[error("two sized actions after line {line:?} fall in the {bucket} bucket")]
    BucketCollision {
        /// The action line from the root to the node, tokens joined by dots.
        line: String,
        /// The bucket both actions fall in.
        bucket: Bucket,
    },
    /// A root state the skeleton cannot start from: a preflop street, an empty pot or an
    /// empty stack.
    #[error("invalid root state: {0}")]
    Root(String),
    /// A preflop tree that cannot be built for the configuration and pair, for example a
    /// seat that is not at the table or a straddle with no straddle size in the spec.
    #[error("invalid preflop tree: {0}")]
    Preflop(String),
    /// The betting skeleton grows past `MAX_SKELETON_NODES` nodes.
    #[error("the betting skeleton grows past {limit} nodes")]
    TooLarge {
        /// The node limit that was reached.
        limit: u64,
    },
    /// A `gto-model` value was rejected, such as a bucket asked for against an empty pot.
    #[error(transparent)]
    Model(#[from] ModelError),
}
