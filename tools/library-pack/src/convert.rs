//! Dump to library input (R2.8, O-131, O-132): a checked `NodeDump` becomes a
//! `SolutionMeta` and the solved nodes `gto-library` writes.
//!
//! O-131 defaults: `tree_hash` is the sha256 over the sorted (node key, action tokens)
//! list; the solution id is the dump's sha256 formatted as a version-8 universally unique
//! identifier (UUID) and `created_at` is the dump's `exported_at`, so packing one dump twice
//! gives the same bytes; `PackOptions` overrides both. The dump's sha256 is taken over its
//! compact JSON (JavaScript Object Notation) serialization after parsing, so whitespace in
//! the file does not change the id. `engine_version`, `seed` and `iterations` come from the
//! options and are required when the source is `own`, as is the dump's
//! `exploitability_pct_pot`; a reference dump without an engine version is labeled
//! `DEFAULT_REFERENCE_ENGINE`. The `config_id` comes from the node keys and must equal the
//! dump's when it has one; it is never derived from the stake label (plan G7).
//!
//! Each node's hands are sorted by hand index, the order the library stores them in.
//!
//! Lane P (pack) owns this file.

use gto_library::{
    HandSpace, ManifestConfig, SolutionMeta, SolvedHand, SolvedNode, Source, sha256_hex,
};
use gto_model::format_line;
use gto_model::{ActionToken, Cbb, GameFormat, NodeKey, Position, PositionPair, TableSize};

use crate::dump::{DumpHand, DumpNode, NodeDump};
use crate::invariants::{
    PREFLOP_169, Rule, Violation, canonical_hand_index, check_invariants, check_structure,
    is_timestamp,
};

/// The engine label of a reference dump packed without `--engine-version`: an opaque label,
/// never a product name (manifest schema).
pub const DEFAULT_REFERENCE_ENGINE: &str = "reference";

/// The version nibble of a version-8 UUID (Request for Comments (RFC) 9562).
const UUID_VERSION: char = '8';
/// The variant bits of an RFC 9562 UUID: the top two bits of the variant nibble are `10`.
const UUID_VARIANT_BITS: u32 = 0b1000;
/// Keeps the low two bits of the variant nibble.
const UUID_VARIANT_MASK: u32 = 0b0011;
/// The hexadecimal digits of each UUID group.
const UUID_GROUPS: [usize; 5] = [8, 4, 4, 4, 12];
/// The hexadecimal digits of a UUID, the sum of `UUID_GROUPS`.
const UUID_HEX_DIGITS: usize = 32;
/// Where the version digit sits among the 32 digits.
const UUID_VERSION_AT: usize = 12;
/// Where the variant digit sits among the 32 digits.
const UUID_VARIANT_AT: usize = 16;
/// Base 16.
const HEX_RADIX: u32 = 16;

/// What the command line adds to a dump.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PackOptions {
    /// Overrides the default id derived from the dump's sha256.
    pub solution_id: Option<String>,
    /// Overrides the default timestamp, the dump's `exported_at`.
    pub created_at: Option<String>,
    /// The engine version; required for an own dump.
    pub engine_version: Option<String>,
    /// The solve's seed; required for an own dump.
    pub seed: Option<u64>,
    /// The solve's iteration count; required for an own dump.
    pub iterations: Option<u64>,
    /// Marks the solution as synthetic test data.
    pub synthetic: bool,
}

/// Checks a dump with both checkers, then converts it.
///
/// # Errors
///
/// Every violation found, for example a missing `engine_version` on an own dump, a hand
/// space other than `preflop_169`, or a value `gto-model` rejects.
pub fn to_solution(
    d: &NodeDump,
    o: &PackOptions,
) -> Result<(SolutionMeta, Vec<SolvedNode>), Vec<Violation>> {
    let found = [check_invariants(d), check_structure(d)].concat();
    if !found.is_empty() {
        return Err(found);
    }
    convert_checked(d, o)
}

/// Converts a dump that passed `check_invariants` and `check_structure`; the conversion
/// still reports, never panics on, anything those checks would have caught.
pub(crate) fn convert_checked(
    d: &NodeDump,
    o: &PackOptions,
) -> Result<(SolutionMeta, Vec<SolvedNode>), Vec<Violation>> {
    let nodes = solved_nodes(d)?;
    let meta = solution_meta(d, o, &nodes)?;
    Ok((meta, nodes))
}

/// The dump's nodes as solved nodes, in dump order.
pub(crate) fn solved_nodes(d: &NodeDump) -> Result<Vec<SolvedNode>, Vec<Violation>> {
    if d.hand_space != PREFLOP_169 {
        let message =
            format!("The dump's hand_space is {}; v1 packs preflop_169 only.", d.hand_space);
        return Err(vec![structural(message)]);
    }
    let mut nodes = Vec::with_capacity(d.nodes.len());
    let mut errors = Vec::new();
    for node in &d.nodes {
        match solved_node(node) {
            Ok(solved) => nodes.push(solved),
            Err(found) => errors.extend(found),
        }
    }
    if errors.is_empty() { Ok(nodes) } else { Err(errors) }
}

