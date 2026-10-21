//! The manifest rules serde cannot express (R2.7, A3 section 3), mirroring
//! `schemas/manifest.schema.json`: the format version, the fields each kind requires, and the
//! string patterns. The crate has no regular expression dependency, so every pattern is a small
//! hand-written matcher whose doc comment quotes the schema pattern it stands for; the unit
//! tests below hold each matcher to its pattern on accepted and rejected inputs.
//!
//! Mechanism: `manifest` checks every field that is present first, whatever the kind, the way
//! the schema's property definitions apply to every document, and then the kind's required
//! list, the way the schema's `allOf` conditionals do. The first broken rule is reported as
//! one sentence that names the field.

use std::fmt;

use crate::SUPPORTED_FORMAT_VERSIONS;
use crate::error::LibraryError;

use super::{ChunkRef, FileRef, LineEntry, MAX_CHUNKS, Manifest, ManifestKind, Runout, Source};

/// Digits in a sha256 or a tree hash (lead decision 2).
const SHA256_HEX_DIGITS: usize = 64;
/// The most suit-isomorphic flops one flop stands for.
const MAX_FLOP_WEIGHT: u8 = 24;
/// The most fraction digits a timestamp may carry.
const MAX_FRACTION_DIGITS: usize = 9;
/// Card ranks and suits as the schema's card pattern spells them.
const RANKS: &[u8] = b"23456789TJQKA";
const SUITS: &[u8] = b"cdhs";

/// Every rule of the module docs for `m`.
pub(super) fn manifest(m: &Manifest) -> Result<(), LibraryError> {
    if !SUPPORTED_FORMAT_VERSIONS.contains(&m.format_version) {
        return Err(LibraryError::UnsupportedFormat(m.format_version));
    }
    check_header(m)?;
    check_solve_settings(m)?;
    check_files(m)?;
    match m.kind {
        ManifestKind::Preflop => check_preflop_requires(m),
        ManifestKind::FlopBuild => check_flop_build_requires(m),
    }
}

/// `Ok` when `ok`, else `LibraryError::Manifest` with the sentence `message` builds.
fn rule(ok: bool, message: impl FnOnce() -> String) -> Result<(), LibraryError> {
    if ok { Ok(()) } else { Err(LibraryError::Manifest(message())) }
}

fn check_header(m: &Manifest) -> Result<(), LibraryError> {
    rule(is_uuid(&m.id), || format!("id {:?} is not a lowercase UUID", m.id))?;
    rule(!m.engine_version.is_empty(), || "engine_version is empty".to_owned())?;
    rule(!m.config.stake.is_empty(), || "config.stake is empty".to_owned())?;
    rule(m.config.depth_cbb.get() >= 1, || "config.depth_cbb is zero".to_owned())?;
    if let Some(id) = &m.config_id {
        rule(is_config_id(id.as_str()), || format!("config_id {id} breaks the grammar"))?;
    }
    if let Some(flop) = &m.flop {
        rule(is_flop(flop), || format!("flop {flop:?} is not three cards in written order"))?;
    }
    if let Some(weight) = m.flop_weight {
        rule((1..=MAX_FLOP_WEIGHT).contains(&weight), || {
            format!("flop_weight {weight} is outside 1 to {MAX_FLOP_WEIGHT}")
        })?;
    }
    rule(is_timestamp(&m.created_at), || {
        format!("created_at {:?} is not a UTC timestamp ending in Z", m.created_at)
    })
}

fn check_solve_settings(m: &Manifest) -> Result<(), LibraryError> {
    if let Some(hash) = &m.tree_hash {
        rule(is_sha256(hash), || format!("tree_hash {hash:?} is not 64 lowercase hex digits"))?;
    }
    if let Some(iterations) = m.iterations {
        rule(iterations >= 1, || "iterations is zero".to_owned())?;
    }
    if let Some(values) = m.exploitability_pct_pot {
        check_exploitability("exploitability_pct_pot", values)?;
    }
    Ok(())
}

fn check_exploitability(field: &str, values: [f64; 2]) -> Result<(), LibraryError> {
    rule(values.iter().all(|v| v.is_finite() && *v >= 0.0), || {
        format!("{field} {values:?} holds a negative or non-finite value")
    })
}

