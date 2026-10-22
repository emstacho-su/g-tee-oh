//! Planted solutions for the hand-built cases (R2.13, R2.14): nodes with chosen reach,
//! frequencies and expected values (EVs), written under one configuration and pair of the
//! v1 catalog (`cfg_6_online_100`, big blind against the button) through the library
//! writer, so the service reads them like any other solution.

use std::path::PathBuf;

use axum::Router;
use axum::http::{HeaderMap, StatusCode};
use gto_library::{HandSpace, SolvedHand, SolvedNode};
use gto_model::{ActionToken, Cbb, ComboId, ConfigId, HandClass, Position, PositionPair};
use serde_json::Value;
use tempfile::TempDir;

use super::{
    empty_root, encode, fold_call_raise, get, planted_node, preflop_key, router_over,
    write_solution,
};

/// The solution id every planted solution is written under.
pub const PLANTED_SOLUTION_ID: &str = "0f0f0f0f-1111-4222-8333-444444444444";
/// The configuration every planted key names: online 6-max at 100 big blinds.
pub const PLANTED_CONFIG_ID: &str = "cfg_6_online_100";
/// The pot of every planted node in centi-big-blinds (cbb): 5 bb.
pub const PLANTED_POT: Cbb = Cbb(500);
/// The accuracy every planted node reports, in percent of the pot (O-22).
pub const PLANTED_ACCURACY_PCT_POT: f32 = 0.3;

/// A planted solution in its own temporary root.
pub struct Planted {
    /// Keeps the directory alive.
    pub dir: TempDir,
    /// The library root.
    pub root: PathBuf,
    /// The solution id.
    pub solution_id: String,
    /// The configuration.
    pub config_id: ConfigId,
    /// The pair: BB out of position, BTN in position.
    pub pair: PositionPair,
}

impl Planted {
    /// The router over this solution's root.
    pub fn router(&self) -> Router {
        router_over(&self.root)
    }

    /// The key text of the preflop node whose line is one raise to `cbb`.
    #[must_use]
    pub fn key(&self, cbb: u32) -> String {
        preflop_key(&self.config_id, self.pair, line(cbb)).to_string()
    }
}

/// The configuration and pair every planted key names.
#[must_use]
pub fn ids() -> (ConfigId, PositionPair) {
    let config_id = ConfigId::new(PLANTED_CONFIG_ID).expect("a catalog configuration");
    let pair = PositionPair::new(Position::Bb, Position::Btn).expect("two seats");
    (config_id, pair)
}

/// A preflop line of one raise to `cbb`, so every planted node has a distinct key.
#[must_use]
pub fn line(cbb: u32) -> Vec<ActionToken> {
    vec![ActionToken::Raise(Cbb(cbb))]
}

/// A planted preflop node at the line `r<cbb>`: fold, call, raise; the given hands.
#[must_use]
pub fn node(cbb: u32, to_act: Position, space: HandSpace, hands: Vec<SolvedHand>) -> SolvedNode {
    let (config_id, pair) = ids();
    planted_node(
        preflop_key(&config_id, pair, line(cbb)),
        to_act,
        PLANTED_POT,
        fold_call_raise(),
        space,
        hands,
        Some(PLANTED_ACCURACY_PCT_POT),
    )
}

/// The pair's preflop root (the empty line) with `to_act` to act and the given hands.
#[must_use]
pub fn node_of_root(to_act: Position, space: HandSpace, hands: Vec<SolvedHand>) -> SolvedNode {
    let (config_id, pair) = ids();
    planted_node(
        preflop_key(&config_id, pair, Vec::new()),
        to_act,
        PLANTED_POT,
        fold_call_raise(),
        space,
        hands,
        Some(PLANTED_ACCURACY_PCT_POT),
    )
}

/// Writes `nodes` as one solution in a fresh root.
#[must_use]
pub fn plant(nodes: &[SolvedNode]) -> Planted {
    let (dir, root) = empty_root();
    write_solution(&root, PLANTED_SOLUTION_ID, nodes, None);
    let (config_id, pair) = ids();
    Planted { dir, root, solution_id: PLANTED_SOLUTION_ID.to_owned(), config_id, pair }
}

/// The hand index of a class name such as `AKs`.
#[must_use]
pub fn class_index(name: &str) -> u16 {
    let class: HandClass = name.parse().expect("a hand class");
    u16::from(class.index())
}

/// The class name at a hand index.
#[must_use]
pub fn class_name(index: u16) -> String {
    let index = u8::try_from(index).expect("a class index");
    HandClass::from_index(index).expect("a class index").to_string()
}

/// The hand index of a combo such as `AhKh`.
#[must_use]
pub fn combo_index(name: &str) -> u16 {
    let combo: ComboId = name.parse().expect("a combo");
    combo.index()
}

/// The frequencies of a hand that folds, calls or raises purely.
#[must_use]
pub fn pure(action: usize) -> Vec<f64> {
    (0..3).map(|a| if a == action { 1.0 } else { 0.0 }).collect()
}

/// EVs in bb that make `action` the best by a clear margin: the best at 1.0 bb, the others
/// at least 1.5 bb below it (30 percent of the 5 bb pot or more).
#[must_use]
pub fn evs_best(action: usize) -> Vec<f64> {
    let mut evs = vec![-0.5, -1.0, -1.5];
    evs[action] = 1.0;
    evs
}

/// `GET /v1/insights` for one hand.
pub async fn insights(
    router: Router,
    id: &str,
    key: &str,
    hand: &str,
) -> (StatusCode, HeaderMap, Value) {
    let uri = format!("/v1/insights?solution_id={id}&node_key={}&hand={hand}", encode(key));
    get(router, &uri).await
}
