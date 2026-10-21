//! The deal filter of `POST /v1/deal` and what v1 resolves it to (O-145, plan C.4). The
//! chunk directory holds key hashes only, so the library cannot enumerate node keys; a
//! deal therefore starts at the pair's root key (no `line`), at the api-supplied `line`,
//! or, for a `spot_class_key`, at the first line of `CANDIDATE_LINES` in the key's action
//! family that a solution of the pair holds. `texture` is 400 in v1 (preflop only), as is
//! any `start_street` but `preflop`. The start node must exist through `Library::node` in
//! one of `Library::solutions_for`'s solutions, or the deal is 404.

use std::sync::Arc;

use gto_model::{
    ActionFamily, ActionToken, ConfigId, DepthBand, NodeKey, Position, PositionPair, SpotClass,
    SpotClassKey, Street, parse_line, v1_configs,
};

use crate::api::deal::DealFilter;
use crate::error::ApiError;
use crate::library::Library;

/// A record's `to_act` seat indexes: 0 out of position, 1 in position (A3 section 4).
const OOP_SEAT: u8 = 0;
const IP_SEAT: u8 = 1;

/// Candidate preflop lines for a `spot_class_key`, tried in this order and kept when
/// `ActionFamily::classify` puts them in the key's family (O-145). The sizes follow the
/// seeded sizing conventions (`db/migrations/20261020001100_seed_catalog.sql`): online
/// opens to 2.5 bb with 3x in-position and 4x out-of-position 3-bets and 2.2x 4-bets;
/// live opens to 4 bb with 3x and 3.5x 3-bets and 2.3x 4-bets; a limp and a 2 bb straddle
/// serve the live families. The root (the empty line) is the raise-first-in start and the
/// blind-versus-blind start.
pub const CANDIDATE_LINES: [&str; 23] = [
    "",
    "r250",
    "r400",
    "r300",
    "r200",
    "r250.c",
    "r400.c",
    "r300.c",
    "r250.r750",
    "r250.r1000",
    "r400.r1200",
    "r400.r1400",
    "r300.r900",
    "r300.r1200",
    "r250.r750.r1650",
    "r250.r1000.r2200",
    "r400.r1200.r2760",
    "r400.r1400.r3220",
    "l",
    "l.l",
    "s200",
    "s200.r600",
    "s200.c",
];

/// A resolved start: the street, the node key, the pair's solutions and the seats.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Start {
    /// The street the deal starts on, `preflop` in v1.
    pub street: Street,
    /// The node key the deal starts at.
    pub key: NodeKey,
    /// The solutions the registry holds for the configuration and pair, by id.
    pub solution_ids: Vec<String>,
    /// The seat to act at the start node.
    pub hero: Position,
    /// The other seat.
    pub villain: Position,
}

/// Where a filter asks to start: one line, or a spot class to find a line for.
#[derive(Clone, Debug, PartialEq, Eq)]
enum StartAt {
    Line(Vec<ActionToken>),
    Class(SpotClass),
}

/// A filter after parsing, before the library is consulted.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Parsed {
    street: Street,
    config_id: ConfigId,
    pair: PositionPair,
    start: StartAt,
}

/// Parses every field of the filter without touching the library (strict parsing before
/// any filesystem read).
fn parse_filter(filter: &DealFilter) -> Result<Parsed, ApiError> {
    if let Some(texture) = &filter.texture {
        return Err(ApiError::BadRequest(format!(
            "texture {} is not a v1 filter: deals start preflop (O-145)",
            ApiError::quoted(texture)
        )));
    }
    let street = parse_street(&filter.start_street)?;
    let config_id = ConfigId::new(filter.config_id.as_str())?;
    let pair: PositionPair = filter.pair.parse()?;
    let start = parse_start(filter, &config_id, pair)?;
    Ok(Parsed { street, config_id, pair, start })
}

/// The start street, `preflop` only in v1.
fn parse_street(text: &str) -> Result<Street, ApiError> {
    let street: Street = text.parse()?;
    if street == Street::Preflop {
        Ok(street)
    } else {
        Err(ApiError::BadRequest(format!(
            "start_street {street} is not supported: v1 deals start preflop"
        )))
    }
}

/// The line or the spot class the filter names; neither is the root.
fn parse_start(
    filter: &DealFilter,
    config_id: &ConfigId,
    pair: PositionPair,
) -> Result<StartAt, ApiError> {
    match (&filter.line, &filter.spot_class_key) {
        (Some(_), Some(_)) => Err(ApiError::BadRequest(
            "line and spot_class_key are exclusive; send one of them".to_owned(),
        )),
        (Some(line), None) => Ok(StartAt::Line(parse_line(line)?)),
        (None, Some(key)) => Ok(StartAt::Class(parse_class(key, config_id, pair)?)),
        (None, None) => Ok(StartAt::Line(Vec::new())),
    }
}