fn check_files(m: &Manifest) -> Result<(), LibraryError> {
    if let Some(chunks) = &m.chunks {
        check_chunks(chunks)?;
    }
    if let Some(lines) = &m.lines {
        rule(!lines.is_empty(), || "lines is empty".to_owned())?;
        lines.iter().try_for_each(check_line_entry)?;
        let names: Vec<&str> = lines.iter().map(|entry| entry.line.as_str()).collect();
        listed_once("line", &names)?;
    }
    if let Some(runouts) = &m.runouts {
        runouts.iter().try_for_each(check_runout)?;
        let names: Vec<String> = runouts.iter().map(|r| format!("{}{}", r.turn, r.river)).collect();
        listed_once("runout", &names)?;
    }
    for root in m.turn_roots.iter().flatten() {
        rule(is_line(&root.line), || format!("turn_roots line {:?} is malformed", root.line))?;
        check_file_ref(
            "turn_roots",
            &FileRef { path: root.path.clone(), sha256: root.sha256.clone() },
        )?;
    }
    Ok(())
}

fn check_chunks(chunks: &[ChunkRef]) -> Result<(), LibraryError> {
    rule(!chunks.is_empty(), || "chunks is empty".to_owned())?;
    rule(chunks.len() <= MAX_CHUNKS, || {
        format!("{} chunks exceed the limit of {MAX_CHUNKS}", chunks.len())
    })?;
    for (index, chunk) in chunks.iter().enumerate() {
        rule(is_chunk_path(&chunk.path), || format!("chunk path {:?} is malformed", chunk.path))?;
        rule(is_sha256(&chunk.sha256), || format!("chunk {} has a malformed sha256", chunk.path))?;
        rule(chunk.node_count >= 1, || format!("chunk {} holds no node", chunk.path))?;
        let repeated = chunks[..index].iter().any(|earlier| earlier.path == chunk.path);
        rule(!repeated, || format!("chunk {} is listed more than once", chunk.path))?;
    }
    Ok(())
}

fn check_line_entry(entry: &LineEntry) -> Result<(), LibraryError> {
    let line = &entry.line;
    rule(is_line(line), || format!("line {line:?} is malformed"))?;
    rule(is_sha256(&entry.tree_hash), || format!("line {line} has a malformed tree_hash"))?;
    rule(entry.iterations >= 1, || format!("line {line} ran zero iterations"))?;
    check_exploitability(
        &format!("line {line} exploitability_pct_pot"),
        entry.exploitability_pct_pot,
    )?;
    check_file_ref(
        &format!("line {line}"),
        &FileRef { path: entry.flop_file.clone(), sha256: entry.sha256.clone() },
    )
}

fn check_runout(runout: &Runout) -> Result<(), LibraryError> {
    let name = format!("runout {}{}", runout.turn, runout.river);
    rule(is_card(&runout.turn) && is_card(&runout.river), || {
        format!("{name} does not name a turn and a river card")
    })?;
    for (line, file) in &runout.files {
        rule(is_line(line), || format!("{name} lists the malformed line {line:?}"))?;
        check_file_ref(&format!("{name} line {line}"), file)?;
    }
    Ok(())
}

fn check_file_ref(owner: &str, file: &FileRef) -> Result<(), LibraryError> {
    rule(!file.path.is_empty(), || format!("{owner} has an empty file path"))?;
    rule(is_sha256(&file.sha256), || format!("{owner} has a malformed sha256"))
}

/// `Ok` when no name repeats, else `Manifest` naming the first `what` listed twice. The
/// reader keys its routes by these names, so a repeat would leave a file unreachable.
fn listed_once<T: PartialEq + fmt::Display>(what: &str, names: &[T]) -> Result<(), LibraryError> {
    match names.iter().enumerate().find(|(i, name)| names[..*i].contains(name)) {
        Some((_, name)) => {
            Err(LibraryError::Manifest(format!("{what} {name} is listed more than once")))
        }
        None => Ok(()),
    }
}

fn check_preflop_requires(m: &Manifest) -> Result<(), LibraryError> {
    rule(m.chunks.is_some(), || "a preflop manifest needs chunks".to_owned())?;
    rule(m.tree_hash.is_some(), || "a preflop manifest needs tree_hash".to_owned())?;
    if m.source == Source::Own {
        let settings = m.seed.is_some() && m.iterations.is_some();
        rule(settings && m.exploitability_pct_pot.is_some(), || {
            "an own preflop manifest needs seed, iterations and exploitability_pct_pot (O-131)"
                .to_owned()
        })?;
    }
    Ok(())
}

