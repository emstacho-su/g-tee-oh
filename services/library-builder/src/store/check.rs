//! The verify pass's check of one published build (O-186; PR #22 review HIGH 1, H1, MEDIUM 6).
//!
//! A check reads the build's `manifest.json`, then looks at every file the manifest lists.
//! At [`CheckDepth::Head`] it asks only whether each object exists and how large it is: a
//! HEAD request on the bucket, the file's metadata on a directory. At [`CheckDepth::Full`]
//! it reads every object and compares its sha256 with the manifest, the reader's own check
//! (O-184). The manifest records no object sizes, so the cheap check cannot catch a file
//! rewritten at the same length; the verify pass covers that with a full read of one build
//! per pass, round-robin, and of every build on `library-builder verify --full`.
//!
//! The outcome separates what the store said about the build from whether the store
//! answered at all. A checksum mismatch, a manifest that does not decode or names another
//! build, and a definite not-found ([`object_store::Error::NotFound`],
//! [`std::io::ErrorKind::NotFound`]) make the build [`VerifyOutcome::Broken`]. Any other
//! error (a transport failure, a timeout, a server error) makes it
//! [`VerifyOutcome::Unreachable`], and the pass marks nothing. A not-found counts only
//! while the target still answers its probe afterwards, so a library root or bucket that
//! disappears mid-pass reads as unreachable, never as every build missing.
//!
//! Directory reads run on tokio's blocking pool, so a full read of a large build never
//! holds a runtime worker thread.

use std::path::PathBuf;

use gto_library::{MANIFEST_FILE, Manifest, verify_sha256};
use object_store::ObjectStoreExt as _;

use super::{LibraryTarget, check_prefix, manifest_files, object_path};
use crate::error::BuilderError;

/// Digits of a sha256 in hexadecimal.
const SHA256_HEX_DIGITS: usize = 64;

/// How much of a build a check reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CheckDepth {
    /// The existence and size of every object, never its bytes (the manifest's aside).
    Head,
    /// Every object read in full and its sha256 compared with the manifest.
    Full,
}

/// What a check learned about a build, for `queue::Unavailable`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BuildFacts {
    /// The tree hash of the manifest's first line, decoded from hexadecimal; `None` when
    /// the manifest is missing or has no well formed line hash.
    pub tree_hash: Option<Vec<u8>>,
    /// The bytes of every object the check found, the manifest included.
    pub bytes: u64,
}

/// The result of checking one build.
#[derive(Debug)]
pub enum VerifyOutcome {
    /// Every object is present (and, at [`CheckDepth::Full`], matches its sha256).
    Ok(BuildFacts),
    /// The build is definitely broken.
    Broken {
        /// What the check saw before and after the failure.
        facts: BuildFacts,
        /// The first failure, written to the job's error.
        reason: String,
    },
    /// The store did not answer; nothing is known about the build.
    Unreachable(BuilderError),
}

/// One object as the store answered for it.
enum Seen {
    /// Present, with its size (a HEAD) or its bytes (a full read).
    Found { size: u64, bytes: Option<Vec<u8>> },
    /// Definitely absent.
    Missing,
}

/// The size of a byte buffer as a `u64`.
fn len_of(bytes: &[u8]) -> u64 {
    u64::try_from(bytes.len()).unwrap_or(u64::MAX)
}

/// A store error is a definite not-found.
fn object_seen(
    result: Result<Seen, object_store::Error>,
    operation: &'static str,
    path: &str,
) -> Result<Seen, BuilderError> {
    match result {
        Ok(seen) => Ok(seen),
        Err(object_store::Error::NotFound { .. }) => Ok(Seen::Missing),
        Err(err) => Err(BuilderError::store(operation, path, &err)),
    }
}

/// A file error is a definite not-found.
fn file_seen(
    result: Result<Seen, std::io::Error>,
    operation: &'static str,
    path: &str,
) -> Result<Seen, BuilderError> {
    match result {
        Ok(seen) => Ok(seen),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Seen::Missing),
        Err(err) => Err(BuilderError::store(operation, path, &err)),
    }
}