/// The spot class a key names, which must agree with the filter's pair and, when the
/// configuration is in the v1 catalog, with its format and depth band.
fn parse_class(
    text: &str,
    config_id: &ConfigId,
    pair: PositionPair,
) -> Result<SpotClass, ApiError> {
    let key = SpotClassKey::new(text)?;
    let class = SpotClass::from_key(&key)?;
    if class.pair != pair {
        return Err(ApiError::BadRequest(format!(
            "spot_class_key names pair {} but the filter names {pair}",
            class.pair
        )));
    }
    let catalog = v1_configs().into_iter().find(|config| config.config_id() == *config_id);
    if let Some(config) = catalog {
        let depth_band = DepthBand::from_cbb(config.depth_cbb);
        if class.format != config.format || class.depth_band != depth_band {
            return Err(ApiError::BadRequest(format!(
                "spot_class_key names {}/{} but {config_id} is {}/{depth_band}",
                class.format, class.depth_band, config.format
            )));
        }
    }
    Ok(class)
}

/// The candidate lines of `family` for `pair`, in table order (O-145).
#[must_use]
pub fn candidate_lines(pair: PositionPair, family: ActionFamily) -> Vec<Vec<ActionToken>> {
    CANDIDATE_LINES
        .iter()
        .filter_map(|text| parse_line(text).ok())
        .filter(|line| ActionFamily::classify(pair, line) == family)
        .collect()
}

/// Resolves the filter to a start node held by a solution of the pair.
///
/// # Errors
///
/// `ApiError::BadRequest` for a field that does not parse or a filter v1 does not take;
/// `ApiError::NotFound` when the library holds no solution of the pair or none holds a
/// start node for the filter; `ApiError::Unavailable` when a solution of the pair is
/// marked unavailable.
pub async fn resolve_start(library: &Arc<Library>, filter: &DealFilter) -> Result<Start, ApiError> {
    let Parsed { street, config_id, pair, start } = parse_filter(filter)?;
    let solution_ids: Vec<String> =
        library.solutions_for(&config_id, pair).into_iter().map(|info| info.id).collect();
    if solution_ids.is_empty() {
        return Err(ApiError::NotFound(format!(
            "no solution of {config_id} {pair} is in the library"
        )));
    }
    let (candidates, asked) = match start {
        StartAt::Line(line) => {
            let asked = format!("line {:?}", line_text(&line));
            (vec![line], asked)
        }
        StartAt::Class(class) => {
            (candidate_lines(pair, class.family), format!("family {}", class.family))
        }
    };
    for line in candidates {
        let key = NodeKey::preflop(config_id.clone(), pair, line);
        if let Some(to_act) = first_holding(library, &solution_ids, &key).await? {
            let (hero, villain) = seats(pair, to_act)?;
            return Ok(Start { street, key, solution_ids, hero, villain });
        }
    }
    Err(ApiError::NotFound(format!(
        "no solution of {config_id} {pair} holds a start node for {asked}"
    )))
}

/// The seat to act at `key` in the first of `solution_ids` that holds it, `None` when
/// none does; an unavailable solution or an internal failure stops the search.
async fn first_holding(
    library: &Arc<Library>,
    solution_ids: &[String],
    key: &NodeKey,
) -> Result<Option<u8>, ApiError> {
    for id in solution_ids {
        match Arc::clone(library).node_blocking(id.clone(), key.clone()).await {
            Ok(view) => return Ok(Some(view.record().to_act)),
            Err(ApiError::NotFound(_)) => {}
            Err(other) => return Err(other),
        }
    }
    Ok(None)
}

/// Hero (the seat to act) and villain for a record's `to_act` index.
fn seats(pair: PositionPair, to_act: u8) -> Result<(Position, Position), ApiError> {
    match to_act {
        OOP_SEAT => Ok((pair.oop(), pair.ip())),
        IP_SEAT => Ok((pair.ip(), pair.oop())),
        other => Err(ApiError::Internal(format!(
            "record seat index {other} is neither {OOP_SEAT} nor {IP_SEAT}"
        ))),
    }
}

/// A line as its dotted text, for a detail.
fn line_text(line: &[ActionToken]) -> String {
    gto_model::format_line(line)
}

#[cfg(test)]
mod tests {
    use gto_model::{ActionFamily, Position, PositionPair, format_line, parse_line};

