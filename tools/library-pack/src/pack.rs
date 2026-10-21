//! The three file-level operations behind the subcommands (R2.8): check a dump file, pack
//! it into a library root, and verify a packed solution against its dump.
//!
//! Mechanism: every operation reads the dump through one size-capped read
//! (`MAX_DUMP_BYTES`), parses it and runs both checkers. `pack` validates the config id and
//! the solution id before it builds any output path and writes nothing when the dump is
//! rejected; it then creates the library root if needed and writes
//! `<out_root>/preflop/<config_id>/<id>/` through `gto_library::FsStore`. `verify` reads the
//! manifest and every node back through `gto_library::Reader`, re-exports them under the
//! manifest's metadata and compares the result with the dump (O-133), naming each
//! difference once; it also checks the manifest's tree hash against the dump's and its node
//! count against the nodes read back, which reports nodes the library holds beyond the dump.
//!
//! Lane P (pack) owns this file.

use std::fs::{self, File};
use std::io::Read;
use std::path::Path;

use gto_library::{
    ChunkOptions, FsStore, LibraryError, MANIFEST_FILE, Manifest, ObjectStore, Reader,
    ReaderOptions, SolutionMeta, SolvedNode, write_preflop,
};

use crate::MAX_DUMP_BYTES;
use crate::convert::{PackOptions, convert_checked, solved_nodes, tree_hash};
use crate::dump::{NodeDump, parse_dump};
use crate::error::PackError;
use crate::export::{compare_dumps, export_dump};
use crate::invariants::{check_invariants, check_structure};

/// Reads, parses and checks a dump file.
///
/// # Errors
///
/// `PackError::Rejected` with every violation, `PackError::TooLarge` or `PackError::Io`.
pub fn check_dump_file(dump: &Path) -> Result<NodeDump, PackError> {
    let bytes = read_capped(dump)?;
    let parsed = parse_dump(&bytes).map_err(PackError::Rejected)?;
    let found = [check_invariants(&parsed), check_structure(&parsed)].concat();
    if found.is_empty() { Ok(parsed) } else { Err(PackError::Rejected(found)) }
}

/// Packs a dump into the library under `out_root` and returns the manifest written.
///
/// # Errors
///
/// As `check_dump_file`, plus `PackError::Rejected` for options an own dump needs or an
/// invalid id or timestamp, `PackError::Io` when the root cannot be created, and
/// `PackError::Library` when the write fails. A rejected dump writes nothing.
pub fn pack(dump: &Path, out_root: &Path, o: &PackOptions) -> Result<Manifest, PackError> {
    let checked = check_dump_file(dump)?;
    let (meta, nodes) = convert_checked(&checked, o).map_err(PackError::Rejected)?;
    fs::create_dir_all(out_root).map_err(|source| io_error(out_root, source))?;
    let mut store = FsStore::new(out_root)?;
    Ok(write_preflop(&mut store, &meta, &nodes, &ChunkOptions::default())?)
}

/// Reads the solution at `prefix` under `library_root` back and compares it with the dump
/// (O-133).
///
/// # Errors
///
/// `PackError::Mismatch` with every difference, or the errors of `check_dump_file` and the
/// reader.
pub fn verify(library_root: &Path, prefix: &str, dump: &Path) -> Result<(), PackError> {
    let original = check_dump_file(dump)?;
    let nodes = solved_nodes(&original).map_err(PackError::Rejected)?;
    let manifest = read_manifest(library_root, prefix)?;
    let meta = meta_from_manifest(&manifest)?;
    let back = read_nodes(library_root, prefix, &nodes)?;
    let found = [
        compare_dumps(&original, &export_dump(&meta, &back)),
        manifest_differences(&manifest, &meta, &nodes, back.len()),
    ]
    .concat();
    if found.is_empty() { Ok(()) } else { Err(PackError::Mismatch(found)) }
}

