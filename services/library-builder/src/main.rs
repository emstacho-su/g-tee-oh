//! `library-builder`: maps a parsed command (`library_builder::cli`) to the library half of
//! the crate. With no argument it runs the claim loop and the operations surface;
//! `--version` prints the S01 line (O-189).
//!
//! Exit codes: 0 on success, 1 when the command ran and failed (a job that did not
//! publish, a spec run that did not stage, a bench report that misses O-50, a health
//! probe that did not get a 200), 2 for a usage error with [`USAGE`] on stderr. Every
//! error is printed to stderr; stdout carries only the command's JSON result, one line,
//! so a script can read it. Logs go to stderr through `tracing` (`RUST_LOG`, default
//! `info`).
//!
//! The commands that touch the database (`run`, `plan`, `verify`, `--once`) need
//! `BUILDER_DB_PASSWORD`; the ranges come from `BUILDER_RANGES_FIXTURE` until a preflop
//! solution is packed (O-181: `LibraryRanges` joins the chain then), and the planner's reach
//! is `PriorReach` for the same reason (ADR 0013 asks for equilibrium reach, which needs that
//! published preflop solution).

#![forbid(unsafe_code)]

use std::ffi::OsString;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Instant;

use gto_planner::PriorReach;
use library_builder::bench::{self, DEFAULT_MACHINE, REPORT_ID};
use library_builder::cli::{self, Command, USAGE};
use library_builder::config::Config;
use library_builder::error::BuilderError;
use library_builder::job::{self, Env, RunSummary};
use library_builder::ops::{self, OpsState, Status};
use library_builder::queue::JobQueue;
use library_builder::queue::pg::PgQueue;
use library_builder::ranges::{ChainRanges, FixtureRanges, RangeSource};
use library_builder::settings::BuilderSettings;
use library_builder::solve::EngineSolver;
use library_builder::spec::{self, OUTCOME_STAGED, SPEC_JOB_ID};
use library_builder::store::LibraryTarget;
use library_builder::{run, version_line};
use serde::Serialize;
use tokio::sync::watch;

/// Exit status for a usage error, the value shell conventions reserve for it.
const EXIT_USAGE: u8 = 2;

/// The variable naming the machine of the bench report (the validate tool's variable).
const MACHINE_VAR: &str = "VALIDATE_MACHINE";

/// The outcome `--once` prints for a job that published.
const OUTCOME_PUBLISHED: &str = "published";

/// The outcome a spec run reports when it did not stage.
const OUTCOME_FAILED: &str = "failed";

fn main() -> ExitCode {
    let args: Vec<OsString> = std::env::args_os().skip(1).collect();
    let command = match cli::parse(&args) {
        Ok(command) => command,
        Err(error) => {
            eprintln!("library-builder: {error}\n{USAGE}");
            return ExitCode::from(EXIT_USAGE);
        }
    };
    if command == Command::Version {
        println!("{}", version_line());
        return ExitCode::SUCCESS;
    }
    init_logging();
    match dispatch(command) {
        Ok(code) => code,
        Err(error) => {
            eprintln!("library-builder: {error}");
            ExitCode::FAILURE
        }
    }
}

/// Logs to stderr at `RUST_LOG`, `info` when unset. A second install (none happens) or a
/// bad filter is reported and the process goes on without logs.
fn init_logging() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    let installed =
        tracing_subscriber::fmt().with_env_filter(filter).with_writer(std::io::stderr).try_init();
    if let Err(error) = installed {
        eprintln!("library-builder: logging is off: {error}");
    }
}

/// Runs `command`: the synchronous ones directly, the rest on a multi-thread runtime.
fn dispatch(command: Command) -> Result<ExitCode, BuilderError> {
    match command {
        Command::Version => {
            println!("{}", version_line());
            Ok(ExitCode::SUCCESS)
        }
        Command::Healthz => healthz(),
        Command::Estimate { spec, out } => estimate(&spec, out.as_deref()),
        Command::BenchReport { judged, informational, sweep, out } => {
            bench_report(&judged, informational.as_deref(), sweep.as_deref(), &out)
        }
        Command::Run => block_on(run_service()),
        Command::Plan => block_on(plan()),
        Command::Verify { full } => block_on(verify(full)),
        Command::Once { job } => block_on(once(job)),
        Command::OnceSpec { spec, summary_out } => block_on(once_spec(spec, summary_out)),
    }
}