/// The sha256 over the sorted (node key, action tokens) list (O-131, lead decision 2): one
/// line per node, the key text, a tab, the tokens joined with dots, and a newline.
#[must_use]
pub fn tree_hash(nodes: &[SolvedNode]) -> String {
    let mut lines: Vec<String> = nodes
        .iter()
        .map(|node| {
            let tokens: Vec<ActionToken> = node.actions.iter().map(|(token, _)| *token).collect();
            format!("{}\t{}\n", node.key, format_line(&tokens))
        })
        .collect();
    lines.sort();
    sha256_hex(lines.concat().as_bytes())
}

/// The dump's sha256, over its compact serialization, as a version-8 UUID.
///
/// # Errors
///
/// A structural violation when the dump does not serialize.
pub fn default_solution_id(d: &NodeDump) -> Result<String, Violation> {
    let bytes = serde_json::to_vec(d)
        .map_err(|err| structural(format!("The dump does not serialize: {err}.")))?;
    let mut digits: Vec<char> = sha256_hex(&bytes).chars().take(UUID_HEX_DIGITS).collect();
    if digits.len() != UUID_HEX_DIGITS {
        return Err(structural("The dump's sha256 is too short to form a UUID."));
    }
    let variant = digits[UUID_VARIANT_AT].to_digit(HEX_RADIX).unwrap_or(0);
    let variant = (variant & UUID_VARIANT_MASK) | UUID_VARIANT_BITS;
    digits[UUID_VERSION_AT] = UUID_VERSION;
    digits[UUID_VARIANT_AT] = char::from_digit(variant, HEX_RADIX).unwrap_or(UUID_VERSION);
    let mut groups = Vec::with_capacity(UUID_GROUPS.len());
    let mut rest = digits.as_slice();
    for width in UUID_GROUPS {
        let (group, tail) = rest.split_at(width);
        groups.push(group.iter().collect::<String>());
        rest = tail;
    }
    Ok(groups.join("-"))
}

/// True for a lowercase hexadecimal UUID, the manifest schema's `id` pattern.
#[must_use]
pub fn is_uuid(text: &str) -> bool {
    let is_lower_hex = |byte: u8| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte);
    let groups: Vec<&str> = text.split('-').collect();
    groups.len() == UUID_GROUPS.len()
        && groups
            .iter()
            .zip(UUID_GROUPS)
            .all(|(group, width)| group.len() == width && group.bytes().all(is_lower_hex))
}

fn structural(message: impl Into<String>) -> Violation {
    Violation::new(Rule::Structural, message)
}

/// One dump node as a solved node.
fn solved_node(node: &DumpNode) -> Result<SolvedNode, Vec<Violation>> {
    let name = format!("Node {}", node.node_key);
    let invalid = |what: &str, err: &dyn std::fmt::Display| {
        vec![structural(format!("{name} has an invalid {what}: {err}."))]
    };
    let key: NodeKey = node.node_key.parse().map_err(|err| invalid("key", &err))?;
    let to_act: Position = node.to_act.parse().map_err(|err| invalid("to_act", &err))?;
    let stacks: [u32; 2] = node
        .stacks_cbb
        .as_slice()
        .try_into()
        .map_err(|_| invalid("stacks_cbb", &"expected two stacks"))?;
    let actions = node
        .actions
        .iter()
        .map(|action| {
            let token: ActionToken = action.token.parse().map_err(|err| invalid("token", &err))?;
            Ok((token, Cbb(action.size_cbb)))
        })
        .collect::<Result<Vec<_>, Vec<Violation>>>()?;
    let mut hands = node
        .hands
        .iter()
        .map(|hand| solved_hand(&name, hand))
        .collect::<Result<Vec<_>, Vec<Violation>>>()?;
    hands.sort_by_key(|hand| hand.hand);
    Ok(SolvedNode {
        key,
        to_act,
        pot: Cbb(node.pot_cbb),
        stacks: stacks.map(Cbb),
        actions,
        hand_space: HandSpace::Preflop169,
        hands,
        accuracy_pct_pot: node.accuracy_pct_pot.map(narrow),
    })
}

/// One dump hand as a solved hand.
fn solved_hand(name: &str, hand: &DumpHand) -> Result<SolvedHand, Vec<Violation>> {
    let label = &hand.hand;
    let index = canonical_hand_index(PREFLOP_169, label).ok_or_else(|| {
        vec![structural(format!("{name} hand {label} is not a canonical preflop_169 label."))]
    })?;
    let reach = match hand.reach.as_deref() {
        None => None,
        Some(&[oop, ip]) => Some([oop, ip]),
        Some(other) => {
            let message = format!("{name} hand {label} has reach {other:?}, not two values.");
            return Err(vec![structural(message)]);
        }
    };
    Ok(SolvedHand {
        hand: index,
        reach,
        frequencies: hand.frequencies.clone(),
        ev_bb: hand.ev_bb.clone(),
    })
}

