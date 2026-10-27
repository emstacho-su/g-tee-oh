//! `validate`: the operator tool that runs the public validation gates and writes their
//! reports (A2 section 6). Subcommands: `g1`, `g2` and `g3` run one toy-game gate
//! (R2.4, R2.5, R2.6), `gates` runs all three, `equity-table` writes the 169 by 169
//! preflop equity fixture (R2.20), and `g4` compares the engine against an oracle node
//! dump over the G4 spot list (R2.11): it solves every spot with the engine, or reads a
//! committed engine dump with `--engine`, and writes the `g4-oracle` report to `--out`,
//! which the Zenbook run points at the private repository (O-170). The command line is
//! parsed by `validate::cli`; the S29 `recompute` subcommand (O-60) lands later.
//!
//! Mechanism. Every writing command resolves the commit through `machine::resolve_commit`,
//! which first runs `git status --porcelain`: a dirty working tree is refused, naming the
//! first dirty path, unless `--allow-dirty` is given, and then every gate report's notes
//! end with the line "working tree dirty at run time" (the equity fixture has no notes
//! field, so `equity-table` prints that line to standard error instead). The gate
//! commands build the run context (machine block, commit, date, toolchain), then write
//! both report files per gate before the verdict is read, so a failed gate still leaves
//! its report. Exit codes: 0 when every gate passed, 1 when any gate failed, 2 on a usage
//! error, a refused dirty tree, or when a fixture, a dump, a solve, a probe or a report
//! write failed.

#![forbid(unsafe_code)]

use std::path::Path;
use std::process::ExitCode;
use std::time::SystemTime;

use library_pack::NodeDump;
use validate::cli::{ALLOW_DIRTY, Command, G4Options, G6aOptions, Options, USAGE, parse};
use validate::fixtures::g4_spots::{self, G4Spots};
use validate::gates::g4::{self, RunExtras};
use validate::gates::g4_engine::{self, SpotSolve};
use validate::gates::{self, Gate};
use validate::machine::{self, MACHINE_ENV, ResolvedCommit};
use validate::report::{self, Context, DIRTY_TREE_NOTE, REPORTS_RELATIVE_TO_REPO_ROOT, Report};

/// The binary's package name.
const BIN_NAME: &str = env!("CARGO_PKG_NAME");

/// The binary's package version.
const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Internal crates this binary links (A1 section 2), named so the edges are exercised;
/// library-pack is linked through the G4 gate and has no such constant.
const LINKS: &[&str] = &[gto_library::CRATE_NAME, gto_solve::CRATE_NAME, gto_tree::CRATE_NAME];

/// A gate failed its rule after every report was written.
const EXIT_GATE_FAILED: u8 = 1;

/// A usage error, a refused dirty tree, or a fixture, probe or write failure.
const EXIT_ERROR: u8 = 2;

/// Where `g4` writes its report unless `--out` says otherwise: never the committed
/// public reports, since the G4 report is private (O-170).
const G4_OUT_RELATIVE_TO_REPO_ROOT: &str = "target/gate-reports/g4";

/// How a `Dump` error names the engine dump this run solved, which has no path.
const ENGINE_DUMP_OF_THIS_RUN: &str = "the engine dump solved in this run";

fn main() -> ExitCode {
    let args: Result<Vec<String>, _> =
        std::env::args_os().skip(1).map(std::ffi::OsString::into_string).collect();
    let Ok(args) = args else {
        eprintln!("{BIN_NAME}: an argument is not valid Unicode");
        return ExitCode::from(EXIT_ERROR);
    };
    let invocation = match parse(&args) {
        Ok(invocation) => invocation,
        Err(message) => {
            eprintln!("{BIN_NAME}: {message}\n{USAGE}");
            return ExitCode::from(EXIT_ERROR);
        }
    };
    let options = &invocation.options;
    match invocation.command {
        Command::Version => {
            println!("{BIN_NAME} {VERSION} (links {})", LINKS.join(", "));
            ExitCode::SUCCESS
        }
        Command::Help => {
            println!("{USAGE}");
            ExitCode::SUCCESS
        }
        Command::Gates(gates) => verdict(run_gates(&gates, options)),
        Command::EquityTable => match run_equity_table(options) {
            Ok(()) => ExitCode::SUCCESS,
            Err(message) => fail(&message),
        },
        Command::G4(g4) => verdict(run_g4(&g4, options)),
        Command::G6a(g6a) => verdict(run_g6a(&g6a, options)),
        Command::G6aPack => match run_g6a_pack(options) {
            Ok(()) => ExitCode::SUCCESS,
            Err(message) => fail(&message),
        },
        Command::SpikePreflop => verdict(run_spike(options)),
    }
}

