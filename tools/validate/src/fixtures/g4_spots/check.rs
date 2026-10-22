//! The structural checks of a G4 spot list (R2.11), run by `G4Spots::load` after the
//! parse: every source reference resolves, the configuration is in the v1 catalog, the
//! pair parses, the tree builds, the stop rule can stop, the rules are the 04 section 6
//! values in their units, no spot's key repeats or extends another's within the same
//! street (a node dump holds each key once, so two spots at one root would read one
//! node), and every spot's street, key, pot, stack, rake, preflop line and ranges agree
//! with each other, the key being a root (its last street section carries no action).
//! Child module of `g4_spots`; every failure is one reason in plain words, which the
//! loader wraps in `FixtureError::Invalid`.

use std::collections::BTreeSet;

use gto_model::keys::SECTION_SEPARATOR;
use gto_model::{NodeKey, Position, PositionPair, Street, format_cards, parse_line};
use gto_solve::postflop::Range;
use gto_tree::LineKind;

use super::{
    EXPLOITABILITY_MAX_PCT_POT, FREQUENCY_MAD_MAX_POINTS, G4Spots, GATE, PCT_POT,
    PERCENTAGE_POINTS, PreflopSpec, R_ID, RAKE_NONE, RAKE_ONLINE, ROOT_EV_MAX_PCT_POT, Rules, Spot,
    StopSpec,
};

/// Every rule of the module docs over a parsed list.
pub(super) fn check_structure(spots: &G4Spots) -> Result<(), String> {
    if spots.gate != GATE || spots.r_id != R_ID {
        return Err(format!(
            "gate {} and r_id {} are not {GATE} and {R_ID}",
            spots.gate, spots.r_id
        ));
    }
    let source_ids: BTreeSet<&str> = spots.sources.iter().map(|s| s.id.as_str()).collect();
    if source_ids.len() != spots.sources.len() {
        return Err("duplicate source id".to_owned());
    }
    check_source(&source_ids, &spots.tree.source, "tree")?;
    spots
        .game_config()
        .ok_or_else(|| format!("config_id {} names no v1 configuration", spots.config_id))?;
    let pair: PositionPair =
        spots.position_pair.parse().map_err(|err| format!("position_pair: {err}"))?;
    spots.tree.tree_config().map_err(|err| format!("tree: {err}"))?;
    check_stop(&spots.stop)?;
    check_rules(&spots.rules, &source_ids)?;
    check_unique(spots.spots.iter().map(|spot| spot.id.as_str()), "spot")?;
    if spots.spots.is_empty() {
        return Err("no spots".to_owned());
    }
    check_keys_distinct(&spots.spots)?;
    for spot in &spots.spots {
        check_spot(spot, &source_ids, &spots.config_id, pair)
            .map_err(|reason| format!("spot {}: {reason}", spot.id))?;
    }
    Ok(())
}

/// No spot's key equals or extends an earlier spot's key within the same street, in either
/// direction: each list's dump then holds each root once and no root is another's deeper
/// node. A river root extending a turn root is on the next street and is allowed.
fn check_keys_distinct(spots: &[Spot]) -> Result<(), String> {
    for (index, spot) in spots.iter().enumerate() {
        let clash = spots[..index].iter().find(|other| {
            within_street(&spot.node_key, &other.node_key)
                || within_street(&other.node_key, &spot.node_key)
        });
        if let Some(other) = clash {
            return Err(format!(
                "spot {}: key {} repeats or extends the key of spot {} within the same street",
                spot.id, spot.node_key, other.id
            ));
        }
    }
    Ok(())
}

/// `key` equals `root` or adds actions to it with no further street section.
fn within_street(key: &str, root: &str) -> bool {
    key.strip_prefix(root).is_some_and(|rest| !rest.contains(SECTION_SEPARATOR))
}

/// Both targets are percents at or above zero and both caps are at least 1.
fn check_stop(stop: &StopSpec) -> Result<(), String> {
    let target = stop.engine_target_pct_pot;
    if !(target.is_finite() && target >= 0.0) {
        return Err(format!("stop.engine_target_pct_pot {target} is not a percent at or above 0"));
    }
    let oracle = stop.oracle_target_pct_pot;
    if !(oracle.is_finite() && oracle >= 0.0) {
        return Err(format!("stop.oracle_target_pct_pot {oracle} is not a percent at or above 0"));
    }
    if stop.max_iterations == 0 || stop.max_seconds == 0 {
        return Err("stop.max_iterations and stop.max_seconds must be at least 1".to_owned());
    }
    Ok(())
}

