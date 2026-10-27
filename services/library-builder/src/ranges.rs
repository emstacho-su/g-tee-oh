//! Where a line's flop ranges come from (O-181): [`FixtureRanges`] reads the hand-made
//! JSON file `BUILDER_RANGES_FIXTURE` names (validation/fixtures/builder/, O-83), before
//! the first preflop solution is packed; [`LibraryRanges`] derives them from the published
//! preflop solution once a configuration is packed: each seat's per-class reach at the
//! flop (`gto_planner::LibraryReach::line_classes`) spread over the class's combos. A
//! line neither covers fails its job with `BuilderError::MissingRanges`.
//!
//! Fixture format, `schema_version` 1:
//!
//! ```json
//! { "schema_version": 1, "id": "tiny-bb-btn-srp", "sources": [...],
//!   "config_id": "cfg_6_online_100",
//!   "lines": [ { "position_pair": "BB-BTN", "line": "r250.c",
//!                "oop": "<engine notation>", "ip": "<engine notation>" } ],
//!   "notes": [...] }
//! ```

use std::collections::BTreeMap;
use std::path::Path;

use gto_library::quantize::narrow_f32;
use gto_model::{ComboId, ConfigId, HandClass, PositionPair, parse_line};
use gto_planner::PlanError;
use gto_solve::postflop::Range;

use crate::error::BuilderError;

/// The fixture format this reader accepts.
pub const FIXTURE_SCHEMA_VERSION: u32 = 1;

/// Combos in a range.
const COMBO_COUNT: usize = ComboId::COUNT as usize;

/// A source of `[oop, ip]` ranges for a line.
pub trait RangeSource: Send + Sync {
    /// The ranges of `line` (dotted text, for example `r250.c`) of `pair` in `config_id`.
    ///
    /// # Errors
    ///
    /// `BuilderError::MissingRanges` when the source does not cover the line.
    fn ranges(&self, config_id: &str, pair: &str, line: &str) -> Result<[Range; 2], BuilderError>;
}

/// One line of a ranges fixture.
#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FixtureLine {
    /// The pair, for example `BB-BTN`.
    pub position_pair: String,
    /// The preflop line, for example `r250.c`.
    pub line: String,
    /// The out-of-position range in engine notation.
    pub oop: String,
    /// The in-position range in engine notation.
    pub ip: String,
}

/// A ranges fixture file.
#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FixtureFile {
    /// Always 1.
    pub schema_version: u32,
    /// The file stem.
    pub id: String,
    /// Citations, free form.
    pub sources: Vec<serde_json::Value>,
    /// The configuration every line belongs to.
    pub config_id: String,
    /// The lines.
    pub lines: Vec<FixtureLine>,
    /// Reader notes.
    #[serde(default)]
    pub notes: Vec<String>,
}

/// Ranges from a fixture file, parsed once at load.
#[derive(Clone, Debug)]
pub struct FixtureRanges {
    file: FixtureFile,
    parsed: BTreeMap<(String, String), [Range; 2]>,
}

impl FixtureRanges {
    /// Loads and checks the fixture at `path`: schema version 1, unique (pair, line), and
    /// every range parses.
    ///
    /// # Errors
    ///
    /// `BuilderError::Io` or `BuilderError::Malformed` naming the file.
    pub fn load(path: &Path) -> Result<FixtureRanges, BuilderError> {
        let text =
            std::fs::read_to_string(path).map_err(|source| BuilderError::io(path, source))?;
        let malformed =
            |reason: String| BuilderError::Malformed { path: path.display().to_string(), reason };
        let file: FixtureFile =
            serde_json::from_str(&text).map_err(|err| malformed(err.to_string()))?;
        if file.schema_version != FIXTURE_SCHEMA_VERSION {
            let found = file.schema_version;
            return Err(malformed(format!(
                "schema_version {found} is not {FIXTURE_SCHEMA_VERSION}"
            )));
        }
        let parsed = parse_lines(&file.lines).map_err(malformed)?;
        Ok(FixtureRanges { file, parsed })
    }

    /// The parsed file.
    #[must_use]
    pub fn file(&self) -> &FixtureFile {
        &self.file
    }
}