    use super::{CANDIDATE_LINES, StartAt, candidate_lines, parse_filter};
    use crate::api::deal::DealFilter;
    use crate::error::ApiError;

    fn filter() -> DealFilter {
        DealFilter {
            config_id: "cfg_6_online_100".to_owned(),
            pair: "BB-BTN".to_owned(),
            start_street: "preflop".to_owned(),
            line: None,
            spot_class_key: None,
            texture: None,
        }
    }

    fn pair() -> PositionPair {
        PositionPair::new(Position::Bb, Position::Btn).expect("two seats")
    }

    fn bad_request(filter: &DealFilter) -> String {
        match parse_filter(filter) {
            Err(ApiError::BadRequest(detail)) => detail,
            other => panic!("expected a bad request, got {other:?}"),
        }
    }

    #[test]
    fn r2_13_candidate_lines_all_parse_and_cover_every_family() {
        for text in CANDIDATE_LINES {
            let line = parse_line(text).unwrap_or_else(|err| panic!("{text:?}: {err}"));
            assert_eq!(format_line(&line), text, "one spelling per candidate");
        }
        let blinds = PositionPair::new(Position::Sb, Position::Bb).expect("two seats");
        for family in ActionFamily::ALL {
            let pair = if family == ActionFamily::BlindVsBlind { blinds } else { pair() };
            assert!(!candidate_lines(pair, family).is_empty(), "{family} has a candidate");
        }
        assert_eq!(candidate_lines(pair(), ActionFamily::Rfi), vec![Vec::new()], "the root");
        let facing_open = candidate_lines(pair(), ActionFamily::FacingOpen);
        assert_eq!(format_line(&facing_open[0]), "r250", "the online open comes first");
        assert_eq!(candidate_lines(blinds, ActionFamily::FacingOpen), Vec::<Vec<_>>::new());
    }

    #[test]
    fn r2_13_parse_filter_takes_the_root_a_line_or_a_spot_class() {
        let root = parse_filter(&filter()).expect("the root parses");
        assert_eq!(root.start, StartAt::Line(Vec::new()));
        assert_eq!(root.pair, pair());
        let line = DealFilter { line: Some("r250".to_owned()), ..filter() };
        let parsed = parse_filter(&line).expect("a line parses");
        assert_eq!(parsed.start, StartAt::Line(parse_line("r250").expect("a line")));
        let key = "preflop/online/100/facing-open/BB-BTN".to_owned();
        let class = DealFilter { spot_class_key: Some(key), ..filter() };
        let parsed = parse_filter(&class).expect("a class parses");
        assert!(
            matches!(parsed.start, StartAt::Class(class) if class.family == ActionFamily::FacingOpen)
        );
    }

    #[test]
    fn r2_13_parse_filter_rejects_what_v1_does_not_take() {
        let texture = DealFilter { texture: Some("rainbow-dry".to_owned()), ..filter() };
        assert!(bad_request(&texture).contains("texture"));
        let flop = DealFilter { start_street: "flop".to_owned(), ..filter() };
        assert!(bad_request(&flop).contains("preflop"));
        let street = DealFilter { start_street: "turnip".to_owned(), ..filter() };
        assert_ne!(bad_request(&street), "");
        let both = DealFilter {
            line: Some("r250".to_owned()),
            spot_class_key: Some("preflop/online/100/rfi/BB-BTN".to_owned()),
            ..filter()
        };
        assert!(bad_request(&both).contains("exclusive"));
        let other_pair = "preflop/online/100/rfi/BB-CO".to_owned();
        let pair_mismatch = DealFilter { spot_class_key: Some(other_pair), ..filter() };
        assert!(bad_request(&pair_mismatch).contains("pair"));
        let live = "preflop/live/100/rfi/BB-BTN".to_owned();
        let format_mismatch = DealFilter { spot_class_key: Some(live), ..filter() };
        assert!(bad_request(&format_mismatch).contains("online"));
        let bogus = DealFilter { spot_class_key: Some("bogus".to_owned()), ..filter() };
        assert_ne!(bad_request(&bogus), "");
        let bad_line = DealFilter { line: Some("r".to_owned()), ..filter() };
        assert_ne!(bad_request(&bad_line), "");
        let bad_pair = DealFilter { pair: "BTN-BB".to_owned(), ..filter() };
        assert!(bad_request(&bad_pair).contains("BB-BTN"));
        let bad_config = DealFilter { config_id: "Cfg!".to_owned(), ..filter() };
        assert_ne!(bad_request(&bad_config), "");
    }
}
