//! The toy-game gates G1 to G3 (04 section 6; R2.4, R2.5, R2.6): each solves a toy game
//! through `gto_solve::toy`, judges the result against its fixture under
//! `validation/fixtures/toy-games/` with the pass rules the S13 plan section B fixes, and
//! hands back a [`GateReport`], its own data only. This file is shared: it dispatches to
//! the gate files and attaches the run context when the reports are written. `g1.rs`
//! (Kuhn), `g2.rs` (AKQ, ace king queen, and the polar river toy) and `g3.rs` (Leduc
//! against the committed `OpenSpiel` curve, O-30) are each owned by one agent. `g4.rs` is
//! the oracle gate G4 (R2.11): a compare of two node dumps rather than a toy solve, run
//! by the `g4` subcommand and never by `gates`, since its report is private (O-170); the
//! `Gate` enum therefore stays G1 to G3.
//!
//! Mechanism. [`run_gate`] loads the fixtures a gate needs and calls its `run`;
//! [`write_gate_reports`] does that for a list of gates, wraps each [`GateReport`] in the
//! schema envelope through [`Report::from_gate`] and writes the JSON (JavaScript Object
//! Notation) file and the Markdown twin under the report id (`g1-kuhn`, `g2-akq`,
//! `g3-leduc`; O-125). [`solve_case`] and [`solve_leduc_curve`] are the two helpers the
//! pending tests in `tests/gates.rs` were written against; they dispatch per fixture id,
//! so the tests and the binary share one code path per gate. The helpers the gate files
//! share live here too: [`required_tolerance`] reads a tolerance and refuses one in the
//! wrong unit, [`resolve_frequencies`] reads every strategy fact of a case from a solved
//! game, and `iterations_as_f64` turns an iteration count into a report value. Nothing
//! here panics on a bad fixture: every failure is a [`GateError`] (the `error` child
//! module) naming the fixture, the case, the field, the fact, the dump or the spot.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use gto_solve::toy::ToySolution;

use crate::fixtures::openspiel::OpenSpielCurve;
use crate::fixtures::toy_game::{Case, Tolerance, ToyGameFixture};
use crate::fixtures::{FIXTURES_RELATIVE_TO_REPO_ROOT, FixtureError};
use crate::report::{self, Context, Measurement, Report, Threshold};

mod error;
pub mod g1;
pub mod g2;
pub mod g3;
pub mod g4;
pub mod g4_engine;

pub use error::GateError;

/// One of the three toy-game gates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Gate {
    /// Kuhn poker, R2.4.
    G1,
    /// AKQ and the polar river toy, R2.5.
    G2,
    /// Leduc hold'em against the `OpenSpiel` curve, R2.6.
    G3,
}

impl Gate {
    /// The three gates in order.
    pub const ALL: [Gate; 3] = [Gate::G1, Gate::G2, Gate::G3];

    /// The gate a subcommand names: `g1`, `g2` or `g3`.
    #[must_use]
    pub fn from_name(name: &str) -> Option<Gate> {
        Self::ALL.into_iter().find(|gate| gate.name() == name)
    }

    /// The subcommand name.
    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Self::G1 => "g1",
            Self::G2 => "g2",
            Self::G3 => "g3",
        }
    }

    /// The toy-game fixture the gate reads, its file stem.
    #[must_use]
    pub fn fixture_id(self) -> &'static str {
        match self {
            Self::G1 => "kuhn",
            Self::G2 => "akq",
            Self::G3 => "leduc",
        }
    }

    /// The report id, also the file stem of the two report files (O-125).
    #[must_use]
    pub fn report_id(self) -> &'static str {
        match self {
            Self::G1 => "g1-kuhn",
            Self::G2 => "g2-akq",
            Self::G3 => "g3-leduc",
        }
    }

    /// The requirement the gate closes.
    #[must_use]
    pub fn r_id(self) -> &'static str {
        match self {
            Self::G1 => "R2.4",
            Self::G2 => "R2.5",
            Self::G3 => "R2.6",
        }
    }
}