/// Each line's `[oop, ip]` ranges keyed by (pair, line), or why the lines are malformed: a
/// pair or line that does not parse, a (pair, line) listed twice, or a range the engine
/// cannot read.
fn parse_lines(lines: &[FixtureLine]) -> Result<BTreeMap<(String, String), [Range; 2]>, String> {
    let mut parsed = BTreeMap::new();
    for entry in lines {
        let place = format!("line {} of {}", entry.line, entry.position_pair);
        entry.position_pair.parse::<PositionPair>().map_err(|err| format!("{place}: {err}"))?;
        parse_line(&entry.line).map_err(|err| format!("{place}: {err}"))?;
        let key = (entry.position_pair.clone(), entry.line.clone());
        if parsed.contains_key(&key) {
            return Err(format!("{place} is listed more than once"));
        }
        let oop = Range::parse(&entry.oop).map_err(|err| format!("{place}, oop: {err}"))?;
        let ip = Range::parse(&entry.ip).map_err(|err| format!("{place}, ip: {err}"))?;
        parsed.insert(key, [oop, ip]);
    }
    Ok(parsed)
}

impl RangeSource for FixtureRanges {
    fn ranges(&self, config_id: &str, pair: &str, line: &str) -> Result<[Range; 2], BuilderError> {
        let found = (config_id == self.file.config_id)
            .then(|| self.parsed.get(&(pair.to_owned(), line.to_owned())))
            .flatten();
        found.cloned().ok_or_else(|| missing(config_id, pair, line))
    }
}

/// `BuilderError::MissingRanges` for one line.
fn missing(config_id: &str, pair: &str, line: &str) -> BuilderError {
    BuilderError::MissingRanges {
        config_id: config_id.to_owned(),
        pair: pair.to_owned(),
        line: line.to_owned(),
    }
}

/// Ranges from published preflop solutions.
pub struct LibraryRanges<S: gto_library::ObjectStore> {
    reach: gto_planner::LibraryReach<S>,
}

impl<S: gto_library::ObjectStore> LibraryRanges<S> {
    /// Wraps the planner's reach reader.
    #[must_use]
    pub fn new(reach: gto_planner::LibraryReach<S>) -> LibraryRanges<S> {
        LibraryRanges { reach }
    }
}

impl<S: gto_library::ObjectStore> RangeSource for LibraryRanges<S> {
    /// Each seat's per-class reach at the flop of the line, every combo of a class taking
    /// the class's reach as its weight.
    ///
    /// # Errors
    ///
    /// `BuilderError::MissingRanges` without a solution for the configuration and pair;
    /// `BuilderError::Model` for an identifier, pair or line that does not parse;
    /// `BuilderError::Plan` when the solution cannot be read or does not follow the line;
    /// `BuilderError::Solve` for a reach that is not a weight.
    fn ranges(&self, config_id: &str, pair: &str, line: &str) -> Result<[Range; 2], BuilderError> {
        let config: ConfigId = config_id.parse()?;
        let position_pair: PositionPair = pair.parse()?;
        let actions = parse_line(line)?;
        let [oop, ip] = match self.reach.action_classes(&config, position_pair, &actions) {
            Ok(classes) => classes,
            Err(PlanError::MissingReach { .. }) => return Err(missing(config_id, pair, line)),
            Err(other) => return Err(other.into()),
        };
        Ok([spread_over_combos(&oop)?, spread_over_combos(&ip)?])
    }
}

/// A range whose every combo weighs its class's reach (169 classes in `HandClass` order).
fn spread_over_combos(classes: &[f64]) -> Result<Range, BuilderError> {
    let mut weights = vec![0.0_f32; COMBO_COUNT];
    for (class, reach) in HandClass::all().zip(classes) {
        for combo in class.combos() {
            if let Some(slot) = weights.get_mut(usize::from(combo.index())) {
                *slot = narrow_f32(*reach);
            }
        }
    }
    Ok(Range::from_weights(&weights)?)
}

/// Tries each source in order and answers with the first that covers the line.
pub struct ChainRanges {
    sources: Vec<Box<dyn RangeSource>>,
}

impl ChainRanges {
    /// The sources, library first, fixture second (O-181).
    #[must_use]
    pub fn new(sources: Vec<Box<dyn RangeSource>>) -> ChainRanges {
        ChainRanges { sources }
    }
}

impl RangeSource for ChainRanges {
    /// The first source's ranges; a source answering `MissingRanges` passes the line to
    /// the next, and any other error is returned at once.
    fn ranges(&self, config_id: &str, pair: &str, line: &str) -> Result<[Range; 2], BuilderError> {
        for source in &self.sources {
            match source.ranges(config_id, pair, line) {
                Err(BuilderError::MissingRanges { .. }) => {}
                answered => return answered,
            }
        }
        Err(missing(config_id, pair, line))
    }
}

