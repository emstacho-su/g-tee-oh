//! The reader's file plan (R2.7, A3 sections 2 and 5): which files a solution's manifest
//! lists, with their checksums, and which file a node key routes to. Nothing here touches the
//! store; the reader in the parent module fetches and checks the files.
//!
//! Lane R (reader) owns this file.

use std::collections::BTreeMap;
use std::sync::Arc;

use gto_model::{NodeKey, Street};

use crate::chunk::FileDirectory;
use crate::error::LibraryError;
use crate::manifest::{Manifest, ManifestKind};

/// A solution's files and routes.
pub(super) type Planned = Result<(Vec<FileSlot>, Routes), LibraryError>;

/// One file of a solution: its store path, the sha256 and node count its manifest lists
/// (the count for a preflop chunk only), and its directory once the file has been checked.
/// The strings are `Arc`-shared so a clone handed out of the reader's lock allocates nothing.
#[derive(Clone, Debug)]
pub(super) struct FileSlot {
    pub(super) path: Arc<str>,
    pub(super) sha256: Arc<str>,
    pub(super) nodes: Option<u32>,
    pub(super) directory: Option<Arc<FileDirectory>>,
}

/// The files of one flop build runout, keyed by preflop line.
#[derive(Debug)]
pub(super) struct RunoutRoute {
    turn: String,
    river: String,
    files: BTreeMap<String, u32>,
}

/// How a key finds its file.
#[derive(Debug)]
pub(super) enum Routes {
    /// Every key hash of every chunk with its file index, sorted by hash.
    Preflop(Vec<(u64, u32)>),
    /// By street, flop, line and runout cards (the reader's module docs, point 2).
    FlopBuild { flop: Option<String>, lines: BTreeMap<String, u32>, runouts: Vec<RunoutRoute> },
}

/// The failure of a file at `path`: a `Decode` error gains the path as `Corrupt`.
pub(super) fn at_path(path: &str, err: LibraryError) -> LibraryError {
    match err {
        LibraryError::Decode(reason) => LibraryError::Corrupt { path: path.to_owned(), reason },
        other => other,
    }
}

/// `Corrupt` for the file at `path`.
pub(super) fn corrupt(path: &str, reason: impl Into<String>) -> LibraryError {
    LibraryError::Corrupt { path: path.to_owned(), reason: reason.into() }
}

/// A count or index as `u32`, or `Corrupt` naming `path`.
pub(super) fn index_u32(path: &str, n: usize) -> Result<u32, LibraryError> {
    u32::try_from(n).map_err(|_| corrupt(path, format!("{n} entries do not fit a u32 index")))
}

/// The files and routes of a solution from its manifest, before any file is fetched.
pub(super) fn plan_files(prefix: &str, m: &Manifest) -> Planned {
    let slot = |path: &str, sha256: &str, nodes| FileSlot {
        path: Arc::from(format!("{prefix}/{path}")),
        sha256: Arc::from(sha256),
        nodes,
        directory: None,
    };
    let missing = |field: &str| LibraryError::Manifest(format!("{prefix}: no {field} listed"));
    if m.kind == ManifestKind::Preflop {
        let chunks =
            m.chunks.as_ref().filter(|c| !c.is_empty()).ok_or_else(|| missing("chunks"))?;
        let files = chunks.iter().map(|c| slot(&c.path, &c.sha256, Some(c.node_count)));
        return Ok((files.collect(), Routes::Preflop(Vec::new())));
    }
    let mut files = Vec::new();
    let mut add = |file: FileSlot| {
        files.push(file);
        index_u32(prefix, files.len() - 1)
    };
    let mut lines = BTreeMap::new();
    for entry in m.lines.as_ref().filter(|l| !l.is_empty()).ok_or_else(|| missing("lines"))? {
        lines.insert(entry.line.clone(), add(slot(&entry.flop_file, &entry.sha256, None))?);
    }
    let mut runouts = Vec::new();
    for runout in m.runouts.iter().flatten() {
        let mut by_line = BTreeMap::new();
        for (line, file) in &runout.files {
            by_line.insert(line.clone(), add(slot(&file.path, &file.sha256, None))?);
        }
        let (turn, river) = (runout.turn.clone(), runout.river.clone());
        runouts.push(RunoutRoute { turn, river, files: by_line });
    }
    Ok((files, Routes::FlopBuild { flop: m.flop.clone(), lines, runouts }))
}

/// The file a key routes to, or `None` when the solution cannot hold the key.
pub(super) fn route(routes: &Routes, key: &NodeKey, hash: u64) -> Option<u32> {
    if let Routes::Preflop(index) = routes {
        let at = index.binary_search_by_key(&hash, |&(hash, _)| hash).ok()?;
        return Some(index[at].1);
    }
    let Routes::FlopBuild { flop, lines, runouts } = routes else { return None };
    let dealt = key.flop.as_ref()?.cards.to_string();
    if flop.as_deref() != Some(dealt.as_str()) {
        return None;
    }
    let line = key.line();
    let turn = key.turn.as_ref().map(|section| section.cards.to_string());
    let river = key.river.as_ref().map(|section| section.cards.to_string());
    let matches = |r: &&RunoutRoute| {
        Some(&r.turn) == turn.as_ref() && river.as_ref().is_none_or(|card| *card == r.river)
    };
    match key.street() {
        Street::Preflop => None,
        Street::Flop => lines.get(&line).copied(),
        Street::Turn | Street::River => {
            runouts.iter().filter(matches).find_map(|r| r.files.get(&line).copied())
        }
    }
}
