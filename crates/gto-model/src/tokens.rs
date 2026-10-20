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
//! no sign, no leading zero and no trailing text, and a size of zero is rejected. Display and
//! parse therefore round-trip exactly, which keeps node keys canonical (A3 section 1).
//!
//! Owner: the keys-and-tokens agent (files `tokens.rs`, `keys.rs` and `spot_class.rs`).

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

/// The letter that opens each token (A3 section 1). Sized tokens carry their cbb after it.
mod letter {
    pub const FOLD: &str = "f";
    pub const CHECK: &str = "x";
    pub const CALL: &str = "c";
    pub const LIMP: &str = "l";
    pub const STRADDLE: &str = "s";
    pub const BET: &str = "b";
    pub const RAISE: &str = "r";
    pub const ALL_IN: &str = "a";
}

impl ActionToken {
    /// The size carried by a straddle, bet or raise; `None` for the others.
    #[must_use]
    pub const fn size(self) -> Option<Cbb> {
        match self {
            ActionToken::Straddle(size) | ActionToken::Bet(size) | ActionToken::Raise(size) => {
                Some(size)
            }
            ActionToken::Fold
            | ActionToken::Check
            | ActionToken::Call
            | ActionToken::Limp
            | ActionToken::AllIn => None,
        }
    }

    /// True for a bet, a raise or an all-in: the actions that put chips in voluntarily
    /// after the blinds. A straddle is a blind posted before the deal, so it is not
    /// aggressive, and neither is a limp.
    #[must_use]
    pub const fn is_aggressive(self) -> bool {
        matches!(self, ActionToken::Bet(_) | ActionToken::Raise(_) | ActionToken::AllIn)
    }

    /// True for a fold.
    #[must_use]
    pub const fn is_fold(self) -> bool {
        matches!(self, ActionToken::Fold)
    }
}

impl fmt::Display for ActionToken {
    /// The token text: `f`, `x`, `c`, `l`, `s200`, `b250`, `r300`, `a`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ActionToken::Fold => f.write_str(letter::FOLD),
            ActionToken::Check => f.write_str(letter::CHECK),
            ActionToken::Call => f.write_str(letter::CALL),
            ActionToken::Limp => f.write_str(letter::LIMP),
            ActionToken::Straddle(size) => write!(f, "{}{size}", letter::STRADDLE),
            ActionToken::Bet(size) => write!(f, "{}{size}", letter::BET),
            ActionToken::Raise(size) => write!(f, "{}{size}", letter::RAISE),
            ActionToken::AllIn => f.write_str(letter::ALL_IN),
        }
    }
}

/// Parses the digits after a sized token's letter: one or more ASCII digits, no leading
/// zero (which also rules out zero itself), and nothing else. `None` when the text is not
/// such a size or does not fit in a `u32`.
fn parse_size(digits: &str) -> Option<Cbb> {
    let canonical = !digits.is_empty()
        && !digits.starts_with('0')
        && digits.bytes().all(|byte| byte.is_ascii_digit());
    if !canonical {
        return None;
    }
    digits.parse::<u32>().ok().map(Cbb)
}

impl FromStr for ActionToken {
    type Err = ModelError;

    /// One token, strictly as written by `Display`: the letter decides the variant, and a
    /// sized letter must be followed by a canonical size while a bare letter must end the
    /// text.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let invalid = || ModelError::InvalidToken(s.to_owned());
        let (first, rest) = s.split_at_checked(1).ok_or_else(invalid)?;
        let token = match (first, rest) {
            (letter::FOLD, "") => ActionToken::Fold,
            (letter::CHECK, "") => ActionToken::Check,
            (letter::CALL, "") => ActionToken::Call,
            (letter::LIMP, "") => ActionToken::Limp,
            (letter::ALL_IN, "") => ActionToken::AllIn,
            (letter::STRADDLE, size) => {
                ActionToken::Straddle(parse_size(size).ok_or_else(invalid)?)
            }
            (letter::BET, size) => ActionToken::Bet(parse_size(size).ok_or_else(invalid)?),
            (letter::RAISE, size) => ActionToken::Raise(parse_size(size).ok_or_else(invalid)?),
            _ => return Err(invalid()),
        };
        Ok(token)
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
    if s.is_empty() {
        return Ok(Vec::new());
    }
    s.split(LINE_SEPARATOR)
        .map(|piece| {
            if piece.is_empty() {
                let reason = format!("empty token beside a {LINE_SEPARATOR:?}");
                return Err(ModelError::InvalidLine(s.to_owned(), reason));
            }
            piece.parse()
        })
        .collect()
}

/// Writes tokens joined by `.`; no tokens gives the empty string.
#[must_use]
pub fn format_line(tokens: &[ActionToken]) -> String {
    let mut line = String::new();
    for (index, token) in tokens.iter().enumerate() {
        if index > 0 {
            line.push(LINE_SEPARATOR);
        }
        line.push_str(&token.to_string());
    }
    line
}
