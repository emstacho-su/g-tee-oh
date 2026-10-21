//! The structural checks only Rust can make (R2.8, O-132): `check_structure` parses every
//! key, seat, token and configuration field with `gto-model` and checks that they agree with
//! each other. Every sentence is a `Rule::Structural` violation, so these checks never change
//! the rule numbers the corpus compares with the TypeScript checker.
//!
//! Header checks: schema version 1, a known source, a Coordinated Universal Time (UTC)
//! timestamp in the schema's pattern, a known format, 2 to 9 seats, a stake label, a depth
//! above zero, a parsable config id and pair, a `preflop_169` hand space (O-132), two
//! exploitability values at or above zero, at least one node, no key twice and one
//! configuration across the keys. Node checks: the key parses, names the dump's config id and
//! pair and a configuration of the dump's seat count and format, and agrees with the node's
//! street and board; `to_act` is a seat of the pair; two stacks; a pot above zero; 1 to 255
//! actions, each token parsable with a sized token equal to its `size_cbb` and a fold or check
//! at 0; at least one hand (schema `minItems`), so the pack never writes a record the library
//! claims to hold but has no hands for; reach and frequencies within `[0, 1]`; accuracy at or
//! above zero.

use std::collections::BTreeSet;

use gto_model::format_cards;
use gto_model::{ActionToken, ConfigId, GameFormat, NodeKey, Position, PositionPair, TableSize};

use super::{PREFLOP_169, Rule, Violation};
use crate::dump::{DumpAction, DumpHand, DumpNode, NodeDump};

/// The dump's `exported_at` pattern is the manifest's `created_at` pattern (schema
/// `$defs/timestamp`), so the manifest's matcher checks it; `invariants` re-exports it
/// for `convert`.
pub(crate) use gto_library::is_timestamp;

/// The only dump schema version.
const SCHEMA_VERSION: u32 = 1;
/// The two sources a dump may name.
const SOURCES: [&str; 2] = ["own", "reference"];
/// The most actions a record holds: its action count is one byte (A3 section 4).
const MAX_ACTIONS: usize = 255;
/// Stacks and reach values per node or hand, one per seat of the pair.
const SEATS: usize = 2;

/// What every node is checked against, parsed once from the dump's header.
struct Expected {
    pair: Option<PositionPair>,
    config_id: Option<ConfigId>,
    /// `cfg_<seats>_<format>_`, the start of every config id of the dump's configuration.
    config_prefix: Option<String>,
}

/// The structural checks of the module docs; empty when the dump holds.
#[must_use]
pub fn check_structure(d: &NodeDump) -> Vec<Violation> {
    let expected = Expected {
        pair: d.position_pair.parse().ok(),
        config_id: d.config_id.as_deref().and_then(|id| ConfigId::new(id).ok()),
        config_prefix: d
            .config
            .format
            .parse::<GameFormat>()
            .ok()
            .map(|format| format!("cfg_{}_{format}_", d.config.table_size)),
    };
    let nodes = d.nodes.iter().flat_map(|node| check_node(&expected, node));
    check_header(d)
        .into_iter()
        .chain(check_keys(d))
        .chain(nodes)
        .map(|message| Violation::new(Rule::Structural, message))
        .collect()
}

/// The header checks.
fn check_header(d: &NodeDump) -> Vec<String> {
    let config = &d.config;
    let checks = [
        (d.schema_version != SCHEMA_VERSION)
            .then(|| format!("The dump's schema_version {} is not 1.", d.schema_version)),
        (!SOURCES.contains(&d.source.as_str()))
            .then(|| format!("The dump's source {:?} is not own or reference.", d.source)),
        (!is_timestamp(&d.exported_at))
            .then(|| format!("The dump's exported_at {:?} is not a UTC timestamp.", d.exported_at)),
        config.format.parse::<GameFormat>().err().map(|err| format!("The dump's config: {err}.")),
        TableSize::new(config.table_size).err().map(|err| format!("The dump's config: {err}.")),
        config.stake_label.is_empty().then(|| "The dump's stake_label is empty.".to_owned()),
        (config.depth_cbb == 0).then(|| "The dump's depth_cbb is 0, not above 0.".to_owned()),
        d.config_id
            .as_deref()
            .and_then(|id| ConfigId::new(id).err())
            .map(|err| format!("The dump's config_id: {err}.")),
        d.position_pair
            .parse::<PositionPair>()
            .err()
            .map(|err| format!("The dump's position_pair: {err}.")),
        (d.hand_space != PREFLOP_169).then(|| {
            format!("The dump's hand_space is {}; v1 packs preflop_169 only (O-132).", d.hand_space)
        }),
        d.exploitability_pct_pot.as_deref().and_then(check_exploitability),
        d.nodes.is_empty().then(|| "The dump has no nodes.".to_owned()),
    ];
    checks.into_iter().flatten().collect()
}

/// Two values at or above zero, one per seat.
fn check_exploitability(values: &[f64]) -> Option<String> {
    let valid = values.len() == SEATS && values.iter().all(|value| *value >= 0.0);
    (!valid).then(|| {
        format!("The dump's exploitability_pct_pot {values:?} is not two values at or above 0.")
    })
}

