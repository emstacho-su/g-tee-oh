//! Library half of `validate`: the fixture loaders (R0.11), the toy-game gates G1 to G3
//! that solve through `gto-solve` and judge the fixtures (R2.4, R2.5, R2.6; 04 section
//! 6), the report envelope they write (`validation/reports/report.schema.json`), the
//! machine block of a report, the toolchain line the build script embeds and the equity
//! table fixture writer (R2.20). The binary in `main.rs` parses the command line and
//! calls into here, and the tests under `tests/` call the same functions, so each gate
//! has one code path.
//!
//! Layering (A1 section 2): this crate may solve, because it sits on top of `gto-solve`;
//! it names no engine type, since `gto-solve` keeps those behind `f64` figures.

#![forbid(unsafe_code)]

use std::path::{Path, PathBuf};

pub mod equity_fixture;
pub mod fixtures;
pub mod gates;
pub mod machine;
pub mod report;
pub mod toolchain;

/// The repository root, two levels above this crate's manifest. The tool runs from a
/// checkout, so the compile-time path is the one it reads fixtures from and writes
/// reports to unless `--out` says otherwise.
#[must_use]
pub fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}