/// What one gate measured and decided, before the run context is attached.
#[derive(Debug, Clone, PartialEq)]
pub struct GateReport {
    /// The report id, [`Gate::report_id`].
    pub report: String,
    /// The requirement identifiers, `[Gate::r_id]`.
    pub r_ids: Vec<String>,
    /// True when every judged measurement met its rule.
    pub pass: bool,
    /// The limits, keyed by measurement id; informational measurements have none.
    pub thresholds: BTreeMap<String, Threshold>,
    /// Every measurement, judged or informational.
    pub measurements: Vec<Measurement>,
    /// The mode line and the fixture provenance, for the reader.
    pub notes: String,
}

/// One solved toy-game case in the shape `tests/gates.rs` judges: the game value to
/// player 0, the exploitability of the average strategy, and the solved frequency of
/// every strategy fact and ratio fact the case names, keyed by fact id.
#[derive(Debug, Clone, PartialEq)]
pub struct SolvedCase {
    /// The expected value of the average strategy profile to player 0, in chips.
    pub game_value_player_0: f64,
    /// `NashConv` of the average strategy, the engine's sum of both gains, in chips: the
    /// stricter of the two readings the reports README allows for the G1 floor.
    pub exploitability_chips: f64,
    /// The solved frequency of each strategy fact, keyed by the fact id.
    pub frequencies: BTreeMap<String, f64>,
    /// The solved value of each ratio fact, keyed by the fact id.
    pub ratios: BTreeMap<String, f64>,
}

/// The repository-relative path of a toy-game fixture, for the errors that name it.
pub(crate) fn fixture_path(fixture: &ToyGameFixture) -> PathBuf {
    Path::new(FIXTURES_RELATIVE_TO_REPO_ROOT).join("toy-games").join(format!("{}.json", fixture.id))
}

/// The value of the tolerance `tolerances.<field>` that `gate` reads in `unit`.
///
/// # Errors
///
/// `GateError::Fixture` naming the field when the tolerance is `null` or stated in any
/// other unit, so a gate never judges against a number it would misread.
pub(crate) fn required_tolerance(
    fixture: &ToyGameFixture,
    tolerance: Option<&Tolerance>,
    field: &str,
    unit: &str,
    gate: Gate,
) -> Result<f64, GateError> {
    let gate_name = gate.name().to_uppercase();
    let invalid = |reason: String| {
        GateError::Fixture(FixtureError::Invalid { path: fixture_path(fixture), reason })
    };
    let tolerance = tolerance
        .ok_or_else(|| invalid(format!("tolerances.{field} is null; gate {gate_name} needs it")))?;
    if tolerance.unit != unit {
        return Err(invalid(format!(
            "tolerances.{field}.unit is {}, gate {gate_name} reads {unit}",
            tolerance.unit
        )));
    }
    Ok(tolerance.value)
}

/// `GateError::UnknownCase` for `case` of `fixture`.
pub(crate) fn unknown_case(fixture: &ToyGameFixture, case: &Case) -> GateError {
    GateError::UnknownCase { fixture: fixture.id.clone(), case: case.id.clone() }
}

/// `GateError::MissingFact` for `fact` in `case` of `fixture`.
pub(crate) fn missing_fact(fixture: &ToyGameFixture, case: &Case, fact: &str) -> GateError {
    GateError::MissingFact {
        fixture: fixture.id.clone(),
        case: case.id.clone(),
        fact: fact.to_owned(),
    }
}

/// The solved frequency of every strategy fact of `case`, keyed by fact id, read through
/// the solution's vocabulary (player, node, holding, action).
///
/// # Errors
///
/// `GateError::MissingFact` naming the first fact whose words resolve to nothing.
pub(crate) fn resolve_frequencies(
    fixture: &ToyGameFixture,
    case: &Case,
    solution: &ToySolution,
) -> Result<BTreeMap<String, f64>, GateError> {
    case.strategy_facts
        .iter()
        .map(|fact| {
            solution
                .frequency(fact.player, &fact.node, &fact.holding, &fact.action)
                .map(|frequency| (fact.id.clone(), frequency))
                .ok_or_else(|| missing_fact(fixture, case, &fact.id))
        })
        .collect()
}

/// An iteration count as a report value. The gates' stop rules cap it at 1,000,000, far
/// inside the range `f64` represents exactly.
#[allow(clippy::cast_precision_loss, reason = "iteration counts stay far below 2^53")]
pub(crate) fn iterations_as_f64(iterations: u64) -> f64 {
    iterations as f64
}

