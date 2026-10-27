//! The command line (R2.18, O-189, O-205): every form parses, and a malformed one is a
//! usage error naming what is wrong.

use std::ffi::OsString;
use std::path::PathBuf;

use library_builder::cli::{Command, parse};
use library_builder::error::BuilderError;

fn args(words: &[&str]) -> Vec<OsString> {
    words.iter().map(OsString::from).collect()
}

#[test]
fn r2_18_every_form_parses() {
    assert_eq!(parse(&args(&[])).expect("no argument"), Command::Run);
    assert_eq!(parse(&args(&["run"])).expect("run"), Command::Run);
    assert_eq!(parse(&args(&["--version"])).expect("version"), Command::Version);
    assert_eq!(parse(&args(&["plan"])).expect("plan"), Command::Plan);
    assert_eq!(parse(&args(&["verify"])).expect("verify"), Command::Verify { full: false });
    assert_eq!(
        parse(&args(&["verify", "--full"])).expect("verify --full"),
        Command::Verify { full: true }
    );
    assert_eq!(parse(&args(&["healthz"])).expect("healthz"), Command::Healthz);
    assert_eq!(parse(&args(&["--once"])).expect("once"), Command::Once { job: None });
    assert_eq!(
        parse(&args(&["--once", "--job", "0192f000-0000-7000-8000-000000000001"])).expect("job"),
        Command::Once { job: Some("0192f000-0000-7000-8000-000000000001".to_owned()) }
    );
    assert_eq!(
        parse(&args(&["--once", "--job-spec", "spec.json"])).expect("spec"),
        Command::OnceSpec { spec: PathBuf::from("spec.json"), summary_out: None }
    );
    assert_eq!(
        parse(&args(&["--once", "--job-spec", "spec.json", "--summary-out", "s.json"]))
            .expect("out"),
        Command::OnceSpec {
            spec: PathBuf::from("spec.json"),
            summary_out: Some(PathBuf::from("s.json"))
        }
    );
    assert_eq!(
        parse(&args(&["estimate", "--job-spec", "spec.json", "--out", "sweep.json"])).expect("est"),
        Command::Estimate {
            spec: PathBuf::from("spec.json"),
            out: Some(PathBuf::from("sweep.json"))
        }
    );
    assert_eq!(
        parse(&args(&[
            "bench-report",
            "--judged",
            "a.json",
            "--informational",
            "b.json",
            "--sweep",
            "c.json",
            "--out",
            "reports"
        ]))
        .expect("bench-report"),
        Command::BenchReport {
            judged: PathBuf::from("a.json"),
            informational: Some(PathBuf::from("b.json")),
            sweep: Some(PathBuf::from("c.json")),
            out: PathBuf::from("reports"),
        }
    );
}

#[test]
fn r2_18_malformed_forms_are_usage_errors() {
    for words in [
        &["bogus"][..],
        &["--once", "--job"],
        &["--once", "--job", "a", "--job-spec", "b"],
        &["--once", "--surprise"],
        &["estimate"],
        &["estimate", "--out", "x"],
        &["bench-report", "--judged", "a.json"],
        &["plan", "extra"],
        &["verify", "--fast"],
        &["verify", "--full", "--full"],
        &["--version", "extra"],
    ] {
        match parse(&args(words)) {
            Err(BuilderError::Usage(message)) => assert!(!message.is_empty(), "{words:?}"),
            other => panic!("{words:?} parsed as {other:?}"),
        }
    }
}
