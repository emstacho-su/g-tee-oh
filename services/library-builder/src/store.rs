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
//! [`upload_build`]: LibraryTarget::upload_build
//! [`verify_build`]: LibraryTarget::verify_build
//! [`delete_build`]: LibraryTarget::delete_build

use std::path::{Path, PathBuf};
use std::sync::Arc;

use gto_library::Manifest;

use crate::config::StoreConfig;
use crate::error::BuilderError;

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

impl LibraryTarget {
    /// The target `config` selects.
    ///
    /// # Errors
    ///
    /// `BuilderError::StoreUnconfigured` when nothing is selected; `BuilderError::Store`
    /// when the S3 client cannot be built from the configuration.
    pub fn from_config(config: &StoreConfig) -> Result<LibraryTarget, BuilderError> {
        let _ = config;
        Err(BuilderError::NotImplemented("LibraryTarget::from_config"))
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
        std::future::ready(()).await;
        Err(BuilderError::NotImplemented("LibraryTarget::probe"))
    }

    /// Uploads the build staged under `staging_root/prefix` to `prefix`, manifest last,
    /// and returns the bytes uploaded.
    ///
    /// # Errors
    ///
    /// `BuilderError::Io` for a staged file, `BuilderError::Store` for the target.
    pub async fn upload_build(
        &self,
        staging_root: &Path,
        prefix: &str,
    ) -> Result<u64, BuilderError> {
        let _ = (staging_root, prefix);
        std::future::ready(()).await;
        Err(BuilderError::NotImplemented("LibraryTarget::upload_build"))
    }

    /// Reads the manifest and every file of the build at `prefix` back from the target and
    /// checks each file's sha256 against the manifest.
    ///
    /// # Errors
    ///
    /// `BuilderError::Library` with the checksum mismatch, `BuilderError::Store` for a read.
    pub async fn verify_build(&self, prefix: &str) -> Result<Manifest, BuilderError> {
        let _ = prefix;
        std::future::ready(()).await;
        Err(BuilderError::NotImplemented("LibraryTarget::verify_build"))
    }

    /// Deletes every object under `prefix` and returns how many were deleted.
    ///
    /// # Errors
    ///
    /// `BuilderError::Store` for a list or delete failure.
    pub async fn delete_build(&self, prefix: &str) -> Result<u64, BuilderError> {
        let _ = prefix;
        std::future::ready(()).await;
        Err(BuilderError::NotImplemented("LibraryTarget::delete_build"))
    }

    /// The bytes of the object at `path`.
    ///
    /// # Errors
    ///
    /// `BuilderError::Store` when it cannot be read.
    pub async fn get(&self, path: &str) -> Result<Vec<u8>, BuilderError> {
        let _ = path;
        std::future::ready(()).await;
        Err(BuilderError::NotImplemented("LibraryTarget::get"))
    }
}
