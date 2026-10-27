//! The library target (ADR 0019, O-183, O-184): a directory (`LIBRARY_ROOT`) or the
//! library bucket through `object_store`'s S3 client as the library identity.
//!
//! A build is staged first through `gto-library`'s synchronous `FsStore` in the scratch
//! directory, so the format crate stays synchronous and solver-free (O-183). [`upload_build`]
//! then copies every staged file under the build's prefix and `manifest.json` last, so a
//! build whose upload stops early has no manifest and no reader or scan ever sees it.
//! [`verify_build`] reads every object back through the same target and checks it with
//! `verify_sha256` against the manifest, the reader's own check (O-184); only then may the
//! publish transaction run. [`delete_build`] removes a build's objects after a failure.
//!
//! The `Fs` target writes through `FsStore`, which checks every path and writes a sibling
//! temporary file it renames into place. Staged files are read with `std::fs` on the
//! calling task: one build at a time is uploaded and the runtime has other threads for the
//! operations surface. No error text carries a secret: the S3 client's messages name the
//! operation, the path and the cause, never the credentials.
//!
//! [`upload_build`]: LibraryTarget::upload_build
//! [`verify_build`]: LibraryTarget::verify_build
//! [`delete_build`]: LibraryTarget::delete_build

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use gto_library::{FsStore, MANIFEST_FILE, Manifest, ObjectSink, ObjectStore as _, verify_sha256};
use object_store::ObjectStoreExt as _;
use object_store::aws::AmazonS3Builder;

use crate::config::StoreConfig;
use crate::error::BuilderError;

/// How long the S3 probe may take before the store counts as unreachable.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

/// The region the S3 signer is given; `SeaweedFS` accepts any.
const S3_REGION: &str = "us-east-1";

/// Where builds are written.
#[derive(Clone, Debug)]
pub enum LibraryTarget {
    /// A directory.
    Fs {
        /// The library root; build prefixes go under it.
        root: PathBuf,
    },
    /// The library bucket.
    S3 {
        /// The client, scoped to the bucket.
        client: Arc<dyn object_store::ObjectStore>,
        /// The bucket name, for messages.
        bucket: String,
    },
}

/// Installs rustls's ring provider as the process default once, before the first S3 client
/// is built: reqwest runs with `rustls-no-provider` so that no aws-lc-rs is linked (O-208),
/// and a client built without a process default provider fails. A second call finds the
/// provider in place and does nothing.
fn install_tls_provider() {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        // Err means another thread installed a provider between the check and the call,
        // which leaves a default in place, the only outcome this function needs.
        let _already = rustls::crypto::ring::default_provider().install_default();
    }
}
impl LibraryTarget {
    /// The target `config` selects.
    ///
    /// # Errors
    ///
    /// `BuilderError::StoreUnconfigured` when nothing is selected; `BuilderError::Store`
    /// when the S3 client cannot be built from the configuration.
    pub fn from_config(config: &StoreConfig) -> Result<LibraryTarget, BuilderError> {
        match config {
            StoreConfig::Unconfigured => Err(BuilderError::StoreUnconfigured),
            StoreConfig::Fs { root } => Ok(LibraryTarget::Fs { root: root.clone() }),
            StoreConfig::S3(s3) => {
                install_tls_provider();
                let client = AmazonS3Builder::new()
                    .with_endpoint(&s3.endpoint)
                    .with_allow_http(true)
                    .with_virtual_hosted_style_request(false)
                    .with_region(S3_REGION)
                    .with_bucket_name(&s3.bucket)
                    .with_access_key_id(&s3.access_key)
                    .with_secret_access_key(s3.secret_key.expose())
                    .build()
                    .map_err(|err| BuilderError::store("connect", &s3.bucket, &err))?;
                Ok(LibraryTarget::S3 { client: Arc::new(client), bucket: s3.bucket.clone() })
            }
        }
    }

