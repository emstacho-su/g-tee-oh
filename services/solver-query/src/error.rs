//! The one error type every handler returns (plan A.7, O-158). `ApiError` maps to a
//! Request for Comments (RFC) 9457 `Problem` with a stable `type` tag, a fixed title and a
//! status, and `IntoResponse` serves it as `application/problem+json`. The detail is the
//! variant's message, except for `Internal`, whose message goes to the log and whose body
//! says only that the service failed, so no path or internal state leaks (A9 section 3).
//!
//! `From<LibraryError>` turns the reader's answers into statuses: a node the solution does
//! not hold is 404, a solution the reader marked unavailable (a checksum mismatch, a file
//! that does not decode, a file that cannot be read) is 503, and a failure that no request
//! should be able to cause (an unknown handle, a manifest the startup scan accepted and the
//! reader then rejects) is 500. `From<ModelError>` is 400: a `gto-model` parse failure on a
//! request path means the caller's key, hand, pair or configuration was malformed.
//!
//! A 503 detail names the solution's store prefix and a fixed failure class
//! (`UnavailableClass`) and nothing else: the reader's reason, which holds an object path
//! under the prefix, two sha256 digests or an operating system's error text, goes to the
//! log at warn level and never to the caller (`Problem::detail` promises no path beyond
//! the store prefix).

use std::fmt;

use axum::Json;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use gto_library::{LibraryError, is_uuid};
use gto_model::ModelError;

use crate::api::problem::{PROBLEM_JSON, PROBLEM_TYPE_PREFIX, Problem};

/// The separator of store paths (`gto_library::LibraryError::InvalidPath`: forward
/// slashes only).
const PATH_SEPARATOR: char = '/';

/// The detail of an `Internal` problem body; the real message is logged, never sent.
pub const INTERNAL_DETAIL: &str = "the service failed to answer; see the service log";

/// How many characters of caller-supplied text a detail echoes back (see
/// [`ApiError::quoted`]).
pub const QUOTED_MAX_CHARS: usize = 64;

/// `problem` as a response: its status, `application/problem+json`, and the problem itself
/// in the response extensions, which is how the request-id middleware finds it to fill
/// `instance` without parsing the body (O-158).
#[must_use]
pub fn problem_response(problem: Problem) -> Response {
    let status = StatusCode::from_u16(problem.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let mut response = (status, Json(problem.clone())).into_response();
    response.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static(PROBLEM_JSON));
    response.extensions_mut().insert(problem);
    response
}

/// Why a solution cannot serve reads, as a 503 detail names it: one of four fixed classes
/// and never the reader's reason, which is logged instead (see the module docs).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnavailableClass {
    /// A file's sha256 differs from the manifest's.
    ChecksumMismatch,
    /// A file that does not decode.
    CorruptFile,
    /// A file that cannot be read.
    UnreadableFile,
    /// The reader marked the solution unavailable, on this request or an earlier one.
    Marked,
}

impl UnavailableClass {
    /// The words the detail uses for this class.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            UnavailableClass::ChecksumMismatch => "checksum mismatch",
            UnavailableClass::CorruptFile => "corrupt file",
            UnavailableClass::UnreadableFile => "unreadable file",
            UnavailableClass::Marked => "marked unavailable by the reader",
        }
    }
}

/// Every failure a handler reports.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ApiError {
    /// The request is malformed: a key, hand, pair, seed or filter that does not parse,
    /// an action index out of range, or a filter v1 does not support (400).
    BadRequest(String),
    /// The solution, node, hand or deal does not exist (404).
    NotFound(String),
    /// The request is well formed but out of order with the deal's state: a street
    /// revealed before the one that precedes it (409, plan C.4).
    Conflict(String),
    /// The solution cannot serve reads (503).
    Unavailable {
        /// The solution's store prefix.
        prefix: String,
        /// Why, as one of the fixed classes; the reader's reason is in the log.
        class: UnavailableClass,
    },
    /// The query-role database did not answer (503).
    DatabaseUnavailable(String),
    /// The route is a stub that has no implementation yet (501).
    NotImplemented,
    /// A failure no request should be able to cause (500); the message is logged.
    Internal(String),
}