/// No key twice, and one configuration across the keys that parse.
fn check_keys(d: &NodeDump) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let repeated = d
        .nodes
        .iter()
        .filter(|node| !seen.insert(node.node_key.as_str()))
        .map(|node| format!("The dump lists the node key {} more than once.", node.node_key));
    let configs: BTreeSet<ConfigId> = d
        .nodes
        .iter()
        .filter_map(|node| node.node_key.parse::<NodeKey>().ok())
        .map(|key| key.config_id)
        .collect();
    let mixed = (configs.len() > 1).then(|| {
        let names: Vec<&str> = configs.iter().map(ConfigId::as_str).collect();
        format!("The dump's keys name more than one configuration: {}.", names.join(", "))
    });
    repeated.chain(mixed).collect()
}

/// The checks of one node.
fn check_node(expected: &Expected, node: &DumpNode) -> Vec<String> {
    let name = format!("Node {}", node.node_key);
    let key_checks = match node.node_key.parse::<NodeKey>() {
        Ok(key) => check_key(expected, node, &name, &key),
        Err(err) => vec![format!("{name} has a key gto-model cannot parse: {err}.")],
    };
    let values = check_values(expected, node, &name);
    let actions = node.actions.iter().filter_map(|action| check_action(&name, action));
    let hands = node.hands.iter().flat_map(|hand| check_hand(&name, hand));
    key_checks.into_iter().chain(values).chain(actions).chain(hands).collect()
}

/// The checks that compare a parsed key with the dump and the node.
fn check_key(expected: &Expected, node: &DumpNode, name: &str, key: &NodeKey) -> Vec<String> {
    let id = &key.config_id;
    let board = key.board().map(|board| format_cards(&board.cards())).unwrap_or_default();
    let street = key.street().as_str();
    let checks = [
        expected
            .config_id
            .as_ref()
            .filter(|wanted| *wanted != id)
            .map(|wanted| format!("{name} names config {id}, not the dump's config_id {wanted}.")),
        expected
            .config_prefix
            .as_deref()
            .filter(|prefix| !id.as_str().starts_with(prefix))
            .map(|prefix| format!("{name} names config {id}, which does not start with {prefix}.")),
        expected
            .pair
            .filter(|pair| *pair != key.pair)
            .map(|pair| format!("{name} names the pair {}, not the dump's {pair}.", key.pair)),
        (node.street != street)
            .then(|| format!("{name} is on the {street} by its key, not the {}.", node.street)),
        (node.board != board)
            .then(|| format!("{name} has board {:?}, but its key deals {board:?}.", node.board)),
    ];
    checks.into_iter().flatten().collect()
}

/// The seat, stack, pot, action count, hand count and accuracy checks of one node.
fn check_values(expected: &Expected, node: &DumpNode, name: &str) -> Vec<String> {
    let seat = match node.to_act.parse::<Position>() {
        Err(err) => Some(format!("{name} has to_act {:?}: {err}.", node.to_act)),
        Ok(seat) => expected
            .pair
            .filter(|pair| !pair.contains(seat))
            .map(|pair| format!("{name} has to_act {seat}, which is not a seat of {pair}.")),
    };
    let count = node.actions.len();
    let checks = [
        seat,
        (node.stacks_cbb.len() != SEATS)
            .then(|| format!("{name} has {} stacks, not {SEATS}.", node.stacks_cbb.len())),
        (node.pot_cbb == 0).then(|| format!("{name} has a pot of 0, not above 0.")),
        (count == 0 || count > MAX_ACTIONS)
            .then(|| format!("{name} has {count} actions, not 1 to {MAX_ACTIONS}.")),
        node.hands.is_empty().then(|| format!("{name} has no hands; a node holds at least one.")),
        node.accuracy_pct_pot
            .filter(|accuracy| *accuracy < 0.0)
            .map(|accuracy| format!("{name} has accuracy_pct_pot {accuracy}, below 0.")),
    ];
    checks.into_iter().flatten().collect()
}

/// A token `gto-model` parses, sized as its `size_cbb` says; a fold or check at 0.
fn check_action(name: &str, action: &DumpAction) -> Option<String> {
    let text = &action.token;
    let size = action.size_cbb;
    match action.token.parse::<ActionToken>() {
        Err(err) => Some(format!("{name} has an action token gto-model cannot parse: {err}.")),
        Ok(token) => match token.size() {
            Some(sized) if sized.get() != size => {
                Some(format!("{name} has token {text} with size_cbb {size}, not {sized}."))
            }
            None if matches!(token, ActionToken::Fold | ActionToken::Check) && size != 0 => {
                Some(format!("{name} has token {text} with size_cbb {size}, not 0."))
            }
            _ => None,
        },
    }
}

/// Reach and frequencies within `[0, 1]`, and one reach value per seat.
fn check_hand(name: &str, hand: &DumpHand) -> Vec<String> {
    let who = format!("{name} hand {}", hand.hand);
    let unit = |value: &f64| (0.0..=1.0).contains(value);
    let reach = hand.reach.as_deref().and_then(|reach| {
        let valid = reach.len() == SEATS && reach.iter().all(unit);
        (!valid).then(|| format!("{who} has reach {reach:?}, not two values within [0, 1]."))
    });
    let frequencies = (!hand.frequencies.iter().all(unit))
        .then(|| format!("{who} has frequencies {:?} outside [0, 1].", hand.frequencies));
    [reach, frequencies].into_iter().flatten().collect()
}