    /// `fs` or `s3`, for `/healthz`.
    #[must_use]
    pub fn kind(&self) -> &'static str {
        match self {
            LibraryTarget::Fs { .. } => "fs",
            LibraryTarget::S3 { .. } => "s3",
        }
    }

    /// Checks the target answers: the root exists, or a list of the bucket succeeds.
    ///
    /// # Errors
    ///
    /// `BuilderError::Store` naming the failure.
    pub async fn probe(&self) -> Result<(), BuilderError> {
        match self {
            LibraryTarget::Fs { root } if root.is_dir() => Ok(()),
            LibraryTarget::Fs { root } => Err(BuilderError::store(
                "probe",
                &root.display().to_string(),
                &"the library root is not a directory",
            )),
            LibraryTarget::S3 { client, bucket } => {
                match tokio::time::timeout(PROBE_TIMEOUT, client.list_with_delimiter(None)).await {
                    Ok(Ok(_)) => Ok(()),
                    Ok(Err(err)) => Err(BuilderError::store("list", bucket, &err)),
                    Err(_) => Err(BuilderError::store(
                        "list",
                        bucket,
                        &format!("no answer within {} seconds", PROBE_TIMEOUT.as_secs()),
                    )),
                }
            }
        }
    }

    /// Uploads the build staged under `staging_root/prefix` to `prefix`, manifest last,
    /// and returns the bytes uploaded.
    ///
    /// # Errors
    ///
    /// `BuilderError::Io` for a staged file, `BuilderError::Store` for the target,
    /// `BuilderError::Malformed` when the staged build has no manifest.
    pub async fn upload_build(
        &self,
        staging_root: &Path,
        prefix: &str,
    ) -> Result<u64, BuilderError> {
        check_prefix(prefix)?;
        let source = staging_root.join(prefix);
        let mut total = 0_u64;
        for relative in upload_order(&source)? {
            let file = source.join(&relative);
            let bytes = std::fs::read(&file).map_err(|err| BuilderError::io(&file, err))?;
            let size = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
            self.put(&format!("{prefix}/{relative}"), bytes).await?;
            total = total.saturating_add(size);
        }
        Ok(total)
    }

    /// Reads the manifest and every file of the build at `prefix` back from the target and
    /// checks each file's sha256 against the manifest.
    ///
    /// # Errors
    ///
    /// `BuilderError::Library` with the checksum mismatch, `BuilderError::Store` for a read,
    /// `BuilderError::Malformed` when the manifest id is not the build directory's name.
    pub async fn verify_build(&self, prefix: &str) -> Result<Manifest, BuilderError> {
        check_prefix(prefix)?;
        let manifest_path = format!("{prefix}/{MANIFEST_FILE}");
        let manifest = Manifest::from_json(&self.get(&manifest_path).await?)?;
        if prefix.rsplit('/').next() != Some(manifest.id.as_str()) {
            return Err(BuilderError::Malformed {
                path: manifest_path,
                reason: format!("the manifest id {} is not the build directory", manifest.id),
            });
        }
        for (relative, sha256) in manifest_files(&manifest) {
            let path = format!("{prefix}/{relative}");
            let bytes = self.get(&path).await?;
            verify_sha256(&path, &bytes, &sha256)?;
        }
        Ok(manifest)
    }

    /// Deletes every object under `prefix` and returns how many were deleted.
    ///
    /// # Errors
    ///
    /// `BuilderError::Store` for a list or delete failure.
    pub async fn delete_build(&self, prefix: &str) -> Result<u64, BuilderError> {
        check_prefix(prefix)?;
        match self {
            LibraryTarget::Fs { root } => delete_dir(&root.join(prefix), prefix),
            LibraryTarget::S3 { client, .. } => {
                let mut deleted = 0_u64;
                for location in list_objects(client.as_ref(), prefix).await? {
                    client
                        .delete(&location)
                        .await
                        .map_err(|err| BuilderError::store("delete", location.as_ref(), &err))?;
                    deleted += 1;
                }
                Ok(deleted)
            }
        }
    }

    /// The bytes of the object at `path`.
    ///
    /// # Errors
    ///
    /// `BuilderError::Store` when it cannot be read.
    pub async fn get(&self, path: &str) -> Result<Vec<u8>, BuilderError> {
        match self {
            LibraryTarget::Fs { root } => FsStore::new(root.clone())
                .and_then(|store| store.get(path))
                .map_err(|err| BuilderError::store("get", path, &err)),
            LibraryTarget::S3 { client, .. } => {
                let location = object_path(path)?;
                let result = client
                    .get(&location)
                    .await
                    .map_err(|err| BuilderError::store("get", path, &err))?;
                let bytes =
                    result.bytes().await.map_err(|err| BuilderError::store("get", path, &err))?;
                Ok(bytes.to_vec())
            }
        }
    }

    /// Stores `bytes` at `path`.
    async fn put(&self, path: &str, bytes: Vec<u8>) -> Result<(), BuilderError> {
        match self {
            LibraryTarget::Fs { root } => FsStore::new(root.clone())
                .and_then(|mut store| store.put(path, &bytes))
                .map_err(|err| BuilderError::store("put", path, &err)),
            LibraryTarget::S3 { client, .. } => {
                let location = object_path(path)?;
                client
                    .put(&location, bytes.into())
                    .await
                    .map(|_| ())
                    .map_err(|err| BuilderError::store("put", path, &err))
            }
        }
    }
}

/// Rejects a prefix that could leave the library root: empty, a `.` or `..` segment, an
/// empty segment, or a backslash or drive colon.
fn check_prefix(prefix: &str) -> Result<(), BuilderError> {
    let plain = |segment: &str| {
        !segment.is_empty() && segment != "." && segment != ".." && !segment.contains(['\\', ':'])
    };
    if prefix.split('/').all(plain) {
        Ok(())
    } else {
        Err(BuilderError::store("check", prefix, &"not a plain relative prefix"))
    }
}

/// An object path for the S3 client.
fn object_path(path: &str) -> Result<object_store::path::Path, BuilderError> {
    object_store::path::Path::parse(path).map_err(|err| BuilderError::store("path", path, &err))
}

