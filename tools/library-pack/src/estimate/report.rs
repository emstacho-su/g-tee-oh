//! The Markdown of the size estimate (R2.7, R-19): the method before the numbers, the
//! inputs, one table per tree kind, and the comparison with the planning figures of 02
//! section 5.2, 04 section 7 and O-51. Every number is printed with thousands separators
//! and every ratio by integer arithmetic, so the report is the same bytes for one seed.
//!
//! Lane M (manifest, schema, bench) owns this file.

use gto_library::{CHUNK_TARGET_BYTES, ZSTD_LEVEL};

use super::{EstimateRow, Scenario, ScenarioInputs, SizeEstimate};

/// 02 section 5.2: 1 to 10 MB compressed per runout, 3 MB assumed.
const PLANNED_RUNOUT_BYTES: usize = 3_000_000;
const PLANNED_RUNOUT_MIN_BYTES: usize = 1_000_000;
const PLANNED_RUNOUT_MAX_BYTES: usize = 10_000_000;
/// 04 section 7: 0.07 to 0.6 GB per preflop line over 1,755 flops, so 40 KB to 342 KB per
/// flop tree.
const PLANNED_FLOP_TREE_MIN_BYTES: usize = 40_000;
const PLANNED_FLOP_TREE_MAX_BYTES: usize = 342_000;
/// O-14 and O-51: one build is about 4 preflop lines with K = 20 runouts each, about
/// 250 MB, and about 650 GB of storage holds about 2,500 builds.
const LINES_PER_BUILD: usize = 4;
const RUNOUTS_PER_BUILD: usize = 20;
const PLANNED_BUILD_BYTES: usize = 250_000_000;
const STORAGE_BUDGET_BYTES: usize = 650_000_000_000;
const PLANNED_BUILDS: usize = 2_500;
const BYTES_PER_KIB: usize = 1024;

/// The whole report.
pub(super) fn markdown(e: &SizeEstimate) -> String {
    [
        header(e.seed),
        method(e.seed),
        inputs(&e.scenarios),
        table("Per runout", "one turn and river runout", &e.runout),
        table("Per flop tree", "one flop tree", &e.flop_tree),
        projection(e),
    ]
    .join("\n")
}

fn header(seed: u64) -> String {
    format!(
        "# Library size estimate (R2.7)\n\n\
         Synthetic data, not measured solver output. Written by `library-pack estimate --seed \
         {seed}`\nfrom seeded synthetic trees (O-57); S20 replaces these numbers with real bytes \
         (O-51).\n\nR IDs: R2.7, as planning input for R-19.\n"
    )
}

fn method(seed: u64) -> String {
    let frame_kib = CHUNK_TARGET_BYTES / BYTES_PER_KIB;
    format!(
        "## Method\n\n\
         1. `gto_library::synthetic_tree` builds one turn and river runout tree and one flop \
         tree per\n   scenario from seed {seed}; the configuration, seats, board, ranges, \
         frequencies and\n   expected values are drawn from that seed, and combos holding a \
         board card are left out.\n\
         2. `NodeRecord::from_solved` quantizes every node into the record the writer stores \
         (A3\n   section 4, O-130): per hand 4 bytes of reach, 4 of best expected value, 1 per \
         action of\n   strategy and 2 per action of loss, plus a 2-byte hand index when the node \
         holds fewer\n   hands than the space, so 8 + 3a bytes at a actions, 19 at 3 actions on a \
         board, against\n   the 3 bytes per action, 9 at 3 actions, that 02 section 5.2 assumed. \
         Raw bytes below are\n   these records before compression; S18 and S20 confirm the gap \
         on real solves.\n\
         3. `encode_file`, the chunk encoder `write_tree_file` calls, turns the records into \
         one file\n   at each setting: the writer's zstd level {ZSTD_LEVEL} with {frame_kib} KiB \
         frames, level 3 with\n   {frame_kib} KiB frames, and level {ZSTD_LEVEL} with 256 KiB \
         frames (O-129). File bytes are the\n   whole file, directory frame included. Each data \
         frame is compressed on its own, so bytes\n   grow linearly with nodes.\n\
         4. The synthetic reach and expected values are uniform random draws, which do not \
         compress,\n   so the ratios below are a floor for the format: a real solve's reach and \
         values vary\n   smoothly across hands and compress better, which is what S20 measures.\n"
    )
}

fn inputs(scenarios: &[ScenarioInputs]) -> String {
    let rows: Vec<String> = scenarios
        .iter()
        .map(|s| {
            format!(
                "| {} | {} | {} | {:.2} | {:.2} | {} to {} |\n",
                s.scenario.label(),
                commas(s.runout_nodes),
                commas(s.flop_tree_nodes),
                s.range_fraction,
                s.pure_share,
                s.actions.0,
                s.actions.1,
            )
        })
        .collect();
    format!(
        "## Scenarios\n\n\
         | Scenario | Runout nodes | Flop tree nodes | Range share | Pure share | Actions |\n\
         |---|---|---|---|---|---|\n{}",
        rows.concat()
    )
}