/// The committed equity table as the solver reads it (O-126).
fn equity_table(repo_root: &Path) -> Result<gto_solve::equity::EquityTable, String> {
    let path = repo_root.join(validate::equity_fixture::DEFAULT_PATH);
    let fixture = validate::equity_fixture::load(&path).map_err(|error| error.to_string())?;
    Ok(fixture.to_table())
}

/// Write a gate report's two files into `out_dir` and print the verdict line.
fn write_report(
    gate_report: &gates::GateReport,
    context: &Context,
    out_dir: &Path,
) -> Result<bool, String> {
    let envelope = Report::from_gate(gate_report, context);
    let json = out_dir.join(format!("{}.json", gate_report.report));
    let markdown = out_dir.join(format!("{}.md", gate_report.report));
    report::write_json(&envelope, &json).map_err(|error| error.to_string())?;
    report::write_markdown(&envelope, &markdown).map_err(|error| error.to_string())?;
    let verdict = if gate_report.pass { "pass" } else { "FAIL" };
    println!(
        "{BIN_NAME}: {} {verdict} ({}, {})",
        gate_report.report,
        json.display(),
        markdown.display()
    );
    Ok(gate_report.pass)
}

/// Run gate G6a (R2.19): solve the 15 depths, certify them, compare the committed library
/// and, when a local chart is named, the published chart (O-221).
fn run_g6a(g6a: &G6aOptions, options: &Options) -> Result<bool, String> {
    use validate::fixtures::g6a_chart::{CHART_ENV, Chart};
    use validate::gates::g6a;

    let repo_root = validate::repo_root();
    let context = run_context(&repo_root, options)?;
    let equity = equity_table(&repo_root)?;
    let chart_path = g6a.chart.clone().or_else(|| std::env::var_os(CHART_ENV).map(Into::into));
    let chart = match chart_path {
        Some(path) => Some(Chart::load(&path).map_err(|error| error.to_string())?),
        None => None,
    };
    let library_root = repo_root.join(g6a::LIBRARY_RELATIVE_TO_REPO_ROOT);
    let input = g6a::G6aInput {
        equity: &equity,
        library_root: &library_root,
        chart: chart.as_ref(),
        depths_bb: &g6a::DEPTHS_BB,
    };
    let gate_report = g6a::run(&input).map_err(|error| error.to_string())?;
    let out_dir =
        options.out.clone().unwrap_or_else(|| repo_root.join(REPORTS_RELATIVE_TO_REPO_ROOT));
    write_report(&gate_report, &context, &out_dir)
}

/// Solve push/fold at the 15 depths and pack them as the G6a library fixture (R2.19).
fn run_g6a_pack(options: &Options) -> Result<(), String> {
    use validate::gates::g6a;

    let repo_root = validate::repo_root();
    let equity = equity_table(&repo_root)?;
    let out_root =
        options.out.clone().unwrap_or_else(|| repo_root.join(g6a::LIBRARY_RELATIVE_TO_REPO_ROOT));
    let solutions =
        g6a::solve_depths(&equity, &g6a::DEPTHS_BB).map_err(|error| error.to_string())?;
    let prefixes =
        g6a::pack_library(&solutions, &out_root, VERSION).map_err(|error| error.to_string())?;
    for prefix in &prefixes {
        println!("{BIN_NAME}: packed {}", prefix.display());
    }
    Ok(())
}

/// Run the preflop spike (R2.21) and write `spike-preflop-<machine>`.
///
/// Inputs come from `spike::repo_root` (the `VALIDATE_REPO_ROOT` override inside the
/// spike image, O-228). Outside a git checkout the context is built from `--commit`
/// instead of `git status`. The caller's notes come from `SPIKE_CONTAINER` (the docker
/// run line, with `--memory 5g`) and `SPIKE_CONCURRENT` (other heavy work running). A
/// 100bb run that errors falls back to a labeled extrapolation, never a silent pass.
fn run_spike(options: &Options) -> Result<bool, String> {
    use validate::gates::g6a::DEPTHS_BB;
    use validate::spike;

    let repo_root = spike::repo_root();
    let context = if spike::is_git_checkout(&repo_root) {
        run_context(&repo_root, options)?
    } else {
        let commit = options.commit.as_deref().ok_or_else(|| {
            format!("{} is not a git checkout, so pass --commit <sha>", repo_root.display())
        })?;
        spike::context_without_git(options.machine.as_deref(), commit, options.allow_dirty)
            .map_err(|error| error.to_string())?
    };
    let container = std::env::var(spike::CONTAINER_ENV).ok();
    if !spike::records_container_limit(container.as_deref()) {
        eprintln!(
            "{BIN_NAME}: {} does not record a {} container run",
            spike::CONTAINER_ENV,
            spike::CONTAINER_LIMIT_FLAG
        );
    }
    let concurrent = std::env::var(spike::CONCURRENT_ENV).ok();
    let notes = spike::caller_notes(container.as_deref(), concurrent.as_deref());
    let equity = equity_table(&repo_root)?;
    let push_fold = spike::run_push_fold(&equity, &DEPTHS_BB).map_err(|error| error.to_string())?;
    let hu100 = spike::run_hu100(&equity).map_or_else(
        |error| {
            eprintln!("{BIN_NAME}: the 100bb run failed, extrapolating: {error}");
            spike::extrapolate_hu100(&push_fold, &format!("the 100bb run failed: {error}"))
        },
        spike::Hu100::Measured,
    );
    let gate_report = spike::report(&context.machine.name, &push_fold, &hu100, &notes);
    let out_dir =
        options.out.clone().unwrap_or_else(|| repo_root.join(REPORTS_RELATIVE_TO_REPO_ROOT));
    write_report(&gate_report, &context, &out_dir)
}