/// Runs `work` on a fresh multi-thread runtime.
fn block_on(
    work: impl Future<Output = Result<ExitCode, BuilderError>>,
) -> Result<ExitCode, BuilderError> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|source| BuilderError::Io { path: "the tokio runtime".to_owned(), source })?;
    runtime.block_on(work)
}

/// The environment's configuration; a malformed variable is named.
fn config() -> Result<Config, BuilderError> {
    Config::from_env().map_err(|error| BuilderError::Malformed {
        path: "environment".to_owned(),
        reason: error.to_string(),
    })
}

/// Prints `value` as one JSON line on stdout and, when `out` is given, writes it there too.
fn emit(value: &impl Serialize, out: Option<&Path>) -> Result<(), BuilderError> {
    let line = serde_json::to_string(value).map_err(|error| BuilderError::Malformed {
        path: "stdout".to_owned(),
        reason: error.to_string(),
    })?;
    println!("{line}");
    match out {
        Some(path) => std::fs::write(path, format!("{line}\n"))
            .map_err(|source| BuilderError::io(path, source)),
        None => Ok(()),
    }
}

/// Exit 0 when `ok`, 1 otherwise.
fn exit_code(ok: bool) -> ExitCode {
    if ok { ExitCode::SUCCESS } else { ExitCode::FAILURE }
}

/// `healthz`: probes `/healthz` at the configured bind's port on the loopback; 0 on a 200.
fn healthz() -> Result<ExitCode, BuilderError> {
    let bind = config()?.bind;
    match ops::probe(bind) {
        Ok(true) => Ok(ExitCode::SUCCESS),
        Ok(false) => {
            eprintln!(
                "library-builder healthz: /healthz on port {} did not answer 200",
                bind.port()
            );
            Ok(ExitCode::FAILURE)
        }
        Err(error) => {
            eprintln!("library-builder healthz: {error}");
            Ok(ExitCode::FAILURE)
        }
    }
}

/// `estimate --job-spec FILE [--out FILE]`: the O-194 sweep as one JSON line.
fn estimate(spec_path: &Path, out: Option<&Path>) -> Result<ExitCode, BuilderError> {
    let loaded = spec::load(spec_path)?;
    let sweep = spec::estimate_sweep(&loaded)?;
    emit(&sweep, out)?;
    Ok(ExitCode::SUCCESS)
}

/// `bench-report`: reads the summaries and the sweep, names the machine from
/// `VALIDATE_MACHINE` (default `zenbook`), the commit from `git rev-parse HEAD` and the date
/// now in UTC, and writes `bench-flop-line-<machine>.json` and `.md` into `out`. Exit 1 when
/// the judged run misses O-50: the files are written either way (O-178).
fn bench_report(
    judged: &Path,
    informational: Option<&Path>,
    sweep: Option<&Path>,
    out: &Path,
) -> Result<ExitCode, BuilderError> {
    let judged = bench::read_summary(judged)?;
    let informational = informational.map(bench::read_summary).transpose()?;
    let sweep = sweep.map(bench::read_sweep).transpose()?;
    let name = std::env::var(MACHINE_VAR).unwrap_or_else(|_| DEFAULT_MACHINE.to_owned());
    if !bench::is_machine_name(&name) {
        return Err(BuilderError::Malformed {
            path: MACHINE_VAR.to_owned(),
            reason: format!("{name:?} does not match ^[a-z][a-z0-9-]*$"),
        });
    }
    let report = bench::report_json(
        &judged,
        informational.as_ref(),
        sweep.as_ref(),
        &bench::machine(&name, &judged.machine),
        &git_head()?,
        &job::utc_now_rfc3339(),
    );
    let stem = format!("{REPORT_ID}-{name}");
    bench::write_report(out, &stem, &report)?;
    println!("{}", out.join(format!("{stem}.json")).display());
    Ok(exit_code(report["pass"].as_bool().unwrap_or(false)))
}