/// The manifest metadata for a converted dump.
fn solution_meta(
    d: &NodeDump,
    o: &PackOptions,
    nodes: &[SolvedNode],
) -> Result<SolutionMeta, Vec<Violation>> {
    let first = nodes.first().ok_or_else(|| vec![structural("The dump has no nodes.")])?;
    let source = match d.source.as_str() {
        "own" => Source::Own,
        "reference" => Source::Reference,
        other => return Err(vec![structural(format!("The dump's source {other:?} is unknown."))]),
    };
    let config = manifest_config(d)?;
    let pair: PositionPair = d
        .position_pair
        .parse()
        .map_err(|err| vec![structural(format!("The dump's position_pair is invalid: {err}."))])?;
    let provenance = provenance(d, o, source)?;
    let id = match &o.solution_id {
        Some(id) => id.clone(),
        None => default_solution_id(d).map_err(|violation| vec![violation])?,
    };
    let created_at = o.created_at.clone().unwrap_or_else(|| d.exported_at.clone());
    let found = identity_violations(&id, &created_at);
    if !found.is_empty() {
        return Err(found);
    }
    Ok(SolutionMeta {
        id,
        source,
        engine_version: provenance.engine_version,
        config,
        config_id: first.key.config_id.clone(),
        pair,
        tree_hash: tree_hash(nodes),
        seed: o.seed,
        iterations: o.iterations,
        exploitability_pct_pot: provenance.exploitability,
        synthetic: o.synthetic,
        created_at,
    })
}

/// The engine version and exploitability of a solution.
struct Provenance {
    engine_version: String,
    exploitability: Option<[f64; 2]>,
}

/// The engine version and exploitability, with the fields an own dump requires (O-131).
fn provenance(d: &NodeDump, o: &PackOptions, source: Source) -> Result<Provenance, Vec<Violation>> {
    let exploitability = match d.exploitability_pct_pot.as_deref() {
        None => None,
        Some(&[oop, ip]) => Some([oop, ip]),
        Some(other) => {
            let message = format!("The dump's exploitability_pct_pot {other:?} is not two values.");
            return Err(vec![structural(message)]);
        }
    };
    let engine = o.engine_version.clone().filter(|version| !version.is_empty());
    if source == Source::Own {
        let missing = [
            ("--engine-version", engine.is_none()),
            ("--seed", o.seed.is_none()),
            ("--iterations", o.iterations.is_none()),
            ("the dump's exploitability_pct_pot", exploitability.is_none()),
        ];
        let found: Vec<Violation> = missing
            .iter()
            .filter(|(_, absent)| *absent)
            .map(|(what, _)| structural(format!("An own dump needs {what} (O-131).")))
            .collect();
        if !found.is_empty() {
            return Err(found);
        }
    }
    let engine_version = engine.unwrap_or_else(|| DEFAULT_REFERENCE_ENGINE.to_owned());
    Ok(Provenance { engine_version, exploitability })
}

/// A lowercase UUID id and a Coordinated Universal Time (UTC) timestamp in the schema's
/// pattern, checked before any output path is built from them.
fn identity_violations(id: &str, created_at: &str) -> Vec<Violation> {
    let checks = [
        (!is_uuid(id)).then(|| format!("The solution id {id:?} is not a lowercase UUID.")),
        (!is_timestamp(created_at))
            .then(|| format!("The created_at {created_at:?} is not a UTC timestamp.")),
    ];
    checks.into_iter().flatten().map(structural).collect()
}

/// The manifest's configuration, with the stake label copied verbatim (plan G7).
fn manifest_config(d: &NodeDump) -> Result<ManifestConfig, Vec<Violation>> {
    let config = &d.config;
    let format: GameFormat = config
        .format
        .parse()
        .map_err(|err| vec![structural(format!("The dump's config format is invalid: {err}."))])?;
    let table_size = TableSize::new(config.table_size).map_err(|err| {
        vec![structural(format!("The dump's config table_size is invalid: {err}."))]
    })?;
    Ok(ManifestConfig {
        format,
        table_size,
        stake: config.stake_label.clone(),
        depth_cbb: Cbb(config.depth_cbb),
        straddle: config.straddle,
        ante_cbb: Cbb(config.ante_cbb),
    })
}

/// An accuracy in percent of the pot as the record's f32.
#[expect(
    clippy::cast_possible_truncation,
    reason = "the record stores accuracy as an f32 (A3 section 4, O-130); rounding is intended"
)]
fn narrow(value: f64) -> f32 {
    value as f32
}
