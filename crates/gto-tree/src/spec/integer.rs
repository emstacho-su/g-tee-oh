//! The integer fields of the spec, `raise_cap` and `spec_version` (O-132).
//!
//! Mechanism: a seed row is stored as Postgres `jsonb`, which keeps a number as it was
//! written, so a `raise_cap` written as `3.0` comes back as `3.0`, and the JSON Schema
//! `integer` type accepts an integer-valued float. The serde mirror agrees with the schema:
//! an integer, or a float with no fractional part, reads as the integer; `null` and a float
//! with a fractional part are refused, as the schema refuses them, and so is a value outside
//! the field's range, such as a negative number or a `raise_cap` above 255.

use std::fmt;
use std::marker::PhantomData;

use serde::de::{self, Deserializer, Unexpected, Visitor};

use crate::units::round_to_u32;

/// Reads an optional integer field: an integer or an integer-valued float within `T`'s
/// range is `Some`, and null or anything else fails. An absent field never reaches this
/// function; serde's `default` makes it `None`.
pub(crate) fn whole<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: TryFrom<u32>,
{
    deserializer.deserialize_any(Whole(PhantomData)).map(Some)
}

/// A visitor for an integer `T` that also takes an integer-valued float.
struct Whole<T>(PhantomData<T>);

impl<T: TryFrom<u32>> Visitor<'_> for Whole<T> {
    type Value = T;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("an integer, or a float with no fractional part")
    }

    fn visit_u64<E: de::Error>(self, value: u64) -> Result<T, E> {
        u32::try_from(value)
            .ok()
            .and_then(|narrow| T::try_from(narrow).ok())
            .ok_or_else(|| E::invalid_value(Unexpected::Unsigned(value), &self))
    }

    fn visit_i64<E: de::Error>(self, value: i64) -> Result<T, E> {
        match u64::try_from(value) {
            Ok(unsigned) => self.visit_u64(unsigned),
            Err(_) => Err(E::invalid_value(Unexpected::Signed(value), &self)),
        }
    }

    fn visit_f64<E: de::Error>(self, value: f64) -> Result<T, E> {
        match round_to_u32(value) {
            Some(whole) if value.fract() == 0.0 => self.visit_u64(u64::from(whole)),
            _ => Err(E::invalid_value(Unexpected::Float(value), &self)),
        }
    }
}
