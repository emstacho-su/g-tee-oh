//! The toy-game fixture: `validation/fixtures/toy-games/{kuhn,akq,leduc}.json`.
//!
//! One schema serves the three games. A file names the game, its deck and its sources,
//! the tolerances its gate applies, and one or more cases. A case is one betting
//! structure with the known answers for it: the analytic game value when the literature
//! gives one, the equilibrium strategy facts (per player, decision point, holding and
//! action) and range-level ratio facts such as a bluff share. Every number names the
//! source it comes from, and loading checks that every such reference resolves. The
//! field meanings are documented in `validation/fixtures/README.md`.

use std::collections::BTreeSet;
use std::path::Path;

use serde::Deserialize;

use super::{FixtureError, check_schema_version, invalid, read_json};

/// A toy-game fixture file.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToyGameFixture {
    /// Always [`super::SCHEMA_VERSION`].
    pub schema_version: u32,
    /// Short identifier, equal to the file stem.
    pub id: String,
    /// Human name of the game.
    pub name: String,
    /// The gate that consumes the file: `G1`, `G2` or `G3` (04 section 6).
    pub gate: String,
    /// The requirement the gate closes: `R2.4`, `R2.5` or `R2.6`.
    pub r_id: String,
    /// Number of players; 2 for every v1 toy game.
    pub players: u8,
    /// The deck the game is dealt from.
    pub deck: Deck,
    /// Where the numbers come from, referenced by id from facts and tolerances.
    pub sources: Vec<Source>,
    /// The tolerances the gate applies; absent ones are `null`.
    pub tolerances: Tolerances,
    /// The betting structures with their known answers.
    pub cases: Vec<Case>,
    /// A published exploitability curve to compare against (Leduc only).
    pub curve: Option<CurveReference>,
    /// Free-text notes for the reader of the file.
    pub notes: Vec<String>,
}

/// The deck a toy game is dealt from.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Deck {
    /// Rank names, lowest first.
    pub ranks: Vec<String>,
    /// Number of suits; 1 when suits do not exist in the game.
    pub suits: u8,
    /// Total cards, ranks times suits.
    pub cards: u8,
    /// Private cards dealt to each player.
    pub private_cards_per_player: u8,
    /// Public cards dealt over the whole game.
    pub public_cards: u8,
}

/// A citation that facts and tolerances reference by id.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Source {
    /// Identifier referenced by the `source` field of facts and tolerances.
    pub id: String,
    /// The citation in plain words.
    pub citation: String,
    /// A link, when one exists.
    pub url: Option<String>,
}

/// One tolerance with its unit and source.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Tolerance {
    /// The tolerance value.
    pub value: f64,
    /// `chips`, `percentage_points` or `ratio`.
    pub unit: String,
    /// The source id that states it.
    pub source: String,
}

/// The tolerances a gate applies. A `null` means the gate does not use that rule.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Tolerances {
    /// Absolute tolerance on the game value (G1).
    pub game_value_abs: Option<Tolerance>,
    /// Upper bound on the exploitability of the solved strategy (G1).
    pub exploitability_max: Option<Tolerance>,
    /// Tolerance on strategy and ratio frequencies, in percentage points (G2).
    pub frequency_points: Option<Tolerance>,
    /// Absolute part of the curve tolerance (G3, O-79).
    pub curve_abs: Option<Tolerance>,
    /// Relative part of the curve tolerance, as a ratio (G3, O-79).
    pub curve_rel: Option<Tolerance>,
}

/// One betting structure with its known answers.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Case {
    /// Identifier, unique within the file.
    pub id: String,
    /// What the case is, in plain words.
    pub description: String,
    /// The betting structure.
    pub betting: Betting,
    /// The analytic game value, when the literature gives one.
    pub game_value: Option<GameValue>,
    /// Equilibrium frequencies per player, decision point, holding and action.
    pub strategy_facts: Vec<StrategyFact>,
    /// Range-level ratios such as a bluff share.
    pub ratio_facts: Vec<RatioFact>,
}

/// The betting structure of a case, in chips.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Betting {
    /// What each player puts in before cards.
    pub ante: f64,
    /// The pot before any bet, the antes summed.
    pub dead_pot: f64,
    /// Number of betting rounds.
    pub rounds: u8,
    /// Bet size per round, one entry per round for fixed-size games.
    pub bet_sizes: Vec<f64>,
    /// Raises allowed in one round after the first bet.
    pub max_raises_per_round: u8,
    /// The player who acts first.
    pub first_to_act: u8,
    /// Always `chips`.
    pub unit: String,
}

/// The analytic value of the game to one player.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameValue {
    /// The player the value is for.
    pub player: u8,
    /// The value as a float.
    pub value: f64,
    /// The exact form, such as `-1/18`, when there is one.
    pub exact: Option<String>,
    /// Always `chips`.
    pub unit: String,
    /// The source id.
    pub source: String,
}

/// One equilibrium frequency.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StrategyFact {
    /// Identifier, unique within the case.
    pub id: String,
    /// The acting player.
    pub player: u8,
    /// The decision point, named in the file's notes.
    pub node: String,
    /// The holding: a rank, or a range label such as `nuts`.
    pub holding: String,
    /// The action: `bet`, `check`, `call` or `fold`.
    pub action: String,
    /// The frequency, exact or in terms of the equilibrium family.
    pub frequency: Frequency,
    /// The source id.
    pub source: String,
}

