//! Why a gate could not run: the one error of `validate::gates`, shared by the toy-game
//! gates G1 to G3 (R2.4 to R2.6) and the oracle gate G4 (R2.11). Child module of `gates`,
//! re-exported there as `GateError`, so callers name it `validate::gates::GateError`.
//! Every variant names the fixture, the case, the fact, the dump or the spot it is about,
//! and nothing here panics.

use std::fmt;

use crate::fixtures::FixtureError;
use crate::report::ReportError;

/// Why a gate could not run.
#[derive(Debug)]
pub enum GateError {
    /// A fixture failed to load.
    Fixture(FixtureError),
    /// The fixture id names no gate this crate solves.
    UnsupportedFixture {
        /// The fixture id.
        fixture: String,
    },
    /// The case id names no game the gate models.
    UnknownCase {
        /// The fixture id.
        fixture: String,
        /// The case id.
        case: String,
    },
    /// A fact of the fixture resolves to nothing in the solved game's vocabulary.
    MissingFact {
        /// The fixture id.
        fixture: String,
        /// The case id.
        case: String,
        /// The fact id.
        fact: String,
    },
    /// The fixture names no curve to compare against.
    NoCurve {
        /// The fixture id.
        fixture: String,
    },
    /// A node dump breaks the criterion 2 invariants (R2.8 rules 1 to 5) or library-pack's
    /// node checks, so gate G4 refuses it before any number is judged (R2.11).
    Dump {
        /// The dump: its file path, or the engine dump solved in this run.
        dump: String,
        /// Every violation library-pack reported, each one sentence naming its node.
        violations: Vec<library_pack::Violation>,
    },
    /// The two G4 dumps disagree on a node's shape, or a dump lacks what the compare
    /// needs at a node: never a silent partial compare (R2.11).
    Mismatch {
        /// The spot id.
        spot: String,
        /// The node key, or `header` for the dump header.
        node: String,
        /// What differs, in plain words.
        reason: String,
    },
    /// The engine side of G4 could not build or solve a spot (R2.11); the message is the
    /// adapter's.
    Solve {
        /// The spot id.
        spot: String,
        /// What failed, in the adapter's words.
        message: String,
    },
    /// A report could not be written.
    Report(ReportError),
}

impl fmt::Display for GateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Fixture(error) => write!(f, "{error}"),
            Self::UnsupportedFixture { fixture } => {
                write!(f, "fixture {fixture} belongs to no gate this tool solves")
            }
            Self::UnknownCase { fixture, case } => {
                write!(f, "fixture {fixture}: case {case} names no game the gate models")
            }
            Self::MissingFact { fixture, case, fact } => write!(
                f,
                "fixture {fixture}: case {case}: fact {fact} resolves to nothing in the solved game"
            ),
            Self::NoCurve { fixture } => write!(f, "fixture {fixture} names no curve"),
            Self::Dump { dump, violations } => {
                let sentences: Vec<String> = violations.iter().map(ToString::to_string).collect();
                write!(
                    f,
                    "dump {dump} breaks the node-dump invariants ({} found): {}",
                    violations.len(),
                    sentences.join(" ")
                )
            }
            Self::Mismatch { spot, node, reason } => {
                write!(f, "G4 spot {spot}, node {node}: {reason}")
            }
            Self::Solve { spot, message } => {
                write!(f, "G4 spot {spot} could not be solved: {message}")
            }
            Self::Report(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for GateError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Fixture(error) => Some(error),
            Self::Report(error) => Some(error),
            Self::UnsupportedFixture { .. }
            | Self::UnknownCase { .. }
            | Self::MissingFact { .. }
            | Self::NoCurve { .. }
            | Self::Dump { .. }
            | Self::Mismatch { .. }
            | Self::Solve { .. } => None,
        }
    }
}

impl From<FixtureError> for GateError {
    fn from(error: FixtureError) -> Self {
        Self::Fixture(error)
    }
}

impl From<ReportError> for GateError {
    fn from(error: ReportError) -> Self {
        Self::Report(error)
    }
}