fn check_flop_build_requires(m: &Manifest) -> Result<(), LibraryError> {
    let present = [
        ("pair", m.pair.is_some()),
        ("flop", m.flop.is_some()),
        ("flop_weight", m.flop_weight.is_some()),
        ("lines", m.lines.is_some()),
        ("runouts", m.runouts.is_some()),
    ];
    match present.iter().find(|(_, is_present)| !is_present) {
        Some((field, _)) => Err(LibraryError::Manifest(format!("a flop build needs {field}"))),
        None => Ok(()),
    }
}

/// `^[0-9a-f]{64}$`
fn is_sha256(s: &str) -> bool {
    s.len() == SHA256_HEX_DIGITS && s.bytes().all(is_lower_hex)
}

fn is_lower_hex(b: u8) -> bool {
    b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
}

/// `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, the manifest's `id`
/// pattern: a lowercase universally unique identifier (UUID). Shared with the tools that
/// build an id before they write a manifest.
#[must_use]
pub fn is_uuid(s: &str) -> bool {
    const HYPHENS: [usize; 4] = [8, 13, 18, 23];
    const UUID_LEN: usize = 36;
    s.len() == UUID_LEN
        && s.bytes().enumerate().all(
            |(i, b)| {
                if HYPHENS.contains(&i) { b == b'-' } else { is_lower_hex(b) }
            },
        )
}

/// `^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$`, the
/// manifest's `created_at` pattern and the node dump's `exported_at` pattern: a Coordinated
/// Universal Time (UTC) timestamp with an optional fraction of 1 to 9 digits. Shared with
/// the tools that check a timestamp before they write a manifest.
#[must_use]
pub fn is_timestamp(s: &str) -> bool {
    const TEMPLATE: &[u8] = b"0000-00-00T00:00:00";
    let bytes = s.as_bytes();
    let Some((head, tail)) = bytes.split_at_checked(TEMPLATE.len()) else {
        return false;
    };
    let head_ok = head
        .iter()
        .zip(TEMPLATE)
        .all(|(b, t)| if *t == b'0' { b.is_ascii_digit() } else { b == t });
    let tail_ok = match tail {
        [b'Z'] => true,
        [b'.', fraction @ .., b'Z'] => {
            (1..=MAX_FRACTION_DIGITS).contains(&fraction.len())
                && fraction.iter().all(u8::is_ascii_digit)
        }
        _ => false,
    };
    head_ok && tail_ok
}

/// `^[2-9TJQKA][cdhs]$`
fn is_card(s: &str) -> bool {
    matches!(s.as_bytes(), [rank, suit] if RANKS.contains(rank) && SUITS.contains(suit))
}

/// `^([2-9TJQKA][cdhs]){3}$`, with the three cards distinct and in the written order of
/// `gto_model::Flop` (rank descending, then suit ascending). `Flop::from_str` accepts any
/// order, but the reader routes a key by comparing the manifest's text with the key's
/// `Flop` display, so only the written order is routable.
fn is_flop(s: &str) -> bool {
    const FLOP_LEN: usize = 6;
    s.len() == FLOP_LEN
        && s.is_ascii()
        && (0..FLOP_LEN).step_by(2).all(|i| is_card(&s[i..i + 2]))
        && s.parse::<gto_model::Flop>().is_ok_and(|flop| flop.to_string() == s)
}

/// `^[a-z][0-9]*(\.[a-z][0-9]*)*$`
fn is_line(s: &str) -> bool {
    s.split('.').all(|token| match token.as_bytes() {
        [letter, digits @ ..] => {
            letter.is_ascii_lowercase() && digits.iter().all(u8::is_ascii_digit)
        }
        [] => false,
    })
}

/// `^chunks/[0-9]{4}\.bin\.zst$`
fn is_chunk_path(s: &str) -> bool {
    const SEQUENCE_DIGITS: usize = 4;
    s.strip_prefix("chunks/")
        .and_then(|rest| rest.strip_suffix(".bin.zst"))
        .is_some_and(|n| n.len() == SEQUENCE_DIGITS && n.bytes().all(|b| b.is_ascii_digit()))
}