/// Runs a file operation on the blocking pool.
async fn blocking<T: Send + 'static>(
    path: &str,
    work: impl FnOnce() -> Result<T, std::io::Error> + Send + 'static,
) -> Result<Result<T, std::io::Error>, BuilderError> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|err| BuilderError::store("read", path, &format!("the read task ended: {err}")))
}

/// Reads one directory object: its metadata at `Head`, its bytes at `Full`.
async fn look_fs(file: PathBuf, path: &str, depth: CheckDepth) -> Result<Seen, BuilderError> {
    let seen = match depth {
        CheckDepth::Head => {
            blocking(path, move || {
                std::fs::metadata(&file).map(|meta| {
                    if meta.is_file() {
                        Seen::Found { size: meta.len(), bytes: None }
                    } else {
                        Seen::Missing
                    }
                })
            })
            .await?
        }
        CheckDepth::Full => {
            blocking(path, move || {
                std::fs::read(&file)
                    .map(|bytes| Seen::Found { size: len_of(&bytes), bytes: Some(bytes) })
            })
            .await?
        }
    };
    file_seen(seen, "get", path)
}

/// Reads one bucket object: a HEAD at `Head`, a GET at `Full`.
async fn look_s3(
    client: &dyn object_store::ObjectStore,
    path: &str,
    depth: CheckDepth,
) -> Result<Seen, BuilderError> {
    let location = object_path(path)?;
    match depth {
        CheckDepth::Head => {
            let head = client.head(&location).await;
            object_seen(head.map(|meta| Seen::Found { size: meta.size, bytes: None }), "head", path)
        }
        CheckDepth::Full => {
            let got = match client.get(&location).await {
                Ok(result) => result.bytes().await.map(|bytes| {
                    let bytes = bytes.to_vec();
                    Seen::Found { size: len_of(&bytes), bytes: Some(bytes) }
                }),
                Err(err) => Err(err),
            };
            object_seen(got, "get", path)
        }
    }
}

/// The tree hash of the manifest's first line as bytes, `None` when absent or malformed.
#[must_use]
pub fn first_line_tree_hash(manifest: &Manifest) -> Option<Vec<u8>> {
    decode_sha256_hex(&manifest.lines.as_ref()?.first()?.tree_hash)
}

/// 64 hexadecimal digits as 32 bytes, `None` for anything else.
fn decode_sha256_hex(hex: &str) -> Option<Vec<u8>> {
    if hex.len() != SHA256_HEX_DIGITS || !hex.is_ascii() {
        return None;
    }
    (0..hex.len())
        .step_by(2)
        .map(|start| u8::from_str_radix(hex.get(start..start + 2)?, 16).ok())
        .collect()
}

/// The running state of one check: the facts so far and the first failure.
struct Tally {
    facts: BuildFacts,
    first_failure: Option<String>,
    saw_missing: bool,
}

impl Tally {
    fn fail(&mut self, reason: String) {
        if self.first_failure.is_none() {
            self.first_failure = Some(reason);
        }
    }
}

impl LibraryTarget {
    /// One object of the target at `depth`.
    async fn look(&self, path: &str, depth: CheckDepth) -> Result<Seen, BuilderError> {
        if check_prefix(path).is_err() {
            return Ok(Seen::Missing);
        }
        match self {
            LibraryTarget::Fs { root } => look_fs(root.join(path), path, depth).await,
            LibraryTarget::S3 { client, .. } => look_s3(client.as_ref(), path, depth).await,
        }
    }

    /// Checks the published build at `prefix` at `depth` (see the module docs).
    pub async fn check_build(&self, prefix: &str, depth: CheckDepth) -> VerifyOutcome {
        if let Err(err) = check_prefix(prefix) {
            return VerifyOutcome::Broken { facts: BuildFacts::default(), reason: err.to_string() };
        }
        let mut tally =
            Tally { facts: BuildFacts::default(), first_failure: None, saw_missing: false };
        if let Err(err) = self.check_objects(prefix, depth, &mut tally).await {
            return VerifyOutcome::Unreachable(err);
        }
        if tally.saw_missing {
            // A not-found is definite only while the target still answers.
            if let Err(err) = self.probe().await {
                return VerifyOutcome::Unreachable(err);
            }
        }
        match tally.first_failure {
            None => VerifyOutcome::Ok(tally.facts),
            Some(reason) => VerifyOutcome::Broken { facts: tally.facts, reason },
        }
    }

