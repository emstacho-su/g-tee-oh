//! R2.2: the stake constructors and the eleven-row v1 catalog mirror the database seed
//! exactly (O-112). The seed migration is the catalog of record until O-7 settles the
//! online rake set, so this test reads it from the repository and compares every value
//! the crate also holds, which stops the two catalogs drifting apart again. R2.2 is a
//! requirement identifier (R ID). Depths are centi-big-blinds (cbb); blinds and caps are
//! cents; the rake percent is in basis points (bp).
//!
//! The seed is read with plain string handling, no regular expressions. The stake rows
//! follow the `insert into stake (` line up to the line that ends in `;`, and the
//! configuration rows follow the `cfg (...) as (` line of the common table expression
//! (CTE) up to the `),` that closes it. Each row is a parenthesised, comma-separated list
//! of Structured Query Language (SQL) literals; a quoted literal may hold a comma (the 2/5
//! note does), so the fields are split by a scanner that tracks the quotes.

use std::fmt::Display;
use std::fs;
use std::path::Path;
use std::str::FromStr;

use gto_model::config::v1_configs;
use gto_model::types::{GameConfig, GameFormat, Stake};

/// The seed migration, relative to this crate's manifest directory.
const SEED_RELATIVE_PATH: &str = "../../db/migrations/20261020001100_seed_catalog.sql";

/// The line that opens the stake insert; its rows follow until a line ends in `;`.
const STAKE_INSERT_OPENER: &str = "insert into stake (";

/// The line that opens the configuration CTE; its rows follow until a line reads `),`.
const CONFIG_CTE_OPENER: &str = "cfg (id, format, table_size, stake_label, depth_cbb) as (";

/// Columns in a stake row: format, label, `bb_cents`, `rake_percent_bp`, `rake_cap_cents`,
/// `no_flop_no_drop`, note.
const STAKE_COLUMNS: usize = 7;

/// Columns in a configuration row: id, format, `table_size`, `stake_label`, `depth_cbb`.
const CONFIG_COLUMNS: usize = 5;

/// Catalog rows the seed inserts (R0.6, O-72).
const CONFIG_ROWS: usize = 11;

/// A `stake` row as both catalogs state it. The seed's note column is commentary and the
/// crate's small blind is not in the seed, so neither is compared.
#[derive(Debug, PartialEq, Eq)]
struct StakeRow {
    format: String,
    label: String,
    bb_cents: u32,
    rake_percent_bp: u16,
    rake_cap_cents: u32,
    no_flop_no_drop: bool,
}

/// A `game_config` row as both catalogs state it.
#[derive(Debug, PartialEq, Eq)]
struct ConfigRow {
    id: String,
    format: String,
    table_size: u8,
    stake_label: String,
    depth_cbb: u32,
}

/// The seed text, read from the repository checkout this crate sits in.
fn read_seed() -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(SEED_RELATIVE_PATH);
    fs::read_to_string(&path).unwrap_or_else(|err| panic!("cannot read {}: {err}", path.display()))
}

/// The value lists of one block of rows: every line after the first line that starts with
/// `opener`, up to and including the first line that `ends_block`, keeping the lines that
/// open a row with `(` and stripping each down to the text inside its parentheses.
fn row_lists(seed: &str, opener: &str, ends_block: fn(&str) -> bool) -> Vec<String> {
    let mut lines = seed.lines().map(str::trim);
    let has_opener = lines.any(|line| line.starts_with(opener));
    assert!(has_opener, "the seed has no line opening with {opener:?}");
    let mut rows = Vec::new();
    for line in lines {
        if let Some(list) = line.strip_prefix('(') {
            let inner = list
                .trim_end_matches([',', ';'])
                .strip_suffix(')')
                .unwrap_or_else(|| panic!("row {line:?} does not close its parenthesis"));
            rows.push(inner.to_owned());
        }
        if ends_block(line) {
            return rows;
        }
    }
    panic!("the block opening with {opener:?} never ends")
}

/// Splits a SQL value list on the commas outside single quotes, trims each piece and drops
/// a `::type` cast, so `'live'::game_format` reads `'live'` and `6::smallint` reads `6`.
fn sql_fields(list: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    for c in list.chars() {
        match c {
            '\'' => {
                quoted = !quoted;
                current.push(c);
            }
            ',' if !quoted => fields.push(std::mem::take(&mut current)),
            _ => current.push(c),
        }
    }
    fields.push(current);
    fields.iter().map(|field| strip_cast(field.trim()).to_owned()).collect()
}

/// The literal before a `::type` cast, or the whole text when there is none.
fn strip_cast(field: &str) -> &str {
    field.split_once("::").map_or(field, |(literal, _)| literal)
}