/// The fixture root under `repo_root`.
#[must_use]
pub fn fixtures_dir(repo_root: &Path) -> PathBuf {
    repo_root.join(FIXTURES_RELATIVE_TO_REPO_ROOT)
}

/// Load the toy-game fixture `id` from `fixtures_dir`.
///
/// # Errors
///
/// `GateError::Fixture` when the file is missing, malformed or invalid.
pub fn load_toy_game(fixtures_dir: &Path, id: &str) -> Result<ToyGameFixture, GateError> {
    let path = fixtures_dir.join("toy-games").join(format!("{id}.json"));
    Ok(ToyGameFixture::load(&path)?)
}

/// Load the curve `fixture` names.
///
/// # Errors
///
/// `GateError::NoCurve` when the fixture names none, `GateError::Fixture` when the curve
/// file is missing, malformed or invalid.
pub fn load_curve(
    fixtures_dir: &Path,
    fixture: &ToyGameFixture,
) -> Result<OpenSpielCurve, GateError> {
    let reference =
        fixture.curve.as_ref().ok_or_else(|| GateError::NoCurve { fixture: fixture.id.clone() })?;
    Ok(OpenSpielCurve::load(&fixtures_dir.join(&reference.file))?)
}

/// Solve one case of a toy-game fixture: Kuhn through gate G1, the AKQ cases and the
/// polar river case through gate G2.
///
/// # Errors
///
/// `GateError::UnsupportedFixture` for a fixture id other than `kuhn` or `akq`, and
/// whatever the gate reports for the case.
pub fn solve_case(fixture: &ToyGameFixture, case: &Case) -> Result<SolvedCase, GateError> {
    match fixture.id.as_str() {
        "kuhn" => g1::solve_case(fixture, case),
        "akq" => g2::solve_case(fixture, case),
        _ => Err(GateError::UnsupportedFixture { fixture: fixture.id.clone() }),
    }
}

/// The engine's Leduc exploitability curve under plain CFR (counterfactual regret
/// minimization): one continuous run, the mean best-response gain of the average
/// strategy in chips at each requested iteration (O-108, O-109, O-124).
#[must_use]
pub fn solve_leduc_curve(iterations: &[u64]) -> Vec<(u64, f64)> {
    g3::solve_curve(iterations)
}

/// Load what `gate` needs from `fixtures_dir` and run it.
///
/// # Errors
///
/// Any [`GateError`] from loading or from the gate.
pub fn run_gate(gate: Gate, fixtures_dir: &Path) -> Result<GateReport, GateError> {
    let fixture = load_toy_game(fixtures_dir, gate.fixture_id())?;
    match gate {
        Gate::G1 => g1::run(&fixture),
        Gate::G2 => g2::run(&fixture),
        Gate::G3 => {
            let curve = load_curve(fixtures_dir, &fixture)?;
            g3::run(&fixture, &curve)
        }
    }
}

/// Where one gate's two report files went, and its verdict.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Written {
    /// The gate.
    pub gate: Gate,
    /// Its verdict.
    pub pass: bool,
    /// The JSON report.
    pub json: PathBuf,
    /// The Markdown twin.
    pub markdown: PathBuf,
}

/// Run `gates` in order and write each report under `out_dir` as `<id>.json` and
/// `<id>.md` with `context` attached. Every gate runs and writes even when an earlier
/// one failed its rule, so a run always leaves the full set of reports; the first load
/// or write error stops the run.
///
/// # Errors
///
/// Any [`GateError`] from loading, from a gate, or from writing.
pub fn write_gate_reports(
    gates: &[Gate],
    fixtures_dir: &Path,
    context: &Context,
    out_dir: &Path,
) -> Result<Vec<Written>, GateError> {
    gates
        .iter()
        .map(|&gate| {
            let gate_report = run_gate(gate, fixtures_dir)?;
            let envelope = Report::from_gate(&gate_report, context);
            let json = out_dir.join(format!("{}.json", gate_report.report));
            let markdown = out_dir.join(format!("{}.md", gate_report.report));
            report::write_json(&envelope, &json)?;
            report::write_markdown(&envelope, &markdown)?;
            Ok(Written { gate, pass: gate_report.pass, json, markdown })
        })
        .collect()
}