/// The exit code of a gate run: success, the gate failure code, or the error code.
fn verdict(result: Result<bool, String>) -> ExitCode {
    match result {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::from(EXIT_GATE_FAILED),
        Err(message) => fail(&message),
    }
}

/// Print `message` under the binary's name and hand back the error exit code.
fn fail(message: &str) -> ExitCode {
    eprintln!("{BIN_NAME}: {message}");
    ExitCode::from(EXIT_ERROR)
}

/// Run `gates`, write their reports, print one line per gate, and say whether all passed.
fn run_gates(gates: &[Gate], options: &Options) -> Result<bool, String> {
    let repo_root = validate::repo_root();
    let context = run_context(&repo_root, options)?;
    let out_dir =
        options.out.clone().unwrap_or_else(|| repo_root.join(REPORTS_RELATIVE_TO_REPO_ROOT));
    let written =
        gates::write_gate_reports(gates, &gates::fixtures_dir(&repo_root), &context, &out_dir)
            .map_err(|error| error.to_string())?;
    for report in &written {
        let verdict = if report.pass { "pass" } else { "FAIL" };
        println!(
            "{BIN_NAME}: {} {verdict} ({}, {})",
            report.gate.report_id(),
            report.json.display(),
            report.markdown.display()
        );
    }
    Ok(written.iter().all(|report| report.pass))
}

/// Run gate G4: load the spot list and the oracle dump, solve the spots with the engine
/// (or read a committed engine dump), write both report files, print the verdict line.
fn run_g4(g4: &G4Options, options: &Options) -> Result<bool, String> {
    let repo_root = validate::repo_root();
    let spots_path = g4.spots.clone().unwrap_or_else(|| repo_root.join(g4_spots::DEFAULT_PATH));
    let spots = G4Spots::load(&spots_path).map_err(|error| error.to_string())?;
    let context = run_context(&repo_root, options)?;
    let oracle = g4::load_dump(&g4.oracle).map_err(|error| error.to_string())?;
    let (engine, run) = match &g4.engine {
        Some(path) => {
            let loaded = g4::load_dump(path).map_err(|error| error.to_string())?;
            let inputs = vec![digest_line("Engine dump", path, &loaded.sha256)];
            (loaded.dump, RunExtras { inputs, ..RunExtras::default() })
        }
        None => engine_side(&spots, g4.write_engine.as_deref(), &context)?,
    };
    let inputs = [
        vec![
            format!("Spot list {}.", spots_path.display()),
            digest_line("Oracle dump", &g4.oracle, &oracle.sha256),
        ],
        run.inputs,
    ]
    .concat();
    let extras = RunExtras {
        report_id: g4.report_id.clone().unwrap_or_else(|| g4::REPORT_ID.to_owned()),
        inputs,
        ..run
    };
    let gate_report =
        g4::run_with(&spots, &engine, &oracle.dump, &extras).map_err(|error| error.to_string())?;
    let out_dir =
        options.out.clone().unwrap_or_else(|| repo_root.join(G4_OUT_RELATIVE_TO_REPO_ROOT));
    let envelope = Report::from_gate(&gate_report, &context);
    let json = out_dir.join(format!("{}.json", gate_report.report));
    let markdown = out_dir.join(format!("{}.md", gate_report.report));
    report::write_json(&envelope, &json).map_err(|error| error.to_string())?;
    report::write_markdown(&envelope, &markdown).map_err(|error| error.to_string())?;
    let verdict = if gate_report.pass { "pass" } else { "FAIL" };
    println!(
        "{BIN_NAME}: {} {verdict} ({}, {})",
        gate_report.report,
        json.display(),
        markdown.display()
    );
    Ok(gate_report.pass)
}