/// The text inside a single-quoted SQL literal.
fn unquote(field: &str) -> String {
    field
        .strip_prefix('\'')
        .and_then(|rest| rest.strip_suffix('\''))
        .unwrap_or_else(|| panic!("{field:?} is not a quoted SQL literal"))
        .to_owned()
}

/// A numeric SQL literal.
fn number<T: FromStr>(field: &str) -> T
where
    T::Err: Display,
{
    field.parse().unwrap_or_else(|err| panic!("{field:?} is not a number: {err}"))
}

/// A boolean SQL literal, `true` or `false`.
fn boolean(field: &str) -> bool {
    match field {
        "true" => true,
        "false" => false,
        other => panic!("{other:?} is not a SQL boolean"),
    }
}

/// The three stake rows in seed order.
fn seed_stakes(seed: &str) -> Vec<StakeRow> {
    row_lists(seed, STAKE_INSERT_OPENER, |line| line.ends_with(';'))
        .iter()
        .map(|list| {
            let fields = sql_fields(list);
            assert_eq!(fields.len(), STAKE_COLUMNS, "stake row {list:?}");
            StakeRow {
                format: unquote(&fields[0]),
                label: unquote(&fields[1]),
                bb_cents: number(&fields[2]),
                rake_percent_bp: number(&fields[3]),
                rake_cap_cents: number(&fields[4]),
                no_flop_no_drop: boolean(&fields[5]),
            }
        })
        .collect()
}

/// The eleven configuration rows in seed order.
fn seed_configs(seed: &str) -> Vec<ConfigRow> {
    row_lists(seed, CONFIG_CTE_OPENER, |line| line == "),")
        .iter()
        .map(|list| {
            let fields = sql_fields(list);
            assert_eq!(fields.len(), CONFIG_COLUMNS, "config row {list:?}");
            ConfigRow {
                id: unquote(&fields[0]),
                format: unquote(&fields[1]),
                table_size: number(&fields[2]),
                stake_label: unquote(&fields[3]),
                depth_cbb: number(&fields[4]),
            }
        })
        .collect()
}

/// The stake row the crate states for a stake at a format.
fn crate_stake(format: GameFormat, stake: &Stake) -> StakeRow {
    StakeRow {
        format: format.to_string(),
        label: stake.label.clone(),
        bb_cents: stake.bb_cents,
        rake_percent_bp: stake.rake.percent_bp,
        rake_cap_cents: stake.rake.cap_cents,
        no_flop_no_drop: stake.rake.no_flop_no_drop,
    }
}

/// The configuration row the crate states for a catalog configuration.
fn crate_config(config: &GameConfig) -> ConfigRow {
    ConfigRow {
        id: config.config_id().to_string(),
        format: config.format.to_string(),
        table_size: config.table_size.get(),
        stake_label: config.stake.label.clone(),
        depth_cbb: config.depth_cbb.get(),
    }
}

/// R2.2: every stake and every configuration the crate constructs equals the seed row it
/// mirrors, in the seed's order, and the stake of every catalog configuration is a seed
/// stake at that configuration's format (O-112).
#[test]
fn r2_2_catalog_matches_the_database_seed() {
    let seed = read_seed();

    let seed_stake_rows = seed_stakes(&seed);
    let crate_stake_rows = vec![
        crate_stake(GameFormat::Online, &Stake::online()),
        crate_stake(GameFormat::Live, &Stake::live_1_3()),
        crate_stake(GameFormat::Live, &Stake::live_2_5()),
    ];
    assert_eq!(seed_stake_rows, crate_stake_rows);

    let seed_config_rows = seed_configs(&seed);
    assert_eq!(seed_config_rows.len(), CONFIG_ROWS);
    let configs = v1_configs();
    let crate_config_rows: Vec<ConfigRow> = configs.iter().map(crate_config).collect();
    assert_eq!(seed_config_rows, crate_config_rows);

    for config in &configs {
        let row = crate_stake(config.format, &config.stake);
        assert!(seed_stake_rows.contains(&row), "{row:?} is not a seed stake");
    }
}

/// The quote-aware scanner keeps a comma inside a literal and drops a cast.
#[test]
fn r2_2_seed_scanner_splits_on_commas_outside_quotes() {
    let fields = sql_fields("('live', '2/5', 500::integer, true, 'cap unverified, O-2')");
    let expected = ["('live'", "'2/5'", "500", "true", "'cap unverified, O-2')"];
    assert_eq!(fields, expected);
    assert_eq!(unquote("'1/3'"), "1/3");
    assert_eq!(strip_cast("'online'::game_format"), "'online'");
    assert_eq!(number::<u8>("9"), 9);
    assert!(boolean("true") && !boolean("false"));
}