/// How a strategy fact pins a frequency.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Frequency {
    /// One value.
    Exact {
        /// The frequency.
        value: f64,
        /// The exact form, such as `1/3`.
        exact: Option<String>,
    },
    /// A free parameter of the equilibrium family, bounded to a closed range.
    Parameter {
        /// The parameter name other facts refer to.
        name: String,
        /// Lower bound, inclusive.
        min: f64,
        /// Upper bound, inclusive.
        max: f64,
    },
    /// `scale` times a named parameter plus `offset`.
    Affine {
        /// The parameter name.
        parameter: String,
        /// The multiplier.
        scale: f64,
        /// The constant.
        offset: f64,
    },
    /// Any value in a closed range is an equilibrium.
    Segment {
        /// Lower bound, inclusive.
        min: f64,
        /// Upper bound, inclusive.
        max: f64,
    },
}

/// A range-level ratio with its closed form.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RatioFact {
    /// Identifier, unique within the case.
    pub id: String,
    /// What the ratio is, in plain words.
    pub name: String,
    /// The ratio as a float.
    pub value: f64,
    /// The exact form, when there is one.
    pub exact: Option<String>,
    /// The closed form in terms of pot `P` and bet `B`.
    pub formula: String,
    /// The source id.
    pub source: String,
}

/// A committed exploitability curve the gate compares against.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurveReference {
    /// Path relative to `validation/fixtures/`.
    pub file: String,
    /// Path of the provenance note relative to `validation/fixtures/`.
    pub provenance: String,
    /// The field of each checkpoint the gate compares; `exploitability`.
    pub measure: String,
}

impl ToyGameFixture {
    /// Load and validate a toy-game fixture.
    ///
    /// # Errors
    ///
    /// Any [`FixtureError`]: unreadable file, parse failure or unknown field, a
    /// `schema_version` other than [`super::SCHEMA_VERSION`], no cases, duplicate case
    /// or fact ids, or a `source` reference that no entry of `sources` declares.
    pub fn load(path: &Path) -> Result<Self, FixtureError> {
        let fixture: Self = read_json(path)?;
        check_schema_version(path, fixture.schema_version)?;
        fixture.check_structure().map_err(|reason| invalid(path, reason))?;
        Ok(fixture)
    }

    /// The case with the given id.
    #[must_use]
    pub fn case(&self, id: &str) -> Option<&Case> {
        self.cases.iter().find(|case| case.id == id)
    }

    fn check_structure(&self) -> Result<(), String> {
        if self.cases.is_empty() {
            return Err("no cases".to_owned());
        }
        let source_ids: BTreeSet<&str> = self.sources.iter().map(|s| s.id.as_str()).collect();
        if source_ids.len() != self.sources.len() {
            return Err("duplicate source id".to_owned());
        }
        check_unique(self.cases.iter().map(|c| c.id.as_str()), "case")?;
        for tolerance in self.tolerances.iter() {
            check_source(&source_ids, &tolerance.source, "tolerance")?;
        }
        for case in &self.cases {
            case.check_structure(&source_ids)?;
        }
        Ok(())
    }
}

impl Tolerances {
    /// The tolerances that are present.
    pub fn iter(&self) -> impl Iterator<Item = &Tolerance> {
        [
            &self.game_value_abs,
            &self.exploitability_max,
            &self.frequency_points,
            &self.curve_abs,
            &self.curve_rel,
        ]
        .into_iter()
        .flatten()
    }
}

impl Case {
    /// The strategy fact with the given id.
    #[must_use]
    pub fn strategy_fact(&self, id: &str) -> Option<&StrategyFact> {
        self.strategy_facts.iter().find(|fact| fact.id == id)
    }

    /// The ratio fact with the given id.
    #[must_use]
    pub fn ratio_fact(&self, id: &str) -> Option<&RatioFact> {
        self.ratio_facts.iter().find(|fact| fact.id == id)
    }

    fn check_structure(&self, source_ids: &BTreeSet<&str>) -> Result<(), String> {
        let context = format!("case {}", self.id);
        check_unique(self.strategy_facts.iter().map(|f| f.id.as_str()), &context)?;
        check_unique(self.ratio_facts.iter().map(|f| f.id.as_str()), &context)?;
        if let Some(value) = &self.game_value {
            check_source(source_ids, &value.source, &context)?;
        }
        for fact in &self.strategy_facts {
            check_source(source_ids, &fact.source, &context)?;
        }
        for fact in &self.ratio_facts {
            check_source(source_ids, &fact.source, &context)?;
        }
        Ok(())
    }
}

fn check_unique<'a>(ids: impl Iterator<Item = &'a str>, context: &str) -> Result<(), String> {
    let mut seen = BTreeSet::new();
    for id in ids {
        if !seen.insert(id) {
            return Err(format!("{context}: duplicate id {id}"));
        }
    }
    Ok(())
}

fn check_source(source_ids: &BTreeSet<&str>, source: &str, context: &str) -> Result<(), String> {
    if source_ids.contains(source) {
        Ok(())
    } else {
        Err(format!("{context}: source {source} is not declared in sources"))
    }
}