/// The three rules carry the 04 section 6 values, units and bounds exactly.
#[allow(clippy::float_cmp, reason = "a rule must state the 04 section 6 value exactly")]
fn check_rules(rules: &Rules, source_ids: &BTreeSet<&str>) -> Result<(), String> {
    let expected = [
        (
            "exploitability_max",
            &rules.exploitability_max,
            EXPLOITABILITY_MAX_PCT_POT,
            PCT_POT,
            true,
        ),
        (
            "frequency_mad_max",
            &rules.frequency_mad_max,
            FREQUENCY_MAD_MAX_POINTS,
            PERCENTAGE_POINTS,
            false,
        ),
        ("root_ev_max", &rules.root_ev_max, ROOT_EV_MAX_PCT_POT, PCT_POT, true),
    ];
    for (name, rule, value, unit, inclusive) in expected {
        check_source(source_ids, &rule.source, &format!("rules.{name}"))?;
        if rule.value != value || rule.unit != unit || rule.inclusive != inclusive {
            return Err(format!(
                "rules.{name} must be {value} {unit} with inclusive {inclusive} (04 section 6), \
                 got {} {} with inclusive {}",
                rule.value, rule.unit, rule.inclusive
            ));
        }
    }
    Ok(())
}

/// One spot: street, key, pot and stack, rake, preflop line and ranges.
fn check_spot(
    spot: &Spot,
    sources: &BTreeSet<&str>,
    config_id: &str,
    pair: PositionPair,
) -> Result<(), String> {
    check_source(sources, &spot.source, "spot")?;
    let street = spot.street().map_err(|err| err.to_string())?;
    if !matches!(street, Street::Turn | Street::River) {
        return Err(format!("street {street} is not turn or river (O-135)"));
    }
    let key = spot.key().map_err(|err| err.to_string())?;
    check_key(spot, &key, street, config_id, pair)?;
    if spot.pot_cbb == 0 || spot.stack_cbb == 0 {
        return Err("pot_cbb and stack_cbb must be above 0".to_owned());
    }
    if spot.rake != RAKE_NONE && spot.rake != RAKE_ONLINE {
        return Err(format!("rake {:?} is not {RAKE_NONE} or {RAKE_ONLINE}", spot.rake));
    }
    check_preflop(&spot.preflop, &key, pair)?;
    let board = key.board().ok_or_else(|| "the key has no board".to_owned())?.cards();
    for (notation, side) in [(spot.ranges.oop_notation(), "oop"), (spot.ranges.ip_notation(), "ip")]
    {
        let range = Range::parse(&notation).map_err(|err| format!("{side} range: {err}"))?;
        if range.live_combos(&board).is_empty() {
            return Err(format!("{side} range has no live combo on {}", spot.board));
        }
    }
    Ok(())
}

/// The key names the list's configuration and pair and the spot's street and board, and
/// is a root: no action on its last street.
fn check_key(
    spot: &Spot,
    key: &NodeKey,
    street: Street,
    config_id: &str,
    pair: PositionPair,
) -> Result<(), String> {
    if key.config_id.as_str() != config_id {
        return Err(format!("the key names config {}, not {config_id}", key.config_id));
    }
    if key.pair != pair {
        return Err(format!("the key names the pair {}, not {pair}", key.pair));
    }
    if key.street() != street {
        return Err(format!("the key is on the {}, not the {street}", key.street()));
    }
    if !key.actions_on(street).is_empty() {
        return Err(format!("the key carries actions on the {street}, so it is not a root"));
    }
    let board = key.board().map(|board| format_cards(&board.cards())).unwrap_or_default();
    if board != spot.board {
        return Err(format!("board {:?} is not the key's {board:?}", spot.board));
    }
    Ok(())
}

/// The line parses and equals the key's preflop line, the kind is a `LineKind` name and
/// the aggressor is a seat of the pair.
fn check_preflop(preflop: &PreflopSpec, key: &NodeKey, pair: PositionPair) -> Result<(), String> {
    parse_line(&preflop.actions).map_err(|err| format!("preflop.actions: {err}"))?;
    if key.line() != preflop.actions {
        return Err(format!(
            "preflop.actions {:?} is not the key's {:?}",
            preflop.actions,
            key.line()
        ));
    }
    let kinds = [LineKind::Limped, LineKind::SingleRaised, LineKind::ThreeBet, LineKind::FourBet];
    if !kinds.iter().any(|kind| kind.as_str() == preflop.kind) {
        return Err(format!("preflop.kind {:?} is not a line kind", preflop.kind));
    }
    let aggressor: Position =
        preflop.aggressor.parse().map_err(|err| format!("preflop.aggressor: {err}"))?;
    if !pair.contains(aggressor) {
        return Err(format!("preflop.aggressor {aggressor} is not a seat of {pair}"));
    }
    Ok(())
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