fn table(title: &str, what: &str, rows: &[EstimateRow]) -> String {
    let lines: Vec<String> = rows.iter().map(table_row).collect();
    format!(
        "## {title}\n\nBytes of {what} per scenario and setting; ratio is raw over file \
         bytes.\n\n\
         | Scenario | Level | Frame KiB | Nodes | Hands/node | Raw bytes | File bytes | Ratio \
         | Bytes/node |\n\
         |---|---|---|---|---|---|---|---|---|\n{}",
        lines.concat()
    )
}

fn table_row(row: &EstimateRow) -> String {
    format!(
        "| {} | {} | {} | {} | {} | {} | {} | {} | {} |\n",
        row.scenario.label(),
        row.zstd_level,
        row.target_bytes / BYTES_PER_KIB,
        commas(row.nodes),
        commas(per(row.hands, row.nodes)),
        commas(row.raw_bytes),
        commas(row.compressed_bytes),
        ratio(row.raw_bytes, row.compressed_bytes),
        commas(per(row.compressed_bytes, row.nodes)),
    )
}

fn projection(e: &SizeEstimate) -> String {
    let rows: Vec<String> =
        e.scenarios.iter().filter_map(|s| projection_row(e, s.scenario)).collect();
    format!(
        "## Against the planning figures (02 section 5.2, 04 section 7, O-51)\n\n\
         One build is {LINES_PER_BUILD} preflop lines, each a flop tree plus K = \
         {RUNOUTS_PER_BUILD} runouts (O-14, O-51), so\nbuild bytes are {LINES_PER_BUILD} x \
         (flop tree + {RUNOUTS_PER_BUILD} x runout) at the writer's setting. The plan assumed \
         {}\nper runout ({} to {}), about {} per build, {} to {} per flop tree\nand about {} \
         builds in {}.\n\n\
         | Scenario | Runout | Flop tree | Build | Builds in budget | Runout in plan | Flop \
         tree in plan |\n\
         |---|---|---|---|---|---|---|\n{}",
        commas(PLANNED_RUNOUT_BYTES),
        commas(PLANNED_RUNOUT_MIN_BYTES),
        commas(PLANNED_RUNOUT_MAX_BYTES),
        commas(PLANNED_BUILD_BYTES),
        commas(PLANNED_FLOP_TREE_MIN_BYTES),
        commas(PLANNED_FLOP_TREE_MAX_BYTES),
        commas(PLANNED_BUILDS),
        commas(STORAGE_BUDGET_BYTES),
        rows.concat(),
    )
}

/// One scenario's row at the writer's setting, or none when it lacks a measured tree.
fn projection_row(e: &SizeEstimate, scenario: Scenario) -> Option<String> {
    let runout = at_writer_setting(&e.runout, scenario)?;
    let flop_tree = at_writer_setting(&e.flop_tree, scenario)?;
    let build = LINES_PER_BUILD * (flop_tree + RUNOUTS_PER_BUILD * runout);
    Some(format!(
        "| {} | {} | {} | {} | {} | {} | {} |\n",
        scenario.label(),
        commas(runout),
        commas(flop_tree),
        commas(build),
        commas(per(STORAGE_BUDGET_BYTES, build)),
        in_range(runout, PLANNED_RUNOUT_MIN_BYTES, PLANNED_RUNOUT_MAX_BYTES),
        in_range(flop_tree, PLANNED_FLOP_TREE_MIN_BYTES, PLANNED_FLOP_TREE_MAX_BYTES),
    ))
}

/// The file bytes of `scenario` at the writer's setting, when it was measured.
fn at_writer_setting(rows: &[EstimateRow], scenario: Scenario) -> Option<usize> {
    rows.iter()
        .find(|row| {
            row.scenario == scenario
                && row.zstd_level == ZSTD_LEVEL
                && row.target_bytes == CHUNK_TARGET_BYTES
        })
        .map(|row| row.compressed_bytes)
}

fn in_range(value: usize, min: usize, max: usize) -> &'static str {
    if value < min {
        "below"
    } else if value > max {
        "above"
    } else {
        "yes"
    }
}

/// `total / count`, or 0 when there is nothing to divide by.
fn per(total: usize, count: usize) -> usize {
    total.checked_div(count).unwrap_or(0)
}

/// `numerator / denominator` to two decimals by integer arithmetic; `n/a` at a zero
/// denominator.
fn ratio(numerator: usize, denominator: usize) -> String {
    match (numerator * 100).checked_div(denominator) {
        Some(hundredths) => format!("{}.{:02}", hundredths / 100, hundredths % 100),
        None => "n/a".to_owned(),
    }
}

/// `n` with a comma every three digits.
fn commas(n: usize) -> String {
    let digits = n.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(ch);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{commas, in_range, per, ratio};

    #[test]
    fn r2_7_report_numbers_are_formatted_by_integer_arithmetic() {
        assert_eq!(commas(0), "0");
        assert_eq!(commas(999), "999");
        assert_eq!(commas(1_000), "1,000");
        assert_eq!(commas(650_000_000_000), "650,000,000,000");
        assert_eq!(ratio(22_000, 5_000), "4.40");
        assert_eq!(ratio(1, 3), "0.33");
        assert_eq!(ratio(5, 0), "n/a");
        assert_eq!(per(10, 4), 2);
        assert_eq!(per(10, 0), 0);
        assert_eq!(in_range(5, 1, 10), "yes");
        assert_eq!(in_range(0, 1, 10), "below");
        assert_eq!(in_range(11, 1, 10), "above");
    }
}