impl ApiError {
    /// The HTTP status of the response.
    #[must_use]
    pub const fn status(&self) -> StatusCode {
        match self {
            ApiError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ApiError::NotFound(_) => StatusCode::NOT_FOUND,
            ApiError::Conflict(_) => StatusCode::CONFLICT,
            ApiError::Unavailable { .. } | ApiError::DatabaseUnavailable(_) => {
                StatusCode::SERVICE_UNAVAILABLE
            }
            ApiError::NotImplemented => StatusCode::NOT_IMPLEMENTED,
            ApiError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    /// The tag after `PROBLEM_TYPE_PREFIX`, one per variant and never renamed.
    #[must_use]
    pub const fn type_tag(&self) -> &'static str {
        match self {
            ApiError::BadRequest(_) => "bad-request",
            ApiError::NotFound(_) => "not-found",
            ApiError::Conflict(_) => "conflict",
            ApiError::Unavailable { .. } => "unavailable",
            ApiError::DatabaseUnavailable(_) => "database-unavailable",
            ApiError::NotImplemented => "not-implemented",
            ApiError::Internal(_) => "internal",
        }
    }

    /// The problem title, one per variant.
    #[must_use]
    pub const fn title(&self) -> &'static str {
        match self {
            ApiError::BadRequest(_) => "Bad request",
            ApiError::NotFound(_) => "Not found",
            ApiError::Conflict(_) => "Conflict",
            ApiError::Unavailable { .. } => "Solution unavailable",
            ApiError::DatabaseUnavailable(_) => "Database unavailable",
            ApiError::NotImplemented => "Not implemented",
            ApiError::Internal(_) => "Internal error",
        }
    }

    /// The detail sent to the caller.
    #[must_use]
    pub fn detail(&self) -> String {
        match self {
            ApiError::BadRequest(message)
            | ApiError::NotFound(message)
            | ApiError::Conflict(message) => message.clone(),
            ApiError::Unavailable { prefix, class } => {
                format!("solution {prefix} is unavailable: {}", class.as_str())
            }
            ApiError::DatabaseUnavailable(message) => {
                format!("the query database did not answer: {message}")
            }
            ApiError::NotImplemented => "this route is not implemented yet".to_owned(),
            ApiError::Internal(_) => INTERNAL_DETAIL.to_owned(),
        }
    }

    /// Caller-supplied text for a detail: quoted, and cut to [`QUOTED_MAX_CHARS`] characters
    /// with an ellipsis, so an oversized key or hand never echoes back in full.
    #[must_use]
    pub fn quoted(text: &str) -> String {
        if text.chars().count() <= QUOTED_MAX_CHARS {
            format!("{text:?}")
        } else {
            let head: String = text.chars().take(QUOTED_MAX_CHARS).collect();
            format!("{head:?}...")
        }
    }

    /// The problem body, with no request id attached.
    #[must_use]
    pub fn problem(&self) -> Problem {
        Problem {
            type_uri: format!("{PROBLEM_TYPE_PREFIX}{}", self.type_tag()),
            title: self.title().to_owned(),
            status: self.status().as_u16(),
            detail: self.detail(),
            instance: None,
        }
    }
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ApiError::Internal(message) => write!(f, "{}: {message}", self.title()),
            other => write!(f, "{}: {}", other.title(), other.detail()),
        }
    }
}

impl std::error::Error for ApiError {}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        if let ApiError::Internal(message) = &self {
            tracing::error!(%message, "internal error");
        }
        problem_response(self.problem())
    }
}