    /// Reads the manifest and looks at every file it lists, recording into `tally`; an
    /// error is a store that did not answer.
    async fn check_objects(
        &self,
        prefix: &str,
        depth: CheckDepth,
        tally: &mut Tally,
    ) -> Result<(), BuilderError> {
        let manifest_path = format!("{prefix}/{MANIFEST_FILE}");
        let Some(manifest) = self.check_manifest(prefix, &manifest_path, tally).await? else {
            return Ok(());
        };
        tally.facts.tree_hash = first_line_tree_hash(&manifest);
        for (relative, sha256) in manifest_files(&manifest) {
            let path = format!("{prefix}/{relative}");
            match self.look(&path, depth).await? {
                Seen::Missing => {
                    tally.saw_missing = true;
                    tally.fail(format!("{path} is missing"));
                }
                Seen::Found { size, bytes } => {
                    tally.facts.bytes = tally.facts.bytes.saturating_add(size);
                    if let Some(bytes) = bytes
                        && let Err(err) = verify_sha256(&path, &bytes, &sha256)
                    {
                        tally.fail(BuilderError::from(err).to_string());
                    }
                }
            }
        }
        Ok(())
    }

    /// The manifest of the build, `None` when it is missing or broken (recorded in `tally`).
    async fn check_manifest(
        &self,
        prefix: &str,
        manifest_path: &str,
        tally: &mut Tally,
    ) -> Result<Option<Manifest>, BuilderError> {
        let bytes = match self.look(manifest_path, CheckDepth::Full).await? {
            Seen::Missing => {
                tally.saw_missing = true;
                tally.fail(format!("{manifest_path} is missing"));
                return Ok(None);
            }
            Seen::Found { bytes, .. } => bytes.unwrap_or_default(),
        };
        tally.facts.bytes = len_of(&bytes);
        let manifest = match Manifest::from_json(&bytes) {
            Ok(manifest) => manifest,
            Err(err) => {
                tally.fail(format!("{manifest_path}: {err}"));
                return Ok(None);
            }
        };
        if prefix.rsplit('/').next() != Some(manifest.id.as_str()) {
            tally.fail(format!(
                "{manifest_path}: the manifest id {} is not the build directory",
                manifest.id
            ));
            return Ok(None);
        }
        Ok(Some(manifest))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use object_store::ObjectStoreExt as _;
    use object_store::memory::InMemory;

    use super::{BuildFacts, CheckDepth, LibraryTarget, VerifyOutcome, decode_sha256_hex};

    const ID: &str = "0192f000-0000-7000-8000-000000000001";

    #[test]
    fn r2_17_a_tree_hash_decodes_from_64_hex_digits_only() {
        assert_eq!(decode_sha256_hex(&"ab".repeat(32)), Some(vec![0xab; 32]));
        assert_eq!(decode_sha256_hex(&"ab".repeat(31)), None, "too short");
        assert_eq!(decode_sha256_hex(&"zz".repeat(32)), None, "not hexadecimal");
        assert_eq!(decode_sha256_hex(&"\u{e9}".repeat(32)), None, "not ASCII");
    }

    #[tokio::test]
    async fn r2_17_a_missing_bucket_object_is_broken_and_a_present_one_is_ok() {
        let client = Arc::new(InMemory::new());
        let target = LibraryTarget::S3 { client: client.clone(), bucket: "library".to_owned() };
        let prefix = format!("builds/x/{ID}");
        let outcome = target.check_build(&prefix, CheckDepth::Head).await;
        assert!(
            matches!(&outcome, VerifyOutcome::Broken { facts, reason }
                if *facts == BuildFacts::default() && reason.contains("manifest.json is missing")),
            "{outcome:?}"
        );
        let path =
            object_store::path::Path::parse(format!("{prefix}/manifest.json")).expect("a path");
        client.put(&path, b"not a manifest".to_vec().into()).await.expect("put");
        let outcome = target.check_build(&prefix, CheckDepth::Head).await;
        assert!(
            matches!(&outcome, VerifyOutcome::Broken { facts, .. } if facts.bytes == 14),
            "{outcome:?}"
        );
    }
}