/// `git rev-parse HEAD`, checked to be 40 lowercase hexadecimal characters.
fn git_head() -> Result<String, BuilderError> {
    const WHAT: &str = "git rev-parse HEAD";
    let output = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .output()
        .map_err(|source| BuilderError::Io { path: WHAT.to_owned(), source })?;
    let commit = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    let hex = commit.len() == 40 && commit.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f'));
    if output.status.success() && hex {
        Ok(commit)
    } else {
        Err(BuilderError::Malformed {
            path: WHAT.to_owned(),
            reason: format!("{commit:?}: {}", String::from_utf8_lossy(&output.stderr).trim()),
        })
    }
}

/// The library target the configuration selects, `None` when none is.
fn target_of(config: &Config) -> Result<Option<LibraryTarget>, BuilderError> {
    if config.store.is_configured() {
        LibraryTarget::from_config(&config.store).map(Some)
    } else {
        Ok(None)
    }
}

/// The range chain (O-181): the fixture `BUILDER_RANGES_FIXTURE` names when set. With
/// none, every job fails with `MissingRanges` naming its line, which is the honest answer
/// before a preflop solution is packed.
fn ranges_of(config: &Config) -> Result<Arc<dyn RangeSource>, BuilderError> {
    let mut sources: Vec<Box<dyn RangeSource>> = Vec::new();
    if let Some(path) = &config.ranges_fixture {
        sources.push(Box::new(FixtureRanges::load(path)?));
    } else {
        tracing::warn!("BUILDER_RANGES_FIXTURE is unset: no line has ranges until a preflop pack");
    }
    Ok(Arc::new(ChainRanges::new(sources)))
}

/// The environment the database commands share; the database is required.
fn database_env(config: &Config) -> Result<Env<PgQueue>, BuilderError> {
    let database = config.database.as_ref().ok_or(BuilderError::DatabaseUnconfigured)?;
    Ok(Env {
        queue: Arc::new(PgQueue::connect_lazy(database)),
        solver: Arc::new(EngineSolver),
        target: target_of(config)?,
        ranges: ranges_of(config)?,
        reach: Arc::new(PriorReach),
        scratch_dir: config.scratch_dir.clone(),
        worker_id: library_builder::config::process_worker_id(&config.worker_id),
        builder_threads: config.threads,
        status: Arc::new(Status::default()),
        limits: config.limits,
    })
}

/// The default command: the operations surface and the claim loop until ctrl-c or
/// SIGTERM. Both stop on the same signal; if the surface cannot bind, the loop stops and
/// the bind error is returned.
async fn run_service() -> Result<ExitCode, BuilderError> {
    let config = config()?;
    let env = database_env(&config)?;
    tracing::info!(worker = %env.worker_id, bind = %config.bind, "starting {}", version_line());
    let (stop_tx, stop_rx) = watch::channel(false);
    let stop_tx = Arc::new(stop_tx);
    let signal_tx = Arc::clone(&stop_tx);
    tokio::spawn(async move {
        shutdown_signal().await;
        stop(&signal_tx);
    });
    let state = OpsState {
        status: Arc::clone(&env.status),
        database: Some(env.queue.pool().clone()),
        target: env.target.clone(),
        worker_id: env.worker_id.clone(),
    };
    let mut surface = tokio::spawn(ops::serve(config.bind, state, stopped(stop_rx.clone())));
    let looped = tokio::select! {
        result = run::run_loop(&env, stopped(stop_rx)) => result,
        joined = &mut surface => {
            stop(&stop_tx);
            return Err(surface_error(joined));
        }
    };
    stop(&stop_tx);
    if let Err(error) = joined_ok(surface.await) {
        tracing::error!(%error, "the operations surface stopped with an error");
    }
    looped.map(|()| ExitCode::SUCCESS)
}

/// Sends the stop; with every receiver gone there is nobody left to stop.
fn stop(sender: &watch::Sender<bool>) {
    if sender.send(true).is_err() {
        tracing::debug!("stop sent after every listener ended");
    }
}

/// The operations task's result as one `Result`.
fn joined_ok(
    joined: Result<Result<(), BuilderError>, tokio::task::JoinError>,
) -> Result<(), BuilderError> {
    joined.map_err(|error| BuilderError::Io {
        path: "the operations surface task".to_owned(),
        source: std::io::Error::other(error.to_string()),
    })?
}

/// Why the operations surface ended before the loop did.
fn surface_error(joined: Result<Result<(), BuilderError>, tokio::task::JoinError>) -> BuilderError {
    match joined_ok(joined) {
        Err(error) => error,
        Ok(()) => BuilderError::Io {
            path: "the operations surface".to_owned(),
            source: std::io::Error::other("stopped before the claim loop"),
        },
    }
}