/// Every file of a manifest with its sha256: the flop files, the runout files and any
/// preflop chunks.
fn manifest_files(manifest: &Manifest) -> Vec<(String, String)> {
    let lines = manifest.lines.iter().flatten().map(|l| (l.flop_file.clone(), l.sha256.clone()));
    let runouts = manifest
        .runouts
        .iter()
        .flatten()
        .flat_map(|runout| runout.files.values())
        .map(|file| (file.path.clone(), file.sha256.clone()));
    let chunks = manifest.chunks.iter().flatten().map(|c| (c.path.clone(), c.sha256.clone()));
    lines.chain(runouts).chain(chunks).collect()
}

/// Every file under `dir` as a relative path with forward slashes, sorted.
///
/// # Errors
///
/// `BuilderError::Io` when a directory cannot be read.
pub fn files_under(dir: &Path) -> Result<Vec<String>, BuilderError> {
    let mut out = Vec::new();
    let mut pending = vec![dir.to_path_buf()];
    while let Some(next) = pending.pop() {
        let entries = std::fs::read_dir(&next).map_err(|err| BuilderError::io(&next, err))?;
        for entry in entries {
            let path = entry.map_err(|err| BuilderError::io(&next, err))?.path();
            if path.is_dir() {
                pending.push(path);
            } else if let Ok(relative) = path.strip_prefix(dir) {
                out.push(relative.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    out.sort();
    Ok(out)
}

/// The staged files in upload order: every file, then `manifest.json`.
fn upload_order(source: &Path) -> Result<Vec<String>, BuilderError> {
    let (manifest, mut files): (Vec<String>, Vec<String>) =
        files_under(source)?.into_iter().partition(|file| file == MANIFEST_FILE);
    if manifest.is_empty() {
        return Err(BuilderError::Malformed {
            path: source.display().to_string(),
            reason: "the staged build has no manifest.json".to_owned(),
        });
    }
    files.extend(manifest);
    Ok(files)
}

/// Removes a build directory of the `Fs` target and counts its files; a missing directory
/// deletes nothing.
fn delete_dir(dir: &Path, prefix: &str) -> Result<u64, BuilderError> {
    if !dir.exists() {
        return Ok(0);
    }
    let count = u64::try_from(files_under(dir)?.len()).unwrap_or(u64::MAX);
    std::fs::remove_dir_all(dir).map_err(|err| BuilderError::store("delete", prefix, &err))?;
    Ok(count)
}

/// Every object under `prefix` in the bucket, walking the delimiter listing level by level
/// (the recursive stream listing would need a stream combinator crate).
async fn list_objects(
    client: &dyn object_store::ObjectStore,
    prefix: &str,
) -> Result<Vec<object_store::path::Path>, BuilderError> {
    let mut objects = Vec::new();
    let mut pending = vec![object_path(prefix)?];
    while let Some(next) = pending.pop() {
        let listing = client
            .list_with_delimiter(Some(&next))
            .await
            .map_err(|err| BuilderError::store("list", next.as_ref(), &err))?;
        objects.extend(listing.objects.into_iter().map(|meta| meta.location));
        pending.extend(listing.common_prefixes);
    }
    Ok(objects)
}

#[cfg(test)]
mod tests {
    use super::{LibraryTarget, check_prefix, files_under};

    #[tokio::test]
    async fn r2_17_an_fs_upload_puts_the_manifest_last_and_deletes_cleanly() {
        let dir = tempfile::tempdir().expect("a scratch directory");
        let staging = dir.path().join("staging");
        let library = dir.path().join("library");
        std::fs::create_dir_all(staging.join("builds/x/flop")).expect("staging");
        std::fs::create_dir_all(&library).expect("library");
        std::fs::write(staging.join("builds/x/flop/a.bin.zst"), b"abc").expect("a file");
        let target = LibraryTarget::Fs { root: library.clone() };
        let missing = target.upload_build(&staging, "builds/x").await;
        assert!(missing.is_err(), "no manifest, no upload");
        std::fs::write(staging.join("builds/x/manifest.json"), b"{}").expect("a manifest");
        let bytes = target.upload_build(&staging, "builds/x").await.expect("uploads");
        assert_eq!(bytes, 5);
        assert_eq!(
            files_under(&library.join("builds/x")).expect("files"),
            ["flop/a.bin.zst", "manifest.json"]
        );
        assert!(target.verify_build("builds/x").await.is_err(), "{{}} is not a manifest");
        target.probe().await.expect("the root exists");
        assert_eq!(target.delete_build("builds/x").await.expect("deletes"), 2);
        assert_eq!(target.delete_build("builds/x").await.expect("nothing left"), 0);
        assert!(target.get("builds/x/manifest.json").await.is_err());
    }

    #[test]
    fn r2_17_a_prefix_cannot_leave_the_root() {
        assert!(check_prefix("builds/cfg/BB-BTN/Ah7d2c/id").is_ok());
        for bad in ["", "../x", "builds//x", "builds/./x", "c:/x", "a\\b"] {
            assert!(check_prefix(bad).is_err(), "{bad}");
        }
    }
}