impl From<LibraryError> for ApiError {
    fn from(err: LibraryError) -> Self {
        match err {
            LibraryError::NodeNotFound(key) => {
                ApiError::NotFound(format!("node {key} is not in this solution"))
            }
            LibraryError::Unavailable { prefix, reason } => {
                unavailable(prefix, UnavailableClass::Marked, &reason)
            }
            LibraryError::ChecksumMismatch { ref path, .. } => {
                unavailable_under(path, UnavailableClass::ChecksumMismatch, &err)
            }
            LibraryError::Corrupt { ref path, .. } => {
                unavailable_under(path, UnavailableClass::CorruptFile, &err)
            }
            LibraryError::Io { ref path, .. } => {
                unavailable_under(path, UnavailableClass::UnreadableFile, &err)
            }
            LibraryError::Decode(_)
            | LibraryError::UnsupportedFormat(_)
            | LibraryError::KeyHashCollision { .. }
            | LibraryError::DuplicateKey(_)
            | LibraryError::UnknownHandle(_)
            | LibraryError::Quantize(_)
            | LibraryError::Manifest(_)
            | LibraryError::InvalidPath(_)
            | LibraryError::InvalidRequest(_)
            | LibraryError::Model(_) => ApiError::Internal(err.to_string()),
        }
    }
}

impl From<ModelError> for ApiError {
    fn from(err: ModelError) -> Self {
        ApiError::BadRequest(err.to_string())
    }
}

/// `Unavailable` for the solution at `prefix`, with the reader's full `reason` logged.
fn unavailable(prefix: String, class: UnavailableClass, reason: &dyn fmt::Display) -> ApiError {
    tracing::warn!(%prefix, class = class.as_str(), %reason, "solution unavailable");
    ApiError::Unavailable { prefix, class }
}

/// `Unavailable` for the solution the object at `path` belongs to; an object under no
/// solution is a failure no request should be able to cause.
fn unavailable_under(path: &str, class: UnavailableClass, reason: &dyn fmt::Display) -> ApiError {
    match solution_prefix(path) {
        Some(prefix) => unavailable(prefix.to_owned(), class, reason),
        None => ApiError::Internal(reason.to_string()),
    }
}

/// The store prefix of the solution an object path is under: the path through its solution
/// id, the first segment that is a universally unique identifier (UUID), in
/// `preflop/<config_id>/<id>/...` and `builds/<config_id>/<pair>/<flop>/<id>/...` alike
/// (A3 section 5); `None` when no segment is one.
fn solution_prefix(path: &str) -> Option<&str> {
    let mut end = 0;
    for segment in path.split(PATH_SEPARATOR) {
        end += segment.len();
        if is_uuid(segment) {
            return Some(&path[..end]);
        }
        end += PATH_SEPARATOR.len_utf8();
    }
    None
}

#[cfg(test)]
mod tests {
    use std::io;

    use axum::http::{StatusCode, header};
    use axum::response::IntoResponse;
    use gto_library::LibraryError;
    use gto_model::ModelError;
    use http_body_util::BodyExt;
    use serde_json::Value;

    use super::{ApiError, INTERNAL_DETAIL, QUOTED_MAX_CHARS, UnavailableClass};
    use crate::api::problem::{PROBLEM_JSON, Problem};

    /// A lowercase UUID, the last segment of a solution's store prefix.
    const SOLUTION_ID: &str = "5e7a1c2b-3d4f-8a6b-9c0d-1e2f3a4b5c6d";

    #[test]
    fn r2_13_every_variant_maps_to_a_status_and_a_stable_type_tag() {
        let marked = UnavailableClass::Marked;
        let cases = [
            (ApiError::BadRequest("x".into()), 400, "bad-request"),
            (ApiError::NotFound("x".into()), 404, "not-found"),
            (ApiError::Conflict("x".into()), 409, "conflict"),
            (ApiError::Unavailable { prefix: "p".into(), class: marked }, 503, "unavailable"),
            (ApiError::DatabaseUnavailable("x".into()), 503, "database-unavailable"),
            (ApiError::NotImplemented, 501, "not-implemented"),
            (ApiError::Internal("secret".into()), 500, "internal"),
        ];
        for (error, status, tag) in cases {
            let problem = error.problem();
            assert_eq!(problem.status, status, "{error}");
            assert_eq!(problem.type_uri, format!("urn:g-tee-oh:problem:{tag}"), "{error}");
            assert_eq!(problem.title, error.title());
            assert!(problem.instance.is_none());
        }
        assert_eq!(ApiError::Internal("secret".into()).detail(), INTERNAL_DETAIL);
    }