/// Solve every spot of the list with the engine, build and check the engine dump, write
/// it when a path is given, and hand back the dump with the run's part of the extras:
/// the engine mode line, the facts and the provenance line of the dump.
fn engine_side(
    spots: &G4Spots,
    write_engine: Option<&Path>,
    context: &Context,
) -> Result<(NodeDump, RunExtras), String> {
    let solves: Vec<SpotSolve> = spots
        .spots
        .iter()
        .map(|spot| {
            let sink = g4_engine::SpotProgress { spot: spot.id.clone() };
            let solve =
                g4_engine::solve_spot(spots, spot, &sink).map_err(|error| error.to_string())?;
            let facts = solve.facts();
            eprintln!(
                "{BIN_NAME}: g4 {}: {} after {} iterations in {:.1} s",
                spot.id, facts.stop_reason, facts.iterations, facts.seconds
            );
            Ok(solve)
        })
        .collect::<Result<_, String>>()?;
    let dump =
        g4_engine::engine_dump(spots, &solves, &context.date).map_err(|error| error.to_string())?;
    g4::check_dump(&dump, ENGINE_DUMP_OF_THIS_RUN).map_err(|error| error.to_string())?;
    let input = match write_engine {
        Some(path) => {
            let sha256 = g4_engine::write_dump(&dump, path).map_err(|error| error.to_string())?;
            digest_line("Engine dump", path, &sha256)
        }
        None => "Engine dump solved in this run, not written.".to_owned(),
    };
    let extras = RunExtras {
        engine_mode: solves.first().map(SpotSolve::mode_line),
        facts: solves.iter().map(SpotSolve::facts).collect(),
        inputs: vec![input],
        ..RunExtras::default()
    };
    Ok((dump, extras))
}

/// A notes line naming an input file and the SHA-256 digest of the bytes read or written.
fn digest_line(what: &str, path: &Path, sha256: &str) -> String {
    format!("{what} {} sha256 {sha256}.", path.display())
}

/// The commit for this run through the one resolution path, `machine::resolve_commit`
/// (the dirty-tree check included), with a warning on standard error when a dirty tree
/// was allowed.
fn resolve_commit(repo_root: &Path, options: &Options) -> Result<ResolvedCommit, String> {
    let resolved =
        machine::resolve_commit(repo_root, options.commit.as_deref(), options.allow_dirty)
            .map_err(|error| error.to_string())?;
    if resolved.tree_dirty {
        eprintln!("{BIN_NAME}: {DIRTY_TREE_NOTE} ({ALLOW_DIRTY})");
    }
    Ok(resolved)
}

/// The machine block, the commit, the date and the toolchain for this run.
fn run_context(repo_root: &Path, options: &Options) -> Result<Context, String> {
    let env = std::env::var(MACHINE_ENV).ok();
    let name =
        machine::machine_name(options.machine.as_deref(), env.as_deref(), machine::host_name)
            .map_err(|error| error.to_string())?;
    let machine = machine::detect(&name).map_err(|error| error.to_string())?;
    let ResolvedCommit { commit, tree_dirty } = resolve_commit(repo_root, options)?;
    let toolchain = machine::rustc_version().to_owned();
    let date = report::iso_8601_utc(SystemTime::now()).map_err(|error| error.to_string())?;
    Ok(Context { machine, commit, date, toolchain, tree_dirty })
}

/// Build the equity table, write the fixture, read it back and check that every number
/// survived the JSON round trip exactly, then print the elapsed time and the path.
fn run_equity_table(options: &Options) -> Result<(), String> {
    use validate::equity_fixture;

    let repo_root = validate::repo_root();
    let out = options.out.clone().unwrap_or_else(|| repo_root.join(equity_fixture::DEFAULT_PATH));
    let ResolvedCommit { commit, .. } = resolve_commit(&repo_root, options)?;
    let generated_at =
        report::iso_8601_utc(SystemTime::now()).map_err(|error| error.to_string())?;
    let started = std::time::Instant::now();
    let fixture = equity_fixture::build(&generated_at, &commit);
    let elapsed = started.elapsed();
    equity_fixture::write(&fixture, &out).map_err(|error| error.to_string())?;
    let reread = equity_fixture::load(&out).map_err(|error| error.to_string())?;
    if reread != fixture {
        return Err(format!("{} does not read back to the table written", out.display()));
    }
    println!(
        "{BIN_NAME}: equity table written to {} in {:.1} s at {commit}",
        out.display(),
        elapsed.as_secs_f64()
    );
    Ok(())
}
