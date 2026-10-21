//! The startup scan of `FIXTURE_LIBRARY_PATH` (O-144, plan C.7): the directory walk that
//! finds every manifest the registry indexes.
//!
//! Mechanism: `preflop/` is walked two levels down (`<config_id>/<solution_id>`) and
//! `builds/` four (`<config_id>/<pair>/<flop>/<build_id>`), each leaf being a candidate
//! prefix; the walk never goes deeper, so chunk and tree directories are never listed. Each
//! candidate's `manifest.json` is read through the store, so the path rules of `FsStore`
//! apply to the directory names, and parsed with `Manifest::from_json`. A directory without
//! a manifest is not a solution; a manifest that does not parse, names another kind than
//! its directory, carries an id other than its directory name, or names no configuration or
//! pair is logged at warn level and skipped. Listing failures stop the scan.

use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use gto_library::{FsStore, LibraryError, MANIFEST_FILE, Manifest, ManifestKind, ObjectStore};

use super::SolutionInfo;

/// The directory of preflop solutions: `preflop/<config_id>/<solution_id>`.
pub const PREFLOP_DIR: &str = "preflop";

/// The directory of flop builds: `builds/<config_id>/<pair>/<flop>/<build_id>`.
pub const BUILDS_DIR: &str = "builds";

/// Directory levels under `preflop/` down to a solution.
const PREFLOP_DEPTH: usize = 2;

/// Directory levels under `builds/` down to a build.
const BUILDS_DEPTH: usize = 4;

/// Every solution found under the store's root, in prefix order.
///
/// # Errors
///
/// `LibraryError::Io` when a directory cannot be listed.
pub(super) fn manifests(store: &FsStore) -> Result<Vec<(SolutionInfo, Manifest)>, LibraryError> {
    let layouts = [
        (PREFLOP_DIR, PREFLOP_DEPTH, ManifestKind::Preflop),
        (BUILDS_DIR, BUILDS_DEPTH, ManifestKind::FlopBuild),
    ];
    let mut found = Vec::new();
    for (top, depth, kind) in layouts {
        for prefix in candidate_prefixes(store.root(), top, depth)? {
            found.extend(read_manifest(store, &prefix, kind));
        }
    }
    Ok(found)
}

/// The directories exactly `depth` levels under `root/top`, as store prefixes, sorted; none
/// when `top` is absent.
fn candidate_prefixes(root: &Path, top: &str, depth: usize) -> Result<Vec<String>, LibraryError> {
    if !root.join(top).is_dir() {
        return Ok(Vec::new());
    }
    let mut prefixes = vec![top.to_owned()];
    for _ in 0..depth {
        let mut next = Vec::new();
        for prefix in &prefixes {
            next.extend(subdirectories(root, prefix)?);
        }
        prefixes = next;
    }
    prefixes.sort_unstable();
    Ok(prefixes)
}

/// The subdirectories of `root/prefix` as prefixes; a name that is not Unicode is skipped.
fn subdirectories(root: &Path, prefix: &str) -> Result<Vec<String>, LibraryError> {
    let io = |source| LibraryError::Io { path: prefix.to_owned(), source };
    let mut names = Vec::new();
    for entry in fs::read_dir(root.join(prefix)).map_err(io)? {
        let entry = entry.map_err(io)?;
        if !entry.path().is_dir() {
            continue;
        }
        match entry.file_name().into_string() {
            Ok(name) => names.push(format!("{prefix}/{name}")),
            Err(name) => {
                tracing::warn!(prefix, ?name, "a directory name is not Unicode; skipped");
            }
        }
    }
    Ok(names)
}

/// The solution at `prefix`, when its manifest reads, parses and fits the directory.
fn read_manifest(
    store: &FsStore,
    prefix: &str,
    kind: ManifestKind,
) -> Option<(SolutionInfo, Manifest)> {
    let path = format!("{prefix}/{MANIFEST_FILE}");
    let bytes = match store.get(&path) {
        Ok(bytes) => bytes,
        Err(LibraryError::Io { source, .. }) if source.kind() == ErrorKind::NotFound => {
            tracing::debug!(prefix, "no manifest; not a solution");
            return None;
        }
        Err(err) => {
            tracing::warn!(prefix, %err, "the manifest could not be read; skipped");
            return None;
        }
    };
    let manifest = match Manifest::from_json(&bytes) {
        Ok(manifest) => manifest,
        Err(err) => {
            tracing::warn!(prefix, %err, "the manifest does not parse; skipped");
            return None;
        }
    };
    let directory = prefix.rsplit('/').next().unwrap_or_default();
    let problem = if manifest.kind != kind {
        Some("names another kind than its directory")
    } else if manifest.id != directory {
        Some("carries an id other than its directory name")
    } else if manifest.config_id.is_none() || manifest.pair.is_none() {
        Some("names no configuration or pair")
    } else {
        None
    };
    if let Some(problem) = problem {
        tracing::warn!(prefix, "the manifest {problem}; skipped");
        return None;
    }
    let info = SolutionInfo {
        id: manifest.id.clone(),
        prefix: prefix.to_owned(),
        kind,
        source: manifest.source,
        synthetic: manifest.synthetic.unwrap_or(false),
        exploitability_pct_pot: manifest.exploitability_pct_pot,
    };
    Some((info, manifest))
}
