//! The two players of a heads-up postflop tree. The out-of-position (OOP) player is 0 and
//! the in-position (IP) player is 1, which is the engine's numbering and the order the
//! library format stores in `to_act` (O-130), so an index means the same thing in every
//! crate.

use std::fmt;

use gto_model::{Position, PositionPair};
use serde::{Deserialize, Serialize};

/// A player in a heads-up postflop tree.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[repr(u8)]
pub enum Player {
    /// Out of position: acts first on every postflop street.
    Oop = 0,
    /// In position: acts last on every postflop street.
    Ip = 1,
}

impl Player {
    /// Both players, OOP first.
    pub const ALL: [Player; 2] = [Player::Oop, Player::Ip];

    /// The index into a two-element array such as `[oop, ip]`: 0 or 1.
    #[must_use]
    pub const fn index(self) -> usize {
        self as usize
    }

    /// The engine's player number: 0 or 1.
    #[must_use]
    pub const fn as_u8(self) -> u8 {
        self as u8
    }

    /// The player for an engine player number, or `None` above 1.
    #[must_use]
    pub const fn from_u8(value: u8) -> Option<Player> {
        match value {
            0 => Some(Player::Oop),
            1 => Some(Player::Ip),
            _ => None,
        }
    }

    /// The other player.
    #[must_use]
    pub const fn other(self) -> Player {
        match self {
            Player::Oop => Player::Ip,
            Player::Ip => Player::Oop,
        }
    }

    /// The lowercase name: `oop` or `ip`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Player::Oop => "oop",
            Player::Ip => "ip",
        }
    }

    /// The seat this player holds in a position pair: `pair.oop()` for OOP, `pair.ip()`
    /// for IP.
    #[must_use]
    pub fn position(self, pair: PositionPair) -> Position {
        match self {
            Player::Oop => pair.oop(),
            Player::Ip => pair.ip(),
        }
    }
}

impl fmt::Display for Player {
    /// The lowercase name, the same as `as_str`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use gto_model::{Position, PositionPair};

    use super::Player;

    #[test]
    fn r2_9_player_numbers_round_trip() {
        for player in Player::ALL {
            assert_eq!(Player::from_u8(player.as_u8()), Some(player));
            assert_eq!(player.index(), usize::from(player.as_u8()));
            assert_eq!(player.other().other(), player);
            assert_eq!(player.to_string(), player.as_str());
        }
        assert_eq!(Player::from_u8(2), None);
        assert_eq!((Player::Oop.index(), Player::Ip.index()), (0, 1));
    }

    #[test]
    fn r2_9_player_seats_follow_the_pair() {
        let pair = PositionPair::new(Position::Btn, Position::Bb).expect("two seats");
        assert_eq!(Player::Oop.position(pair), Position::Bb);
        assert_eq!(Player::Ip.position(pair), Position::Btn);
    }
}
