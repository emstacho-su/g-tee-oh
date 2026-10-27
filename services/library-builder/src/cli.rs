//! The command line, hand-rolled like `solver-query`'s (no parser dependency).

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::PathBuf;

use crate::error::BuilderError;

/// The usage line.
pub const USAGE: &str = "usage: library-builder [run | --version | plan | verify [--full] | healthz \
| --once [--job <uuid>] | --once --job-spec <file> [--summary-out <file>] \
| estimate --job-spec <file> [--out <file>] \
| bench-report --judged <summary> [--informational <summary>] [--sweep <file>] --out <dir>]";

/// A parsed command.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Command {
    /// The claim loop and the operations surface (the default with no argument).
    Run,
    /// Print the version line and exit (the R0.1 smoke test, O-189).
    Version,
    /// One planner pass.
    Plan,
    /// One verify pass (O-186).
    Verify {
        /// Read every build in full and check its sha256 (`--full`); else the cheap pass,
        /// existence and size of every object and one build read in full.
        full: bool,
    },
    /// Probe the running `/healthz` and exit 0 on a 200.
    Healthz,
    /// Claim and run one job in the foreground.
    Once {
        /// The job to claim, else the queue head.
        job: Option<String>,
    },
    /// Run one job spec without a database (O-205).
    OnceSpec {
        /// The spec.
        spec: PathBuf,
        /// Where to write the summary JSON, besides stdout.
        summary_out: Option<PathBuf>,
    },
    /// The estimate sweep of a spec (O-194).
    Estimate {
        /// The spec.
        spec: PathBuf,
        /// Where to write the sweep JSON, besides stdout.
        out: Option<PathBuf>,
    },
    /// Write the bench report from run summaries (O-190).
    BenchReport {
        /// The judged run's summary.
        judged: PathBuf,
        /// An informational run's summary.
        informational: Option<PathBuf>,
        /// The estimate sweep.
        sweep: Option<PathBuf>,
        /// The report directory.
        out: PathBuf,
    },
}

/// Parses the arguments after the program name.
///
/// # Errors
///
/// `BuilderError::Usage` naming what is wrong, with [`USAGE`].
pub fn parse(args: &[OsString]) -> Result<Command, BuilderError> {
    let words = args
        .iter()
        .map(|arg| {
            arg.to_str()
                .map(str::to_owned)
                .ok_or_else(|| usage(format!("argument {arg:?} is not valid Unicode")))
        })
        .collect::<Result<Vec<String>, BuilderError>>()?;
    let Some((first, rest)) = words.split_first() else {
        return Ok(Command::Run);
    };
    match first.as_str() {
        "run" => bare("run", rest, Command::Run),
        "--version" => bare("--version", rest, Command::Version),
        "plan" => bare("plan", rest, Command::Plan),
        "verify" => parse_verify(rest),
        "healthz" => bare("healthz", rest, Command::Healthz),
        "--once" => parse_once(rest),
        "estimate" => parse_estimate(rest),
        "bench-report" => parse_bench_report(rest),
        other => Err(usage(format!("unknown command {other:?}"))),
    }
}

/// The flags of `--once`.
const ONCE_FLAGS: [&str; 3] = [JOB_FLAG, JOB_SPEC_FLAG, SUMMARY_OUT_FLAG];
const JOB_FLAG: &str = "--job";
const JOB_SPEC_FLAG: &str = "--job-spec";
const SUMMARY_OUT_FLAG: &str = "--summary-out";
const OUT_FLAG: &str = "--out";
const JUDGED_FLAG: &str = "--judged";
const INFORMATIONAL_FLAG: &str = "--informational";
const SWEEP_FLAG: &str = "--sweep";
const FULL_FLAG: &str = "--full";

/// The length of a job id in its hyphenated form, and where its hyphens sit.
const UUID_LEN: usize = 36;
const UUID_HYPHENS: [usize; 4] = [8, 13, 18, 23];

/// A usage error carrying `message`.
fn usage(message: String) -> BuilderError {
    BuilderError::Usage(message)
}

/// `command` when nothing follows it.
fn bare(name: &str, rest: &[String], command: Command) -> Result<Command, BuilderError> {
    if rest.is_empty() {
        Ok(command)
    } else {
        Err(usage(format!("{name} takes no arguments, got {rest:?}")))
    }
}

/// `--flag value` pairs after `command`, each flag one of `allowed` and given at most
/// once, each value present and not itself a flag.
fn flags(
    command: &str,
    rest: &[String],
    allowed: &[&'static str],
) -> Result<BTreeMap<&'static str, String>, BuilderError> {
    let mut values = BTreeMap::new();
    let mut words = rest.iter();
    while let Some(word) = words.next() {
        let Some(flag) = allowed.iter().copied().find(|flag| flag == word) else {
            return Err(usage(format!("{command} does not take {word:?}")));
        };
        let value = match words.next() {
            Some(value) if !value.starts_with("--") => value.clone(),
            _ => return Err(usage(format!("{command} {flag} needs a value"))),
        };
        if values.insert(flag, value).is_some() {
            return Err(usage(format!("{command} {flag} is given twice")));
        }
    }
    Ok(values)
}

