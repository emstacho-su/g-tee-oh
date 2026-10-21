//! The byte codec of `NodeRecord` (R2.7, A3 section 4, O-130): `encoded_len`, `encode` and
//! `decode`, with the code tables for streets, action tokens and buckets. The layout is in the
//! `record` module docs; this file turns it into bytes and back.
//!
//! Mechanism: `encode` checks every table against the action and hand counts first, so the
//! bytes it appends always decode. `decode` reads the fixed header, then the hand tables, and
//! every length is bounds-checked through `LeReader`, so malformed input is an error and
//! never a panic.
//!
//! Lane W (writer) owns this file.

use gto_model::{ActionToken, Bucket, Cbb, Street};

use crate::chunk::LeReader;
use crate::error::LibraryError;
use crate::quantize::FREQUENCY_SCALE;

use super::{
    FLAG_ACCURACY, FLAG_POSTFLOP_1326, FLAG_REACH, FLAG_RESERVED_MASK, FLAG_SPARSE, HandSpace,
    NodeRecord, RecordAction,
};

/// Bytes before the action table: hash 8, four `u8` fields, pot 4, two stacks 4 each.
const HEADER_BYTES: usize = 24;
/// One action: type `u8`, size `u32`, bucket `u8`.
const ACTION_BYTES: usize = 6;
/// Action tokens in type-code order (O-130); sized tokens carry a placeholder size here.
const TOKEN_CODES: [ActionToken; 8] = [
    ActionToken::Fold,
    ActionToken::Check,
    ActionToken::Call,
    ActionToken::Limp,
    ActionToken::Straddle(Cbb::ZERO),
    ActionToken::Bet(Cbb::ZERO),
    ActionToken::Raise(Cbb::ZERO),
    ActionToken::AllIn,
];

impl NodeRecord {
    /// How many bytes `encode` appends.
    #[must_use]
    pub fn encoded_len(&self) -> usize {
        let hands = self.hand_count();
        let actions = self.actions.len();
        let ids = self.hand_ids.as_ref().map_or(0, |ids| 2 * ids.len());
        let reach = if self.reach.is_some() { 4 * hands } else { 0 };
        let accuracy = if self.accuracy_pct_pot.is_some() { 4 } else { 0 };
        HEADER_BYTES
            + ACTION_BYTES * actions
            + 2
            + ids
            + reach
            + 3 * actions * hands
            + 4 * hands
            + accuracy
    }

    /// Appends the record's little-endian bytes to `out`.
    ///
    /// # Errors
    ///
    /// `LibraryError::Quantize` when a table's shape disagrees with the action or hand
    /// count, so the bytes would not decode.
    pub fn encode(&self, out: &mut Vec<u8>) -> Result<(), LibraryError> {
        let (n_actions, n_hands) = self.check_shape()?;
        out.reserve(self.encoded_len());
        out.extend_from_slice(&self.key_hash.to_le_bytes());
        out.extend_from_slice(&[street_code(self.street), self.to_act, n_actions, self.flags()]);
        for cbb in [self.pot, self.stacks[0], self.stacks[1]] {
            out.extend_from_slice(&cbb.get().to_le_bytes());
        }
        for action in &self.actions {
            out.push(token_code(action.token));
            out.extend_from_slice(&action.size.get().to_le_bytes());
            out.push(bucket_code(action.bucket));
        }
        out.extend_from_slice(&n_hands.to_le_bytes());
        let reach = self.reach.iter().flatten();
        for value in self.hand_ids.iter().chain(reach).flatten() {
            out.extend_from_slice(&value.to_le_bytes());
        }
        for row in &self.strategy {
            out.extend_from_slice(row);
        }
        for ev in &self.ev_best {
            out.extend_from_slice(&ev.to_le_bytes());
        }
        for units in self.loss.iter().flatten() {
            out.extend_from_slice(&units.to_le_bytes());
        }
        if let Some(accuracy) = self.accuracy_pct_pot {
            out.extend_from_slice(&accuracy.to_le_bytes());
        }
        Ok(())
    }

