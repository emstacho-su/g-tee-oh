//! The library registry (R2.13, O-144, plan C.7): the solutions `FIXTURE_LIBRARY_PATH`
//! holds, indexed once at startup, and the one `gto_library::Reader` every handler reads
//! through.
//!
//! Mechanism: `scan` walks `preflop/<config_id>/<solution_id>/manifest.json` and
//! `builds/<config_id>/<pair>/<flop>/<build_id>/manifest.json` under the root (the `scan`
//! submodule), parses each manifest with `Manifest::from_json`, and indexes the solution id
//! to its store prefix and each (configuration, pair) to its ids. A solution is opened on
//! first use through `Reader::open`, which checksums every chunk of a preflop solution and
//! parses its directory (A3 section 5); the reader keeps the handle, so a later open of the
//! same prefix is a lookup under its lock. A checksum mismatch or a file that does not
//! decode marks the solution unavailable in the reader: that request answers 503, every
//! later read of the solution is refused, and `stats` counts it. Nothing re-queues a build,
//! since the query role cannot write; that belongs to library-builder (S18). Only `FsStore`
//! exists in S16; the S3 (Simple Storage Service) adapter is deferred (O-144).
//!
//! The scan runs once; `/healthz`'s `fixture_library` block keeps its present-at-request
//! semantics (O-62). A cold `node` read does file input/output, so handlers call
//! `node_blocking`, which runs it on tokio's blocking pool (plan C.2 step 2).
//!
//! The integrator of S16 owns this file.

mod scan;

use std::collections::{BTreeMap, HashMap};
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use gto_library::{
    FsStore, LibraryError, Manifest, ManifestKind, NodeView, Reader, ReaderOptions, Source, is_uuid,
};
use gto_model::{ActionToken, ConfigId, NodeKey, PositionPair};

use crate::error::ApiError;

/// One indexed solution, as the deal and coverage handlers list it.
#[derive(Clone, Debug, PartialEq)]
pub struct SolutionInfo {
    /// The solution id, a lowercase universally unique identifier (UUID).
    pub id: String,
    /// The store prefix: `preflop/<config_id>/<id>` or `builds/<config_id>/<pair>/<flop>/<id>`.
    pub prefix: String,
    /// Preflop or flop build.
    pub kind: ManifestKind,
    /// Own or reference.
    pub source: Source,
    /// True for synthetic test data (O-57).
    pub synthetic: bool,
    /// The manifest's exploitability per seat in percent of the pot, when known (O-22).
    pub exploitability_pct_pot: Option<[f64; 2]>,
}

/// What `/healthz` and `/metrics` report about the registry and the reader's cache.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LibraryStats {
    /// How many solutions the startup scan indexed.
    pub indexed: u32,
    /// How many solutions the reader has marked unavailable since startup.
    pub unavailable: u32,
    /// The bytes of decoded frames the cache holds now.
    pub cache_used_bytes: u64,
    /// The cache budget.
    pub cache_bytes: u64,
}

/// One indexed solution with its manifest.
struct Indexed {
    info: SolutionInfo,
    manifest: Manifest,
}

/// The registry and the reader. `Send + Sync`: the reader keeps its state behind a mutex,
/// and the index never changes after the scan.
pub struct Library {
    solutions: BTreeMap<String, Indexed>,
    by_pair: HashMap<(ConfigId, PositionPair), Vec<String>>,
    reader: Option<Reader<FsStore>>,
    root: Option<PathBuf>,
    cache_bytes: u64,
}

impl Library {
    /// A library holding nothing and reading nothing, for a service without a fixture
    /// path and for the `openapi` subcommand.
    #[must_use]
    pub fn empty(cache_bytes: u64) -> Library {
        Library {
            solutions: BTreeMap::new(),
            by_pair: HashMap::new(),
            reader: None,
            root: None,
            cache_bytes,
        }
    }

    /// Scans `root` (see the module docs) and opens a reader over it with a cache of
    /// `cache_bytes`. A directory that holds no manifest is not a solution; a manifest that
    /// does not parse, names another kind than its directory, or carries no configuration
    /// or pair is logged and skipped, so one bad solution never hides the others.
    ///
    /// # Errors
    ///
    /// `LibraryError::Io` when `root` is not a directory or a directory under it cannot be
    /// listed.
    pub fn scan(root: &Path, cache_bytes: u64) -> Result<Library, LibraryError> {
        let store = FsStore::new(root)?;
        let found = scan::manifests(&store)?;
        let reader = Reader::new(store, ReaderOptions { cache_bytes });
        let root = Some(root.to_path_buf());
        let mut library = Library { reader: Some(reader), root, ..Library::empty(cache_bytes) };
        for (info, manifest) in found {
            library.index(info, manifest);
        }
        for ids in library.by_pair.values_mut() {
            ids.sort_unstable();
        }
        Ok(library)
    }

    /// Adds one scanned solution; a second manifest with an id already indexed is skipped.
    fn index(&mut self, info: SolutionInfo, manifest: Manifest) {
        if let Some(first) = self.solutions.get(&info.id) {
            tracing::warn!(
                id = %info.id,
                prefix = %info.prefix,
                indexed = %first.info.prefix,
                "a second manifest carries an indexed id; skipped"
            );
            return;
        }
        if let (Some(config_id), Some(pair)) = (manifest.config_id.clone(), manifest.pair) {
            self.by_pair.entry((config_id, pair)).or_default().push(info.id.clone());
        }
        self.solutions.insert(info.id.clone(), Indexed { info, manifest });
    }

