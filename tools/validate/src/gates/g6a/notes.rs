//! The notes of the G6a report (R2.19, O-221 to O-224): how the solutions were made,
//! the chart named with its parameters, and either every chart disagreement or the
//! pointer to the committed report when the chart is not available.

use gto_solve::preflop::{CERTIFICATE_GAIN_BB, SolvedPreflop};

use super::library::LibraryCheck;
use super::{Disagreement, NEAR_INDIFFERENT_BB, REPORT_ID, Side};
use crate::fixtures::g6a_chart::{CHART_ENV, Chart};

/// The chart gate G6a compares against, as published (O-221).
pub const CHART_NAME: &str =
    "HoldemResources.net heads-up push/fold Nash equilibrium chart, no-ante variant";

/// Where the chart is published.
pub const CHART_URL: &str = "https://www.holdemresources.net/hune";

/// The game the chart and the solver share.
pub const CHART_PARAMETERS: &str = "heads-up, small blind 0.5, big blind 1, no ante, no rake, \
                                    effective stack before blinds, push or fold";

/// A frequency this far inside (0, 1) counts as mixed in the notes.
const MIXED_MARGIN: f64 = 1e-12;

/// Everything the notes need.
pub struct NotesInput<'a> {
    pub solutions: &'a [SolvedPreflop],
    pub depths_bb: &'a [u32],
    pub library: &'a [LibraryCheck],
    pub chart: Option<&'a Chart>,
    pub disagreements: &'a [Disagreement],
}

/// The notes text, one fact per line.
pub fn text(input: &NotesInput<'_>) -> String {
    let mut lines = vec![format!(
        "Push/fold solved exactly per depth: CFR+ (alternating updates, linear averaging) over \
         the 169 classes with exact card removal finds the support, the mixed classes are \
         solved from their indifference equations by Gaussian elimination in f64, and an exact \
         best response certifies each seat's gain at or below {CERTIFICATE_GAIN_BB:e} bb \
         (O-223). EVs follow O-224: final stack minus the stack behind at the node, in bb."
    )];
    for ((depth, solution), check) in input.depths_bb.iter().zip(input.solutions).zip(input.library)
    {
        lines.push(depth_line(*depth, solution, check));
    }
    lines.push(format!(
        "Chart: {CHART_NAME}, {CHART_URL}; parameters: {CHART_PARAMETERS}. Its per-hand \
         thresholds are not redistributed: the site grants no reuse right (O-221), so the \
         transcription stays outside the repository, named by --chart or {CHART_ENV}."
    ));
    match input.chart {
        Some(chart) => lines.extend(chart_lines(chart, input.disagreements)),
        None => lines.push(format!(
            "No chart was given: the chart comparison run locally with the transcription is \
             recorded in the committed report validation/reports/{REPORT_ID}.json."
        )),
    }
    lines.join("\n")
}

/// One depth: iterations, gains, the mixed classes and the committed solution.
fn depth_line(depth: u32, solution: &SolvedPreflop, check: &LibraryCheck) -> String {
    let [bb_gain, btn_gain] = solution.gains_bb;
    let line = format!(
        "Depth {depth} bb: {} CFR+ iterations, gains BB {bb_gain:e} bb and BTN {btn_gain:e} bb, \
         mixed push [{}], mixed call [{}], committed {} ({} differences).",
        solution.iterations,
        mixed(solution, 0).join(", "),
        mixed(solution, 1).join(", "),
        check.prefix,
        check.differences.len()
    );
    [line].into_iter().chain(check.differences.iter().cloned()).collect::<Vec<_>>().join(" ")
}

/// The classes node `node` plays mixed, with their aggressive frequency.
fn mixed(solution: &SolvedPreflop, node: usize) -> Vec<String> {
    solution.nodes.get(node).map_or_else(Vec::new, |node| {
        node.hands
            .iter()
            .filter_map(|hand| {
                let aggressive = *hand.frequencies.get(1)?;
                let inside = aggressive > MIXED_MARGIN && aggressive < 1.0 - MIXED_MARGIN;
                inside.then(|| format!("{} {aggressive:.6}", hand.class))
            })
            .collect()
    })
}

/// The comparison lines: the summary, then every disagreement.
fn chart_lines(chart: &Chart, disagreements: &[Disagreement]) -> Vec<String> {
    let largest = disagreements.iter().map(|row| row.ev_gap_bb.abs()).fold(0.0, f64::max);
    let mut lines = vec![format!(
        "Chart comparison against \"{}\" ({}, retrieved {}): {} disagreements between the chart \
         and the solution's majority action (frequency at least 0.5 is in), the largest absolute \
         EV gap {largest:.6} bb; near-indifferent means at most {NEAR_INDIFFERENT_BB} bb (O-222).",
        chart.source,
        chart.url,
        chart.retrieved,
        disagreements.len()
    )];
    lines.extend(disagreements.iter().map(|row| {
        let side = match row.side {
            Side::Push => "push",
            Side::Call => "call",
        };
        format!(
            "Disagreement: depth {} bb, {} {side}, our frequency {:.6}, EV gap {:.6} bb.",
            row.depth_bb, row.hand, row.frequency, row.ev_gap_bb
        )
    }));
    lines
}