    /// The action and hand counts as stored, after checking every table against them.
    fn check_shape(&self) -> Result<(u8, u16), LibraryError> {
        let shape_error = |what: &str| LibraryError::Quantize(format!("record shape: {what}"));
        let n_actions = u8::try_from(self.actions.len())
            .ok()
            .filter(|n| *n > 0)
            .ok_or_else(|| shape_error("1 to 255 actions"))?;
        let hands = self.hand_count();
        let n_hands = u16::try_from(hands).map_err(|_| shape_error("too many hands"))?;
        let ids_ok = self.hand_ids.as_ref().is_none_or(|ids| valid_ids(ids, self.hand_space));
        let reach_ok = self.reach.as_ref().is_none_or(|r| r.iter().all(|s| s.len() == hands));
        if !ids_ok || self.to_act > 1 || !reach_ok || self.ev_best.len() != hands {
            return Err(shape_error("hands, seat, reach and ev_best must agree"));
        }
        let actions = self.actions.len();
        let strategy_ok =
            self.strategy.len() == actions && self.strategy.iter().all(|r| r.len() == hands);
        let loss_ok = self.loss.len() == actions && self.loss.iter().all(|r| r.len() == hands);
        if !strategy_ok || !loss_ok {
            return Err(shape_error("strategy and loss must be [action][hand]"));
        }
        Ok((n_actions, n_hands))
    }

    /// Decodes one record from the front of `b`, returning it with the bytes it used.
    /// Every length is bounds-checked, so malformed input is an error and never a panic.
    ///
    /// # Errors
    ///
    /// `LibraryError::Decode` for truncated input, an unknown street, action code or bucket
    /// byte, a reserved flag bit set, a seat other than 0 or 1, no actions, hand indexes
    /// outside the space or out of order, a strategy column that does not sum to 255, or a
    /// stored float that is not finite.
    pub fn decode(b: &[u8]) -> Result<(Self, usize), LibraryError> {
        let mut r = LeReader::new(b);
        let header = decode_header(&mut r)?;
        let tables = decode_tables(&mut r, &header)?;
        let record = NodeRecord {
            key_hash: header.key_hash,
            street: header.street,
            to_act: header.to_act,
            pot: header.pot,
            stacks: header.stacks,
            hand_space: header.hand_space(),
            actions: header.actions,
            hand_ids: tables.hand_ids,
            reach: tables.reach,
            strategy: tables.strategy,
            ev_best: tables.ev_best,
            loss: tables.loss,
            accuracy_pct_pot: tables.accuracy_pct_pot,
        };
        Ok((record, r.position()))
    }
}

/// The fixed fields of a record, before its hand tables.
struct Header {
    key_hash: u64,
    street: Street,
    to_act: u8,
    flags: u8,
    pot: Cbb,
    stacks: [Cbb; 2],
    actions: Vec<RecordAction>,
}

impl Header {
    /// The hand space flag bit 1 names.
    fn hand_space(&self) -> HandSpace {
        if self.flags & FLAG_POSTFLOP_1326 == 0 {
            HandSpace::Preflop169
        } else {
            HandSpace::Postflop1326
        }
    }
}

/// The per-hand tables that follow the header.
struct Tables {
    hand_ids: Option<Vec<u16>>,
    reach: Option<[Vec<u16>; 2]>,
    strategy: Vec<Vec<u8>>,
    ev_best: Vec<f32>,
    loss: Vec<Vec<u16>>,
    accuracy_pct_pot: Option<f32>,
}

/// The header: the key hash, the four `u8` fields, the pot, the stacks and the action table.
fn decode_header(r: &mut LeReader<'_>) -> Result<Header, LibraryError> {
    let key_hash = r.u64("the key hash")?;
    let street = street_of(r.u8("the street")?)?;
    let to_act = r.u8("the seat to act")?;
    let n_actions = usize::from(r.u8("the action count")?);
    let flags = r.u8("the flags")?;
    if to_act > 1 || n_actions == 0 || flags & FLAG_RESERVED_MASK != 0 {
        return Err(LibraryError::Decode("bad seat, action count or flags".into()));
    }
    let pot = Cbb(r.u32("the pot")?);
    let stacks = [Cbb(r.u32("a stack")?), Cbb(r.u32("a stack")?)];
    let actions = (0..n_actions).map(|_| decode_action(r)).collect::<Result<_, _>>()?;
    Ok(Header { key_hash, street, to_act, flags, pot, stacks, actions })
}