    /// The indexed solution `solution_id` names.
    ///
    /// # Errors
    ///
    /// `ApiError::BadRequest` when the id is not a lowercase UUID, `ApiError::NotFound` when
    /// no indexed solution carries it.
    pub fn resolve(&self, solution_id: &str) -> Result<&SolutionInfo, ApiError> {
        if !is_uuid(solution_id) {
            let shown = ApiError::quoted(solution_id);
            return Err(ApiError::BadRequest(format!(
                "solution_id {shown} is not a lowercase UUID"
            )));
        }
        self.solutions.get(solution_id).map(|indexed| &indexed.info).ok_or_else(|| {
            ApiError::NotFound(format!("solution {solution_id} is not in the library"))
        })
    }

    /// Reads one node of one solution, opening the solution on its first use.
    ///
    /// # Errors
    ///
    /// As `resolve`; `ApiError::NotFound` for a key the solution does not hold;
    /// `ApiError::Unavailable` when the solution is marked unavailable, now or earlier;
    /// `ApiError::Internal` for a failure no request can cause.
    pub fn node(&self, solution_id: &str, key: &NodeKey) -> Result<NodeView, ApiError> {
        let info = self.resolve(solution_id)?;
        let reader = self.reader.as_ref().ok_or_else(|| {
            ApiError::Internal(format!("solution {solution_id} is indexed without a store"))
        })?;
        let handle = reader.open(&info.prefix)?;
        Ok(reader.node(handle, key)?)
    }

    /// `node` on tokio's blocking pool, for handlers (plan C.2 step 2).
    ///
    /// # Errors
    ///
    /// As `node`, plus `ApiError::Internal` when the blocking task did not run.
    pub async fn node_blocking(
        self: Arc<Self>,
        solution_id: String,
        key: NodeKey,
    ) -> Result<NodeView, ApiError> {
        tokio::task::spawn_blocking(move || self.node(&solution_id, &key))
            .await
            .map_err(|err| ApiError::Internal(format!("the node read did not run: {err}")))?
    }

    /// The key each of `tokens` leads to from `key`, when the solution holds that node;
    /// `None` when the action ends the solution (a fold, or the action that closes the
    /// solution's last street), so the api walks a tree without the key grammar (O-245).
    ///
    /// # Errors
    ///
    /// As `node`, except that a child the solution does not hold is `None`, not an error.
    pub fn next_node_keys(
        &self,
        solution_id: &str,
        key: &NodeKey,
        tokens: &[ActionToken],
    ) -> Result<Vec<Option<NodeKey>>, ApiError> {
        tokens
            .iter()
            .map(|token| {
                let child = key.clone().with_action(*token);
                match self.node(solution_id, &child) {
                    Ok(_) => Ok(Some(child)),
                    Err(ApiError::NotFound(_)) => Ok(None),
                    Err(err) => Err(err),
                }
            })
            .collect()
    }

    /// `next_node_keys` on tokio's blocking pool, for handlers.
    ///
    /// # Errors
    ///
    /// As `next_node_keys`, plus `ApiError::Internal` when the blocking task did not run.
    pub async fn next_node_keys_blocking(
        self: Arc<Self>,
        solution_id: String,
        key: NodeKey,
        tokens: Vec<ActionToken>,
    ) -> Result<Vec<Option<NodeKey>>, ApiError> {
        tokio::task::spawn_blocking(move || self.next_node_keys(&solution_id, &key, &tokens))
            .await
            .map_err(|err| ApiError::Internal(format!("the child lookup did not run: {err}")))?
    }

    /// Every indexed solution of one configuration and pair, by id.
    #[must_use]
    pub fn solutions_for(&self, config_id: &ConfigId, pair: PositionPair) -> Vec<SolutionInfo> {
        self.by_pair
            .get(&(config_id.clone(), pair))
            .into_iter()
            .flatten()
            .filter_map(|id| self.info(id).cloned())
            .collect()
    }

    /// The manifest of an indexed solution.
    #[must_use]
    pub fn manifest(&self, solution_id: &str) -> Option<&Manifest> {
        self.solutions.get(solution_id).map(|indexed| &indexed.manifest)
    }

    /// The indexed solution with `solution_id`, if any.
    #[must_use]
    pub fn info(&self, solution_id: &str) -> Option<&SolutionInfo> {
        self.solutions.get(solution_id).map(|indexed| &indexed.info)
    }

    /// The registry and cache figures.
    #[must_use]
    pub fn stats(&self) -> LibraryStats {
        let saturated = |count: usize| u32::try_from(count).unwrap_or(u32::MAX);
        LibraryStats {
            indexed: saturated(self.solutions.len()),
            unavailable: saturated(self.unavailable().len()),
            cache_used_bytes: self.reader.as_ref().map_or(0, Reader::cache_used_bytes),
            cache_bytes: self.cache_bytes,
        }
    }

    /// Every solution the reader marked unavailable, as (prefix, reason), in the order
    /// marked.
    #[must_use]
    pub fn unavailable(&self) -> Vec<(String, String)> {
        self.reader.as_ref().map(Reader::unavailable).unwrap_or_default()
    }
}

impl fmt::Debug for Library {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Library")
            .field("indexed", &self.solutions.len())
            .field("root", &self.root)
            .field("cache_bytes", &self.cache_bytes)
            .finish_non_exhaustive()
    }
}

#[cfg(test)]
mod tests;