/// The file's bytes, refused above `MAX_DUMP_BYTES` before and while reading.
fn read_capped(path: &Path) -> Result<Vec<u8>, PackError> {
    let file = File::open(path).map_err(|source| io_error(path, source))?;
    let size = file.metadata().map_err(|source| io_error(path, source))?.len();
    let too_large = |bytes: u64| PackError::TooLarge {
        path: path.display().to_string(),
        bytes,
        limit: MAX_DUMP_BYTES,
    };
    if size > MAX_DUMP_BYTES {
        return Err(too_large(size));
    }
    let mut bytes = Vec::with_capacity(usize::try_from(size).unwrap_or(0));
    file.take(MAX_DUMP_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|source| io_error(path, source))?;
    let read = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
    if read > MAX_DUMP_BYTES { Err(too_large(read)) } else { Ok(bytes) }
}

fn io_error(path: &Path, source: std::io::Error) -> PackError {
    PackError::Io { path: path.display().to_string(), source }
}

fn read_manifest(library_root: &Path, prefix: &str) -> Result<Manifest, PackError> {
    let store = FsStore::new(library_root)?;
    let bytes = store.get(&format!("{prefix}/{MANIFEST_FILE}"))?;
    Ok(Manifest::from_json(&bytes)?)
}

/// The solution metadata a preflop manifest records.
fn meta_from_manifest(manifest: &Manifest) -> Result<SolutionMeta, PackError> {
    let missing = |field: &str| {
        PackError::Library(LibraryError::Manifest(format!("the manifest has no {field}")))
    };
    Ok(SolutionMeta {
        id: manifest.id.clone(),
        source: manifest.source,
        engine_version: manifest.engine_version.clone(),
        config: manifest.config.clone(),
        config_id: manifest.config_id.clone().ok_or_else(|| missing("config_id"))?,
        pair: manifest.pair.ok_or_else(|| missing("pair"))?,
        tree_hash: manifest.tree_hash.clone().ok_or_else(|| missing("tree_hash"))?,
        seed: manifest.seed,
        iterations: manifest.iterations,
        exploitability_pct_pot: manifest.exploitability_pct_pot,
        synthetic: manifest.synthetic.unwrap_or(false),
        created_at: manifest.created_at.clone(),
    })
}

/// Every node of the dump the library holds, read back in dump order. A node the library
/// does not hold is left out here and reported once, by `compare_dumps`, as missing from the
/// read-back.
fn read_nodes(
    library_root: &Path,
    prefix: &str,
    nodes: &[SolvedNode],
) -> Result<Vec<SolvedNode>, PackError> {
    let reader = Reader::new(FsStore::new(library_root)?, ReaderOptions::default());
    let handle = reader.open(prefix)?;
    let mut back = Vec::with_capacity(nodes.len());
    for node in nodes {
        match reader.node(handle, &node.key) {
            Ok(view) => back.push(view.to_solved(&node.key)?),
            Err(LibraryError::NodeNotFound(_)) => {}
            Err(err) => return Err(err.into()),
        }
    }
    Ok(back)
}

/// The manifest's tree hash against the dump's, and its node count against the `read`
/// nodes that came back. A node the library lacks already has its sentence from
/// `compare_dumps`, so the count is held against what read back, not against the dump, and
/// speaks only for nodes the manifest holds beyond the dump's keys.
fn manifest_differences(
    manifest: &Manifest,
    meta: &SolutionMeta,
    nodes: &[SolvedNode],
    read: usize,
) -> Vec<String> {
    let stored: u64 =
        manifest.chunks.iter().flatten().map(|chunk| u64::from(chunk.node_count)).sum();
    let read = u64::try_from(read).unwrap_or(u64::MAX);
    let dumped = u64::try_from(nodes.len()).unwrap_or(u64::MAX);
    let expected_hash = tree_hash(nodes);
    let checks = [
        (stored != read).then(|| {
            format!("The manifest lists {stored} nodes; {read} of the dump's {dumped} read back.")
        }),
        (meta.tree_hash != expected_hash).then(|| {
            format!("The manifest's tree_hash is {}, the dump's {expected_hash}.", meta.tree_hash)
        }),
    ];
    checks.into_iter().flatten().collect()
}
