//! The tree files a flop build's manifest may list (R2.7, A3 section 2): each file path
//! is held to the one shape the writer produces for it, relative to the solution directory,
//! so a manifest cannot point a line at another line's file, at a file outside the build or
//! at a name the reader would never route to.
//!
//! - a line's `flop_file` is `flop/<line>.bin.zst`;
//! - a runout's file for a line is `runouts/<turn><river>/<line>.bin.zst`;
//! - a turn root's `path` is `turn-roots/<line>.bin.zst`, the path A3 reserves (O-15).
//!
//! The line, turn and river are checked against their own patterns first, so the expected
//! path is built from values that are already well formed.

use crate::error::LibraryError;
use crate::manifest::{FileRef, LineEntry, Runout, TREE_FILE_SUFFIX, TurnRoot};

use super::{is_line, is_sha256, rule};

/// The directory of the flop trees, one per preflop line.
const FLOP_DIR: &str = "flop";
/// The directory of the runout trees, one subdirectory per turn and river.
const RUNOUTS_DIR: &str = "runouts";
/// The directory A3 reserves for the turn-rooted trees (O-15).
const TURN_ROOTS_DIR: &str = "turn-roots";

/// `flop/<line>.bin.zst`
fn flop_file_path(line: &str) -> String {
    format!("{FLOP_DIR}/{line}{TREE_FILE_SUFFIX}")
}

/// `runouts/<turn><river>/<line>.bin.zst`
fn runout_file_path(turn: &str, river: &str, line: &str) -> String {
    format!("{RUNOUTS_DIR}/{turn}{river}/{line}{TREE_FILE_SUFFIX}")
}

/// `turn-roots/<line>.bin.zst`
fn turn_root_path(line: &str) -> String {
    format!("{TURN_ROOTS_DIR}/{line}{TREE_FILE_SUFFIX}")
}

/// A line's `flop_file` and `sha256`.
pub(super) fn check_flop_file(entry: &LineEntry) -> Result<(), LibraryError> {
    let line = &entry.line;
    let file = FileRef { path: entry.flop_file.clone(), sha256: entry.sha256.clone() };
    check_file_ref(&format!("line {line}"), "flop_file", &flop_file_path(line), &file)
}

/// One of a runout's files: the entry for `line`, whose own pattern is checked here too.
pub(super) fn check_runout_file(
    runout: &Runout,
    line: &str,
    file: &FileRef,
) -> Result<(), LibraryError> {
    let name = format!("runout {}{}", runout.turn, runout.river);
    rule(is_line(line), || format!("{name} lists the malformed line {line:?}"))?;
    let expected = runout_file_path(&runout.turn, &runout.river, line);
    check_file_ref(&format!("{name} line {line}"), "path", &expected, file)
}

/// A turn root's line, `path` and `sha256`.
pub(super) fn check_turn_root(root: &TurnRoot) -> Result<(), LibraryError> {
    let line = &root.line;
    rule(is_line(line), || format!("turn_roots line {line:?} is malformed"))?;
    let file = FileRef { path: root.path.clone(), sha256: root.sha256.clone() };
    check_file_ref(&format!("turn_roots line {line}"), "path", &turn_root_path(line), &file)
}

/// `Ok` when `file` lists `expected` as its path and a well-formed sha256; otherwise the
/// `Manifest` error names the owner, the field and the value, for example
/// `line r250.c flop_file "../x.bin.zst" is not "flop/r250.c.bin.zst"`.
fn check_file_ref(
    owner: &str,
    field: &str,
    expected: &str,
    file: &FileRef,
) -> Result<(), LibraryError> {
    rule(file.path == expected, || format!("{owner} {field} {:?} is not {expected:?}", file.path))?;
    rule(is_sha256(&file.sha256), || format!("{owner} has a malformed sha256"))
}

#[cfg(test)]
mod tests {
    use super::{check_file_ref, flop_file_path, runout_file_path, turn_root_path};
    use crate::error::LibraryError;
    use crate::manifest::FileRef;

    #[test]
    fn r2_7_tree_file_paths_follow_the_a3_layout() {
        assert_eq!(flop_file_path("r250.c"), "flop/r250.c.bin.zst");
        assert_eq!(runout_file_path("Kh", "9s", "r250.c"), "runouts/Kh9s/r250.c.bin.zst");
        assert_eq!(turn_root_path("r250.c"), "turn-roots/r250.c.bin.zst");
    }

    #[test]
    fn r2_7_file_ref_check_names_the_field_and_the_value() {
        let expected = flop_file_path("r250.c");
        let file = |path: &str| FileRef { path: path.to_owned(), sha256: "ab".repeat(32) };
        check_file_ref("line r250.c", "flop_file", &expected, &file(&expected))
            .expect("the writer's path validates");
        for bad in ["../x.bin.zst", "flop.bin.zst", "flop/r250.c.bin", "flop/r300.c.bin.zst"] {
            match check_file_ref("line r250.c", "flop_file", &expected, &file(bad)) {
                Err(LibraryError::Manifest(reason)) => {
                    assert!(reason.contains("flop_file") && reason.contains(bad), "{reason}");
                }
                other => panic!("{bad:?}: expected a Manifest error, got {other:?}"),
            }
        }
        let short = FileRef { path: expected.clone(), sha256: "ab".repeat(31) };
        assert!(check_file_ref("line r250.c", "flop_file", &expected, &short).is_err());
    }
}