/// A required flag's value.
fn required(
    command: &str,
    values: &BTreeMap<&'static str, String>,
    flag: &str,
) -> Result<PathBuf, BuilderError> {
    values
        .get(flag)
        .map(PathBuf::from)
        .ok_or_else(|| usage(format!("{command} needs {flag} <file>")))
}

/// `verify [--full]`.
fn parse_verify(rest: &[String]) -> Result<Command, BuilderError> {
    match rest {
        [] => Ok(Command::Verify { full: false }),
        [flag] if flag == FULL_FLAG => Ok(Command::Verify { full: true }),
        _ => Err(usage(format!("verify takes only {FULL_FLAG}, got {rest:?}"))),
    }
}

/// `--once [--job <uuid>]` or `--once --job-spec <file> [--summary-out <file>]`.
fn parse_once(rest: &[String]) -> Result<Command, BuilderError> {
    let values = flags("--once", rest, &ONCE_FLAGS)?;
    match (values.get(JOB_FLAG), values.get(JOB_SPEC_FLAG)) {
        (Some(_), Some(_)) => {
            Err(usage(format!("--once takes {JOB_FLAG} or {JOB_SPEC_FLAG}, not both")))
        }
        (_, Some(spec)) => Ok(Command::OnceSpec {
            spec: PathBuf::from(spec),
            summary_out: values.get(SUMMARY_OUT_FLAG).map(PathBuf::from),
        }),
        (job, None) => {
            if values.contains_key(SUMMARY_OUT_FLAG) {
                return Err(usage(format!("{SUMMARY_OUT_FLAG} goes with {JOB_SPEC_FLAG}")));
            }
            match job {
                Some(id) if !is_uuid(id) => {
                    Err(usage(format!("{JOB_FLAG} {id:?} is not a job id (a UUID)")))
                }
                _ => Ok(Command::Once { job: job.cloned() }),
            }
        }
    }
}

/// True for the hyphenated 8-4-4-4-12 hexadecimal form.
fn is_uuid(text: &str) -> bool {
    text.len() == UUID_LEN
        && text.char_indices().all(|(index, c)| {
            if UUID_HYPHENS.contains(&index) { c == '-' } else { c.is_ascii_hexdigit() }
        })
}

/// `estimate --job-spec <file> [--out <file>]`.
fn parse_estimate(rest: &[String]) -> Result<Command, BuilderError> {
    let values = flags("estimate", rest, &[JOB_SPEC_FLAG, OUT_FLAG])?;
    Ok(Command::Estimate {
        spec: required("estimate", &values, JOB_SPEC_FLAG)?,
        out: values.get(OUT_FLAG).map(PathBuf::from),
    })
}

/// `bench-report --judged <summary> [--informational <summary>] [--sweep <file>] --out <dir>`.
fn parse_bench_report(rest: &[String]) -> Result<Command, BuilderError> {
    let command = "bench-report";
    let values = flags(command, rest, &[JUDGED_FLAG, INFORMATIONAL_FLAG, SWEEP_FLAG, OUT_FLAG])?;
    Ok(Command::BenchReport {
        judged: required(command, &values, JUDGED_FLAG)?,
        informational: values.get(INFORMATIONAL_FLAG).map(PathBuf::from),
        sweep: values.get(SWEEP_FLAG).map(PathBuf::from),
        out: required(command, &values, OUT_FLAG)?,
    })
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;

    use super::{Command, is_uuid, parse};
    use crate::error::BuilderError;

    fn words(list: &[&str]) -> Vec<OsString> {
        list.iter().map(OsString::from).collect()
    }

    #[test]
    fn r2_18_usage_messages_name_the_problem() {
        let message = |list: &[&str]| match parse(&words(list)) {
            Err(BuilderError::Usage(message)) => message,
            other => panic!("{list:?} gave {other:?}"),
        };
        assert!(message(&["bogus"]).contains("bogus"));
        assert!(message(&["--once", "--job", "nope"]).contains("not a job id"));
        assert!(message(&["--once", "--summary-out", "x"]).contains("--job-spec"));
        assert!(message(&["estimate", "--job-spec", "a", "--job-spec", "b"]).contains("twice"));
        assert!(message(&["bench-report", "--out", "x"]).contains("--judged"));
        assert!(message(&["--once", "--job", "--job-spec"]).contains("needs a value"));
    }

    #[test]
    fn r2_18_job_ids_are_uuids() {
        assert!(is_uuid("0192f000-0000-7000-8000-000000000001"));
        assert!(!is_uuid("0192f000-0000-7000-8000-00000000000"));
        assert!(!is_uuid("0192f000x0000-7000-8000-000000000001"));
        assert_eq!(
            parse(&words(&["bench-report", "--judged", "a", "--out", "o"])).ok().map(|c| matches!(
                c,
                Command::BenchReport { informational: None, sweep: None, .. }
            )),
            Some(true)
        );
    }
}