    #[tokio::test]
    async fn r2_13_into_response_serves_problem_json() {
        let response = ApiError::NotFound("no such deal".into()).into_response();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let content_type = response.headers().get(header::CONTENT_TYPE).cloned();
        assert_eq!(content_type.as_ref().and_then(|v| v.to_str().ok()), Some(PROBLEM_JSON));
        let bytes = response.into_body().collect().await.expect("a body").to_bytes();
        let json: Value = serde_json::from_slice(&bytes).expect("JSON");
        assert_eq!(json["type"], "urn:g-tee-oh:problem:not-found");
        assert_eq!(json["title"], "Not found");
        assert_eq!(json["status"], 404);
        assert_eq!(json["detail"], "no such deal");
        assert!(json["instance"].is_null());
    }

    #[test]
    fn r2_13_into_response_carries_the_problem_as_an_extension() {
        let error = ApiError::BadRequest("bad key".into());
        let response = error.clone().into_response();
        let carried = response.extensions().get::<Problem>().expect("the problem extension");
        assert_eq!(*carried, error.problem());
    }

    #[test]
    fn r2_13_quoted_cuts_long_caller_text() {
        assert_eq!(ApiError::quoted("AKs"), "\"AKs\"");
        let long = "x".repeat(QUOTED_MAX_CHARS + 10);
        let shown = ApiError::quoted(&long);
        assert!(shown.ends_with("\"..."), "{shown}");
        assert_eq!(shown.chars().count(), QUOTED_MAX_CHARS + 5, "quotes plus the ellipsis");
    }

    #[test]
    fn r2_13_unavailable_detail_names_the_prefix_and_a_failure_class_only() {
        let prefix = format!("preflop/cfg_6_online_100/{SOLUTION_ID}");
        let chunk = format!("{prefix}/chunks/0000.bin.zst");
        let digest = "ab".repeat(32);
        let reason = format!("checksum mismatch on {chunk}: expected {digest}, found 0");
        let mismatch = LibraryError::ChecksumMismatch {
            path: chunk.clone(),
            expected: digest,
            actual: "cd".repeat(32),
        };
        let corrupt = LibraryError::Corrupt { path: chunk.clone(), reason: "bad magic".into() };
        let unreadable = LibraryError::Io { path: chunk, source: io::Error::other("denied") };
        let marked = LibraryError::Unavailable { prefix: prefix.clone(), reason };
        let cases = [
            (mismatch, "checksum mismatch"),
            (corrupt, "corrupt file"),
            (unreadable, "unreadable file"),
            (marked, "marked unavailable by the reader"),
        ];
        for (library_error, class) in cases {
            let error = ApiError::from(library_error);
            assert_eq!(error.status(), StatusCode::SERVICE_UNAVAILABLE, "{error}");
            assert_eq!(error.detail(), format!("solution {prefix} is unavailable: {class}"));
            assert!(matches!(error, ApiError::Unavailable { prefix: ref p, .. } if *p == prefix));
        }
    }

    #[test]
    fn r2_13_library_and_model_errors_map_to_their_statuses() {
        let not_found = ApiError::from(LibraryError::NodeNotFound("k".into()));
        assert!(matches!(not_found, ApiError::NotFound(_)));
        let source = io::Error::other("x");
        let stray = ApiError::from(LibraryError::Io { path: "manifest.json".into(), source });
        assert!(matches!(stray, ApiError::Internal(_)), "an object under no solution: {stray}");
        let internal = ApiError::from(LibraryError::UnknownHandle(3));
        assert!(matches!(internal, ApiError::Internal(_)));
        let bad = ApiError::from(ModelError::InvalidPosition("XX".into()));
        assert!(matches!(bad, ApiError::BadRequest(ref m) if m.contains("XX")));
    }
}
