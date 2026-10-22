//! Hand label parsing shared by the nodes, grade, insights, deal and sample-action
//! handlers (plan A.7, R2.13). A request names a hand as a class (`AKs`) or a combo
//! (`AhKh`); the node's hand space decides what the record is indexed by: at a
//! `preflop_169` node a combo maps to its class through `ComboId::class` (A5 section 2),
//! at a `postflop_1326` node the record holds combos, so a class label alone names no
//! column and is rejected. Anything else is a 400 problem.
//!
//! The integrator of S16 owns this file.

use gto_library::HandSpace;
use gto_model::{ComboId, HandClass};

use crate::error::ApiError;

/// A parsed hand: where it sits in the node's record, and what the caller wrote.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct HandRef {
    /// The record index in the node's hand space: the class index at a `preflop_169`
    /// node, the combo index at a `postflop_1326` node.
    pub index: u16,
    /// The hand's class; a combo's class when the text was a combo.
    pub class: HandClass,
    /// The combo, when the text was a combo.
    pub combo: Option<ComboId>,
}

impl HandRef {
    /// The canonical label of the record row: the class name at a `preflop_169` node, the
    /// combo text at a `postflop_1326` node (where `combo` is always present).
    #[must_use]
    pub fn label(&self, space: HandSpace) -> String {
        match (space, self.combo) {
            (HandSpace::Postflop1326, Some(combo)) => combo.to_string(),
            (HandSpace::Preflop169 | HandSpace::Postflop1326, _) => self.class.to_string(),
        }
    }
}

/// Parses `text` as a class or a combo for a node in `space`.
///
/// # Errors
///
/// `ApiError::BadRequest` when the text is neither a canonical class nor a combo, or when
/// a class is given for a `postflop_1326` node.
pub fn parse_hand(text: &str, space: HandSpace) -> Result<HandRef, ApiError> {
    if let Ok(class) = text.parse::<HandClass>() {
        return match space {
            HandSpace::Preflop169 => {
                Ok(HandRef { index: u16::from(class.index()), class, combo: None })
            }
            HandSpace::Postflop1326 => Err(ApiError::BadRequest(format!(
                "hand {} is a class; a 1,326-combo node takes a combo such as AhKh",
                ApiError::quoted(text)
            ))),
        };
    }
    if let Ok(combo) = text.parse::<ComboId>() {
        let class = combo.class();
        let index = match space {
            HandSpace::Preflop169 => u16::from(class.index()),
            HandSpace::Postflop1326 => combo.index(),
        };
        return Ok(HandRef { index, class, combo: Some(combo) });
    }
    Err(ApiError::BadRequest(format!(
        "hand {} is neither a class such as AKs nor a combo such as AhKh",
        ApiError::quoted(text)
    )))
}

#[cfg(test)]
mod tests {
    use gto_library::HandSpace;
    use gto_model::{ComboId, HandClass};

    use super::{HandRef, parse_hand};
    use crate::error::ApiError;

    #[test]
    fn r2_13_parse_hand_accepts_classes_and_combos_at_a_preflop_node() {
        let class: HandClass = "AKs".parse().expect("a class");
        let combo: ComboId = "AhKh".parse().expect("a combo");
        let by_class = parse_hand("AKs", HandSpace::Preflop169).expect("a class parses");
        assert_eq!(by_class, HandRef { index: u16::from(class.index()), class, combo: None });
        assert_eq!(by_class.label(HandSpace::Preflop169), "AKs");
        let by_combo = parse_hand("AhKh", HandSpace::Preflop169).expect("a combo parses");
        assert_eq!(by_combo.index, by_class.index, "a combo maps to its class at preflop");
        assert_eq!(by_combo.class, class);
        assert_eq!(by_combo.combo, Some(combo));
        assert_eq!(by_combo.label(HandSpace::Preflop169), "AKs");
        let pair = parse_hand("AA", HandSpace::Preflop169).expect("a pair parses");
        assert_eq!(pair.index, 0, "AA is the first class");
    }

    #[test]
    fn r2_13_parse_hand_takes_combos_only_at_a_1326_node() {
        let combo: ComboId = "AhKh".parse().expect("a combo");
        let parsed = parse_hand("AhKh", HandSpace::Postflop1326).expect("a combo parses");
        assert_eq!(parsed.index, combo.index(), "the combo index is the record index");
        assert_eq!(parsed.combo, Some(combo));
        assert_eq!(parsed.label(HandSpace::Postflop1326), "AhKh");
        let reversed = parse_hand("KhAh", HandSpace::Postflop1326).expect("either order parses");
        assert_eq!(reversed, parsed, "one combo, one spelling");
        let error = parse_hand("AKs", HandSpace::Postflop1326).expect_err("a class names no row");
        assert!(matches!(error, ApiError::BadRequest(ref m) if m.contains("AhKh")), "{error}");
    }

    #[test]
    fn r2_13_parse_hand_rejects_other_text() {
        for bad in ["", "bogus", "KAs", "AhAh", "AKx", "all", "class"] {
            let error = parse_hand(bad, HandSpace::Preflop169).expect_err(bad);
            assert!(matches!(error, ApiError::BadRequest(_)), "{bad:?}: {error}");
            assert_eq!(error.status().as_u16(), 400);
        }
    }
}