/// The tables in layout order: hand ids, reach, strategy, best EV (expected value), loss and
/// the optional accuracy.
fn decode_tables(r: &mut LeReader<'_>, header: &Header) -> Result<Tables, LibraryError> {
    let n_actions = header.actions.len();
    let hand_space = header.hand_space();
    let hand_ids = decode_hand_ids(r, header.flags & FLAG_SPARSE != 0, hand_space)?;
    let n = hand_ids.as_ref().map_or(usize::from(hand_space.size()), Vec::len);
    let reach = match header.flags & FLAG_REACH {
        0 => None,
        _ => Some([u16_table(r, n)?, u16_table(r, n)?]),
    };
    let strategy = (0..n_actions)
        .map(|_| r.take(n, "a strategy row").map(<[u8]>::to_vec))
        .collect::<Result<Vec<_>, _>>()?;
    let column_sum = |h: usize| strategy.iter().map(|row| u32::from(row[h])).sum::<u32>();
    if (0..n).any(|h| column_sum(h) != u32::from(FREQUENCY_SCALE)) {
        return Err(LibraryError::Decode("a strategy column does not sum to 255".into()));
    }
    let ev_best = (0..n).map(|_| finite_stored(r.f32("ev_best")?)).collect::<Result<_, _>>()?;
    let loss = (0..n_actions).map(|_| u16_table(r, n)).collect::<Result<_, _>>()?;
    let accuracy_pct_pot = match header.flags & FLAG_ACCURACY {
        0 => None,
        _ => Some(finite_stored(r.f32("accuracy_pct_pot")?)?),
    };
    Ok(Tables { hand_ids, reach, strategy, ev_best, loss, accuracy_pct_pot })
}

/// True when `ids` are strictly ascending, inside `space` and no more than it holds.
fn valid_ids(ids: &[u16], space: HandSpace) -> bool {
    ids.len() <= usize::from(space.size())
        && ids.windows(2).all(|pair| pair[0] < pair[1])
        && ids.last().is_none_or(|last| *last < space.size())
}

fn finite_stored(value: f32) -> Result<f32, LibraryError> {
    if value.is_finite() {
        Ok(value)
    } else {
        Err(LibraryError::Decode(format!("a stored float {value} is not finite")))
    }
}

fn street_code(street: Street) -> u8 {
    Street::ALL.iter().zip(0_u8..).find(|(s, _)| **s == street).map_or(0, |(_, code)| code)
}

fn street_of(code: u8) -> Result<Street, LibraryError> {
    Street::ALL
        .get(usize::from(code))
        .copied()
        .ok_or_else(|| LibraryError::Decode(format!("unknown street code {code}")))
}

fn token_code(token: ActionToken) -> u8 {
    let same_kind =
        |code: &ActionToken| std::mem::discriminant(code) == std::mem::discriminant(&token);
    TOKEN_CODES.iter().zip(0_u8..).find(|(code, _)| same_kind(code)).map_or(0, |(_, c)| c)
}

fn bucket_code(bucket: Option<Bucket>) -> u8 {
    let code = |b: Bucket| Bucket::ALL.iter().zip(1_u8..).find(|(x, _)| **x == b).map(|(_, c)| c);
    bucket.and_then(code).unwrap_or(0)
}

fn decode_action(r: &mut LeReader<'_>) -> Result<RecordAction, LibraryError> {
    let code = r.u8("an action type")?;
    let size = Cbb(r.u32("an action size")?);
    let bucket = match r.u8("a bucket")? {
        0 => None,
        byte => Some(
            *Bucket::ALL
                .get(usize::from(byte) - 1)
                .ok_or_else(|| LibraryError::Decode(format!("unknown bucket code {byte}")))?,
        ),
    };
    let token = match TOKEN_CODES.get(usize::from(code)) {
        Some(ActionToken::Straddle(_)) => ActionToken::Straddle(size),
        Some(ActionToken::Bet(_)) => ActionToken::Bet(size),
        Some(ActionToken::Raise(_)) => ActionToken::Raise(size),
        Some(token) => *token,
        None => return Err(LibraryError::Decode(format!("unknown action code {code}"))),
    };
    Ok(RecordAction { token, size, bucket })
}

fn decode_hand_ids(
    r: &mut LeReader<'_>,
    sparse: bool,
    space: HandSpace,
) -> Result<Option<Vec<u16>>, LibraryError> {
    let count = r.u16("the hand count")?;
    if !sparse {
        if count == space.size() {
            return Ok(None);
        }
        return Err(LibraryError::Decode(format!("a dense record lists {count} hands")));
    }
    let ids = u16_table(r, usize::from(count))?;
    if valid_ids(&ids, space) {
        Ok(Some(ids))
    } else {
        Err(LibraryError::Decode("sparse hand ids are out of order or outside the space".into()))
    }
}

/// `n` little-endian `u16` values; the bytes are taken first, so nothing is allocated for a
/// length the input cannot hold.
fn u16_table(r: &mut LeReader<'_>, n: usize) -> Result<Vec<u16>, LibraryError> {
    let bytes = r.take(2 * n, "a u16 table")?;
    Ok(bytes.chunks_exact(2).map(|pair| u16::from_le_bytes([pair[0], pair[1]])).collect())
}
