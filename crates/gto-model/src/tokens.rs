//! Action tokens (R2.1, A3 section 1). One token per action in a line, with sizes in
//! centi-big-blinds (cbb):
//!
//! | Token | Meaning |
//! |---|---|
//! | `f` | fold |
//! | `x` | check |
//! | `c` | call |
//! | `l` | limp |
//! | `s<cbb>` | straddle, for example `s200` |
//! | `b<cbb>` | bet of that size, for example `b250` |
//! | `r<cbb>` | raise to that total |
//! | `a` | all-in |
//!
//! A line is tokens joined by `.`, for example `r300.c`; an empty line has no tokens.
//! Parsing is strict so that every token has one spelling: a size is one or more digits with
//! no sign, no leading zero and no trailing text, and a size of zero is rejected.
//!
//! Owner: the keys-and-tokens agent (files `tokens.rs`, `keys.rs` and `spot_class.rs`).

#![allow(
    unused_variables,
    clippy::unused_self,
    reason = "stub bodies are todo!() until the keys-and-tokens agent fills them in"
)]

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::types::{Cbb, ModelError};

/// The separator between tokens in a line.
pub const LINE_SEPARATOR: char = '.';

/// One action in a line.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub enum ActionToken {
    /// `f`
    Fold,
    /// `x`
    Check,
    /// `c`
    Call,
    /// `l`
    Limp,
    /// `s<cbb>`, a straddle posted before the cards are dealt.
    Straddle(Cbb),
    /// `b<cbb>`, a bet of that size.
    Bet(Cbb),
    /// `r<cbb>`, a raise to that total.
    Raise(Cbb),
    /// `a`
    AllIn,
}

impl ActionToken {
    /// The size carried by a straddle, bet or raise; `None` for the others.
    #[must_use]
    pub fn size(self) -> Option<Cbb> {
        todo!()
    }

    /// True for a bet, a raise or an all-in: the actions that put chips in voluntarily
    /// after the blinds.
    #[must_use]
    pub fn is_aggressive(self) -> bool {
        todo!()
    }

    /// True for a fold.
    #[must_use]
    pub fn is_fold(self) -> bool {
        todo!()
    }
}

impl fmt::Display for ActionToken {
    /// The token text: `f`, `x`, `c`, `l`, `s200`, `b250`, `r300`, `a`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        todo!()
    }
}

impl FromStr for ActionToken {
    type Err = ModelError;

    /// One token, strictly as written by `Display`.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        todo!()
    }
}

impl TryFrom<String> for ActionToken {
    type Error = ModelError;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        s.parse()
    }
}

impl From<ActionToken> for String {
    fn from(token: ActionToken) -> String {
        token.to_string()
    }
}

/// Parses a line of tokens joined by `.`; the empty string is the empty line.
///
/// # Errors
///
/// `ModelError::InvalidLine` for an empty token (a leading, trailing or doubled dot),
/// `ModelError::InvalidToken` for a token that does not parse.
pub fn parse_line(s: &str) -> Result<Vec<ActionToken>, ModelError> {
    todo!()
}

/// Writes tokens joined by `.`; no tokens gives the empty string.
#[must_use]
pub fn format_line(tokens: &[ActionToken]) -> String {
    todo!()
}
