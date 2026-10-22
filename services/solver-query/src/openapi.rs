//! The `OpenAPI` document `solver-query` publishes (R0.7, R2.13, O-38, O-116). `ApiDoc`
//! carries the info block and the tags; the paths come from the router in `app`, so the
//! two cannot drift. The committed copy lives at
//! `packages/contracts/solver-query.openapi.json`, written by
//! `solver-query openapi --out <path>` from this process. The pipeline never shell
//! redirects, because PowerShell `>` emits UTF-16.

use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use utoipa::OpenApi;

/// The info block and the tags of the document. The version is `CARGO_PKG_VERSION`,
/// which the derive reads from the crate manifest. One tag per A5 section 2 area.
#[derive(OpenApi)]
#[openapi(
    info(
        title = "solver-query",
        description = "Read-only query service over the solutions library; it never solves \
            (ADR 0018). Errors are RFC 9457 problem details (application/problem+json)."
    ),
    tags(
        (name = "nodes", description = "One node of one solution (GET /v1/nodes)"),
        (
            name = "grade",
            description = "Grade one decision with the preflop floor (POST /v1/grade)"
        ),
        (name = "insights", description = "E3 insight data for one hand (GET /v1/insights)"),
        (name = "deal", description = "Seeded server-side deals and street reveals"),
        (name = "sample-action", description = "The opponent's action at a node"),
        (name = "coverage", description = "What the library holds (GET /v1/coverage)"),
        (name = "ops", description = "Health and metrics"),
    )
)]
pub struct ApiDoc;

/// Why the document could not be written.
#[derive(Debug)]
pub enum WriteError {
    /// The document did not serialize, which `serde_json` cannot produce for this type.
    Serialize(serde_json::Error),
    /// The file could not be written.
    Io {
        /// The file that was being written.
        path: PathBuf,
        /// The failure.
        source: io::Error,
    },
}

impl fmt::Display for WriteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Serialize(source) => write!(f, "cannot serialize the document: {source}"),
            Self::Io { path, source } => write!(f, "cannot write {}: {source}", path.display()),
        }
    }
}

impl std::error::Error for WriteError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Serialize(source) => Some(source),
            Self::Io { source, .. } => Some(source),
        }
    }
}

/// The document as pretty JSON with one trailing newline: the exact bytes of the file.
///
/// # Errors
///
/// Serialization errors from `serde_json`, which this document does not produce.
pub fn document_json(document: &utoipa::openapi::OpenApi) -> Result<String, serde_json::Error> {
    let mut json = document.to_pretty_json()?;
    json.push('\n');
    Ok(json)
}

/// Writes `document` to `path`, replacing any previous file.
///
/// # Errors
///
/// Returns [`WriteError::Io`] when the file cannot be written (for example when its
/// directory does not exist) and [`WriteError::Serialize`] if serialization fails.
pub fn write_document(document: &utoipa::openapi::OpenApi, path: &Path) -> Result<(), WriteError> {
    let json = document_json(document).map_err(WriteError::Serialize)?;
    fs::write(path, json).map_err(|source| WriteError::Io { path: path.to_path_buf(), source })
}

#[cfg(test)]
mod tests {
    use utoipa::OpenApi as _;

    use super::{ApiDoc, document_json};

    #[test]
    fn r0_7_openapi_info_names_the_crate() {
        let document = ApiDoc::openapi();
        assert_eq!(document.info.title, "solver-query");
        assert_eq!(document.info.version, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn r0_7_openapi_json_ends_with_one_newline() {
        let json = document_json(&ApiDoc::openapi()).expect("the document serializes");
        assert!(json.ends_with('\n'));
        assert!(!json.ends_with("\n\n"));
        assert!(json.starts_with("{\n"), "pretty printed, got {json:.20}");
    }

    #[test]
    fn r2_13_openapi_declares_one_tag_per_a5_area() {
        let document = ApiDoc::openapi();
        let tags: Vec<String> =
            document.tags.iter().flatten().map(|tag| tag.name.clone()).collect();
        let expected = ["nodes", "grade", "insights", "deal", "sample-action", "coverage", "ops"];
        assert_eq!(tags, expected.map(str::to_owned).to_vec());
    }
}