/// `^cfg_[2-9]_(online|live)(_[a-z0-9]+)?_[0-9]+(cbb)?(_straddle)?(_ante[0-9]+)?$`, the
/// `gto_model::GameConfig::config_id` grammar (O-132): peel the optional ante and straddle
/// segments off the end, then the depth, then at most one stake slug.
fn is_config_id(s: &str) -> bool {
    let segments: Vec<&str> = s.split('_').collect();
    let [prefix, table, format, rest @ ..] = segments.as_slice() else {
        return false;
    };
    let head_ok = *prefix == "cfg"
        && matches!(table.as_bytes(), [b'2'..=b'9'])
        && matches!(*format, "online" | "live");
    let rest = match rest {
        [before @ .., last] if last.strip_prefix("ante").is_some_and(is_digits) => before,
        all => all,
    };
    let rest = match rest {
        [before @ .., "straddle"] => before,
        all => all,
    };
    let body_ok = match rest {
        [depth] => is_depth(depth),
        [slug, depth] => is_slug(slug) && is_depth(depth),
        _ => false,
    };
    head_ok && body_ok
}

fn is_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

fn is_depth(s: &str) -> bool {
    is_digits(s.strip_suffix("cbb").unwrap_or(s))
}

fn is_slug(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::{is_chunk_path, is_config_id, is_flop, is_line, is_timestamp, is_uuid};

    #[test]
    fn r2_7_config_id_matcher_follows_the_gto_model_grammar() {
        let accepted = [
            "cfg_6_online_100",
            "cfg_9_live_13_150",
            "cfg_9_live_25_300_straddle",
            "cfg_6_online_100_ante25",
            "cfg_9_live_13_1250cbb_straddle_ante50",
        ];
        let rejected = [
            "cfg_1_online_100",
            "cfg_6_web_100",
            "cfg_6_online",
            "cfg_6_online_100_ante",
            "cfg_6_online_100_ante5_straddle",
            "cfg_9_live_13_25_150",
            "cfg_6_online__100",
            "cfg_6_online_100cbbx",
        ];
        for id in accepted {
            assert!(is_config_id(id), "{id} is accepted");
            assert!(gto_model::ConfigId::new(id).is_ok(), "{id} is a gto-model ConfigId");
        }
        for id in rejected {
            assert!(!is_config_id(id), "{id} is rejected");
        }
    }

    #[test]
    fn r2_7_catalog_config_ids_match_the_grammar() {
        for config in gto_model::v1_configs() {
            let id = config.config_id();
            assert!(is_config_id(id.as_str()), "{id} from the v1 catalog is accepted");
        }
    }

    #[test]
    fn r2_7_string_matchers_follow_their_schema_patterns() {
        assert!(is_uuid("a3c9e1f2-7b4d-4e6f-9a0b-2c3d4e5f6a7b"));
        assert!(!is_uuid("A3C9E1F2-7B4D-4E6F-9A0B-2C3D4E5F6A7B"));
        assert!(!is_uuid("a3c9e1f27b4d4e6f9a0b2c3d4e5f6a7b"));
        assert!(!is_uuid("a3c9e1f2-7b4d-4e6f-9a0b2-c3d4e5f6a7b") && !is_uuid(""));
        assert!(is_timestamp("2026-10-20T12:00:00Z"));
        assert!(is_timestamp("2026-10-20T12:00:00.5Z"));
        assert!(is_timestamp("2026-10-20T12:00:00.123456789Z"));
        assert!(!is_timestamp("2026-10-20T12:00:00.1234567890Z"));
        assert!(!is_timestamp("2026-10-20T12:00:00.Z"));
        assert!(!is_timestamp("2026-10-20T12:00:00+00:00"));
        assert!(!is_timestamp("2026-10-20 12:00:00Z"));
        assert!(!is_timestamp("2026-10-20T12:00:00") && !is_timestamp("Z"));
        assert!(is_line("r250.c") && is_line("x") && is_line("b33.r120.c"));
        assert!(!is_line("") && !is_line("r250.") && !is_line("R250") && !is_line("250"));
        assert!(is_chunk_path("chunks/0000.bin.zst") && is_chunk_path("chunks/9999.bin.zst"));
        assert!(!is_chunk_path("chunks/10000.bin.zst") && !is_chunk_path("chunks/000a.bin.zst"));
        assert!(is_flop("Ah7d2c"));
        assert!(!is_flop("AhAh2c") && !is_flop("ah7d2c") && !is_flop("Ah7d2"));
    }

    #[test]
    fn r2_7_flop_matcher_requires_canonical_card_order() {
        // The reader compares the manifest's flop byte for byte with a key's `Flop` display,
        // so only the written order (rank descending, then suit ascending) routes.
        assert!(is_flop("Ah7d2c") && is_flop("7c7d2s"));
        assert!(!is_flop("2c7dAh") && !is_flop("7dAh2c") && !is_flop("7d7c2s"));
    }
}