/// Resolves once the stop flag is set or its sender is gone.
async fn stopped(mut receiver: watch::Receiver<bool>) {
    while !*receiver.borrow() {
        if receiver.changed().await.is_err() {
            return;
        }
    }
}

/// Resolves on ctrl-c, or on SIGTERM on Unix (the container's `docker stop`). A listener
/// that cannot be installed is logged and never resolves.
async fn shutdown_signal() {
    let interrupt = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::error!(%error, "cannot listen for ctrl-c");
            std::future::pending::<()>().await;
        }
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => {
                tracing::error!(%error, "cannot listen for SIGTERM");
                std::future::pending::<()>().await;
            }
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = interrupt => tracing::info!("ctrl-c received, stopping"),
        () = terminate => tracing::info!("SIGTERM received, stopping"),
    }
}

/// The settings in force now, with their errors logged.
async fn current_settings(env: &Env<PgQueue>) -> Result<BuilderSettings, BuilderError> {
    let rows = env.queue.settings().await?;
    let (settings, errors) = BuilderSettings::from_rows_with(&rows, &env.limits);
    for error in errors {
        tracing::warn!(key = %error.key, reason = %error.reason, "setting falls back to its default");
    }
    Ok(settings)
}

/// `plan`: one planner pass; prints what it wrote.
async fn plan() -> Result<ExitCode, BuilderError> {
    let env = database_env(&config()?)?;
    let settings = current_settings(&env).await?;
    let written = run::plan_once(&env, &settings).await?;
    emit(&written, None)?;
    Ok(ExitCode::SUCCESS)
}

/// `verify [--full]`: one verify pass (O-186); prints what it found. Without `--full` the
/// pass is the cheap one, and the build it reads in full is picked from the clock, so
/// repeated runs rotate over the builds. Exit 1 when a pass aborts (store unreachable,
/// nothing marked).
async fn verify(full: bool) -> Result<ExitCode, BuilderError> {
    let env = database_env(&config()?)?;
    let mode = if full {
        run::VerifyMode::Full
    } else {
        run::VerifyMode::Sampled { pass: job::now_epoch_seconds() }
    };
    let report = run::verify_once(&env, mode).await?;
    emit(&report, None)?;
    Ok(ExitCode::SUCCESS)
}

/// `--once [--job ID]`: one job in the foreground; exit 0 on a publish, 1 otherwise.
async fn once(job: Option<String>) -> Result<ExitCode, BuilderError> {
    let env = database_env(&config()?)?;
    let summary = run::run_once(&env, job.as_deref()).await?;
    emit(&summary, None)?;
    Ok(exit_code(summary.outcome == OUTCOME_PUBLISHED))
}

/// `--once --job-spec FILE [--summary-out FILE]` (O-205): one spec through the engine to
/// the configured target (`LIBRARY_ROOT` or S3), no database. The solve uses all
/// `BUILDER_THREADS`, not the `cpu_share` of the loop, since the benchmark measures the
/// machine. A run that fails still prints and writes its summary, outcome `failed`, so the
/// bench report records the miss (O-178); the exit code is then 1.
async fn once_spec(
    spec_path: PathBuf,
    summary_out: Option<PathBuf>,
) -> Result<ExitCode, BuilderError> {
    let started = Instant::now();
    let config = config()?;
    let loaded = spec::load(&spec_path)?;
    let target = LibraryTarget::from_config(&config.store)?;
    let run =
        spec::run_spec(&loaded, &target, &EngineSolver, &config.scratch_dir, config.threads).await;
    let summary = run.unwrap_or_else(|error| {
        tracing::error!(%error, "the job spec did not stage");
        RunSummary {
            job_id: SPEC_JOB_ID.to_owned(),
            build_id: Some(spec::build_id_of(&loaded.spec.id)),
            outcome: OUTCOME_FAILED.to_owned(),
            error: Some(error.to_string()),
            lines: Vec::new(),
            bytes_written: 0,
            memory: job::peak_memory(),
            machine: job::runtime_machine(),
            seconds: started.elapsed().as_secs_f64(),
        }
    });
    emit(&summary, summary_out.as_deref())?;
    Ok(exit_code(summary.outcome == OUTCOME_STAGED))
}