#[cfg(test)]
mod tests {
    use gto_library::{
        ChunkOptions, HandSpace, ManifestConfig, MemStore, Reader, ReaderOptions, SolutionMeta,
        SolvedHand, SolvedNode, Source, preflop_prefix, write_preflop,
    };
    use gto_model::{Cbb, GameConfig, NodeKey, v1_configs};
    use gto_planner::LibraryReach;
    use gto_tree::{PreflopTree, SizingConventionSpec};

    use super::*;

    const CONFIG: &str = "cfg_6_online_100";
    const PAIR: &str = "BB-BTN";
    const LINE: &str = "r250.c";

    const ONLINE_PLACEHOLDER: &str = r#"{
        "placeholder_for": "cfg_6_online_100", "open_bb": 2.5,
        "iso_rule": {"base_bb": 3.0, "per_limper_bb": 1.0},
        "threebet_ip": 3.0, "threebet_oop": 4.0, "fourbet": 2.2, "straddle_bb": null,
        "postflop": {"flop": [0.33, 0.75], "turn": [0.75], "river": [0.75]}
    }"#;

    fn fixture_text(schema_version: u32, pair: &str, oop: &str) -> String {
        serde_json::json!({
            "schema_version": schema_version, "id": "unit", "sources": [],
            "config_id": CONFIG,
            "lines": [{ "position_pair": pair, "line": LINE, "oop": oop, "ip": "AKs" }]
        })
        .to_string()
    }

    fn load_text(text: &str) -> Result<FixtureRanges, BuilderError> {
        let dir = tempfile::tempdir().expect("a scratch directory");
        let path = dir.path().join("unit.json");
        std::fs::write(&path, text).expect("writes");
        FixtureRanges::load(&path)
    }

    #[test]
    fn r2_18_a_fixture_answers_only_its_configuration() {
        let ranges = load_text(&fixture_text(1, PAIR, "QQ+")).expect("loads");
        assert_eq!(ranges.file().id, "unit");
        let [oop, ip] = ranges.ranges(CONFIG, PAIR, LINE).expect("covered");
        assert_eq!(oop.weights().iter().filter(|w| **w > 0.0).count(), 18);
        assert_eq!(ip.weights().iter().filter(|w| **w > 0.0).count(), 4);
        let other = ranges.ranges("cfg_6_online_150", PAIR, LINE);
        assert!(matches!(other, Err(BuilderError::MissingRanges { .. })), "{other:?}");
    }

    #[test]
    fn r2_18_a_malformed_fixture_says_why() {
        for (text, reason) in [
            (fixture_text(2, PAIR, "QQ+"), "schema_version 2"),
            (fixture_text(1, "BTN-BB", "QQ+"), "line r250.c of BTN-BB"),
            (fixture_text(1, PAIR, "QQ+,nonsense"), "oop"),
            ("{".to_owned(), "EOF"),
        ] {
            let result = load_text(&text);
            assert!(
                matches!(&result, Err(BuilderError::Malformed { reason: why, .. }) if why.contains(reason)),
                "{reason}: {:?}",
                result.err()
            );
        }
    }

    #[test]
    fn r2_18_an_unreadable_fixture_is_an_io_error() {
        let dir = tempfile::tempdir().expect("a scratch directory");
        let result = FixtureRanges::load(&dir.path().join("absent.json"));
        assert!(matches!(result, Err(BuilderError::Io { .. })), "{:?}", result.err());
    }

    /// A source with one fixed answer.
    enum Fixed {
        Absent,
        Aces,
        Broken,
    }

    impl RangeSource for Fixed {
        fn ranges(&self, _: &str, _: &str, _: &str) -> Result<[Range; 2], BuilderError> {
            match self {
                Fixed::Absent => Err(missing(CONFIG, PAIR, LINE)),
                Fixed::Aces => {
                    let aces = Range::parse("AA").expect("parses");
                    Ok([aces.clone(), aces])
                }
                Fixed::Broken => Err(BuilderError::Usage("broken".to_owned())),
            }
        }
    }

    #[test]
    fn r2_18_the_chain_moves_on_only_past_missing_ranges() {
        let chain = ChainRanges::new(vec![Box::new(Fixed::Absent), Box::new(Fixed::Aces)]);
        assert!(chain.ranges(CONFIG, PAIR, LINE).is_ok());
        let chain = ChainRanges::new(vec![Box::new(Fixed::Broken), Box::new(Fixed::Aces)]);
        assert!(matches!(chain.ranges(CONFIG, PAIR, LINE), Err(BuilderError::Usage(_))));
        let chain = ChainRanges::new(vec![Box::new(Fixed::Absent), Box::new(Fixed::Absent)]);
        let result = chain.ranges(CONFIG, PAIR, LINE);
        assert!(matches!(result, Err(BuilderError::MissingRanges { .. })), "{result:?}");
        let empty = ChainRanges::new(Vec::new()).ranges(CONFIG, PAIR, LINE);
        assert!(matches!(empty, Err(BuilderError::MissingRanges { .. })), "{empty:?}");
    }

    fn online_100() -> GameConfig {
        v1_configs()
            .into_iter()
            .find(|config| config.config_id().as_str() == CONFIG)
            .expect("the catalog")
    }

    /// A BB-BTN preflop solution in memory where every class plays every action of a
    /// node equally often.
    fn packed() -> (MemStore, String) {
        let config = online_100();
        let config_id = config.config_id();
        let pair: PositionPair = PAIR.parse().expect("a pair");
        let spec = SizingConventionSpec::from_json(ONLINE_PLACEHOLDER).expect("spec");
        let tree = PreflopTree::build(&spec, &config, pair).expect("a tree");
        let nodes: Vec<SolvedNode> = tree
            .nodes()
            .iter()
            .map(|node| SolvedNode {
                key: NodeKey::preflop(config_id.clone(), pair, node.line.clone()),
                to_act: node.actor,
                pot: node.pot,
                stacks: [Cbb(9_000), Cbb(9_000)],
                actions: node.actions.iter().map(|a| (*a, a.size().unwrap_or(Cbb(0)))).collect(),
                hand_space: HandSpace::Preflop169,
                hands: HandClass::all()
                    .map(|class| SolvedHand {
                        hand: u16::from(class.index()),
                        reach: None,
                        frequencies: vec![1.0; node.actions.len()],
                        ev_bb: vec![0.0; node.actions.len()],
                    })
                    .collect(),
                accuracy_pct_pot: None,
            })
            .collect();
        let meta = SolutionMeta {
            id: "0192f000-0000-7000-8000-000000000018".to_owned(),
            source: Source::Reference,
            engine_version: "unit".to_owned(),
            config: ManifestConfig {
                format: config.format,
                table_size: config.table_size,
                stake: config.stake.label.clone(),
                depth_cbb: config.depth_cbb,
                straddle: config.straddle,
                ante_cbb: config.ante_cbb,
            },
            config_id: config_id.clone(),
            pair,
            tree_hash: "00".repeat(32),
            seed: None,
            iterations: None,
            exploitability_pct_pot: None,
            synthetic: true,
            created_at: "2026-10-27T00:00:00Z".to_owned(),
        };
        let mut store = MemStore::new();
        write_preflop(&mut store, &meta, &nodes, &ChunkOptions::default()).expect("writes");
        (store, preflop_prefix(&config_id, &meta.id))
    }

    fn library_ranges() -> LibraryRanges<MemStore> {
        let (store, prefix) = packed();
        let reader = Reader::new(store, ReaderOptions::default());
        let config_id: ConfigId = CONFIG.parse().expect("an id");
        let pair: PositionPair = PAIR.parse().expect("a pair");
        LibraryRanges::new(LibraryReach::open(reader, &[(config_id, pair, prefix)]).expect("opens"))
    }

    #[test]
    fn r2_18_library_ranges_spread_class_reach_over_combos() {
        let ranges = library_ranges();
        let [oop, ip] = ranges.ranges(CONFIG, PAIR, LINE).expect("covered");
        for range in [&oop, &ip] {
            let first = range.weights()[0];
            assert!(first > 0.0 && first < 1.0, "{first}");
            assert!(range.weights().iter().all(|w| (*w - first).abs() < 1e-6));
        }
        let other = ranges.ranges("cfg_6_online_150", PAIR, LINE);
        assert!(matches!(other, Err(BuilderError::MissingRanges { .. })), "{other:?}");
        let bad = ranges.ranges(CONFIG, PAIR, "r250..c");
        assert!(matches!(bad, Err(BuilderError::Model(_))), "{bad:?}");
        let off_tree = ranges.ranges(CONFIG, PAIR, "r300.c");
        assert!(matches!(off_tree, Err(BuilderError::Plan(_))), "{off_tree:?}");
    }
}
