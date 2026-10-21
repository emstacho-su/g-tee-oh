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

use std::fmt;

use axum::Json;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use gto_library::LibraryError;
use gto_model::ModelError;

use crate::api::problem::{PROBLEM_JSON, PROBLEM_TYPE_PREFIX, Problem};

/// The detail of an `Internal` problem body; the real message is logged, never sent.
pub const INTERNAL_DETAIL: &str = "the service failed to answer; see the service log";

/// Every failure a handler reports.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ApiError {
    /// The request is malformed: a key, hand, pair, seed or filter that does not parse,
    /// an action index out of range, or a filter v1 does not support (400).
    BadRequest(String),
    /// The solution, node, hand or deal does not exist (404).
    NotFound(String),
    /// The solution is marked unavailable by the reader (503).
    Unavailable {
        /// The solution's store prefix.
        prefix: String,
        /// Why, as the reader reported it.
        reason: String,
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
            ApiError::BadRequest(message) | ApiError::NotFound(message) => message.clone(),
            ApiError::Unavailable { prefix, reason } => {
                format!("solution {prefix} is unavailable: {reason}")
            }
            ApiError::DatabaseUnavailable(message) => {
                format!("the query database did not answer: {message}")
            }
            ApiError::NotImplemented => "this route is not implemented yet".to_owned(),
            ApiError::Internal(_) => INTERNAL_DETAIL.to_owned(),
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
        let mut response = (self.status(), Json(self.problem())).into_response();
        response.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static(PROBLEM_JSON));
        response
    }
}

impl From<LibraryError> for ApiError {
    fn from(err: LibraryError) -> Self {
        match err {
            LibraryError::NodeNotFound(key) => {
                ApiError::NotFound(format!("node {key} is not in this solution"))
            }
            LibraryError::Unavailable { prefix, reason } => {
                ApiError::Unavailable { prefix, reason }
            }
            LibraryError::ChecksumMismatch { ref path, .. }
            | LibraryError::Corrupt { ref path, .. }
            | LibraryError::Io { ref path, .. } => {
                ApiError::Unavailable { prefix: path.clone(), reason: err.to_string() }
            }
            LibraryError::Decode(_)
            | LibraryError::UnsupportedFormat(_)
            | LibraryError::KeyHashCollision { .. }
            | LibraryError::DuplicateKey(_)
            | LibraryError::UnknownHandle(_)
            | LibraryError::Quantize(_)
            | LibraryError::Manifest(_)
            | LibraryError::InvalidPath(_)
            | LibraryError::Model(_) => ApiError::Internal(err.to_string()),
        }
    }
}

impl From<ModelError> for ApiError {
    fn from(err: ModelError) -> Self {
        ApiError::BadRequest(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use axum::http::{StatusCode, header};
    use axum::response::IntoResponse;
    use gto_library::LibraryError;
    use gto_model::ModelError;
    use http_body_util::BodyExt;
    use serde_json::Value;

    use super::{ApiError, INTERNAL_DETAIL};
    use crate::api::problem::PROBLEM_JSON;

    #[test]
    fn r2_13_every_variant_maps_to_a_status_and_a_stable_type_tag() {
        let cases = [
            (ApiError::BadRequest("x".into()), 400, "bad-request"),
            (ApiError::NotFound("x".into()), 404, "not-found"),
            (ApiError::Unavailable { prefix: "p".into(), reason: "r".into() }, 503, "unavailable"),
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
    fn r2_13_library_and_model_errors_map_to_their_statuses() {
        let not_found = ApiError::from(LibraryError::NodeNotFound("k".into()));
        assert!(matches!(not_found, ApiError::NotFound(_)));
        let unavailable =
            ApiError::from(LibraryError::Unavailable { prefix: "p".into(), reason: "r".into() });
        assert_eq!(unavailable, ApiError::Unavailable { prefix: "p".into(), reason: "r".into() });
        let corrupt =
            ApiError::from(LibraryError::Corrupt { path: "p/x".into(), reason: "r".into() });
        assert!(matches!(corrupt, ApiError::Unavailable { ref prefix, .. } if prefix == "p/x"));
        let internal = ApiError::from(LibraryError::UnknownHandle(3));
        assert!(matches!(internal, ApiError::Internal(_)));
        let bad = ApiError::from(ModelError::InvalidPosition("XX".into()));
        assert!(matches!(bad, ApiError::BadRequest(ref m) if m.contains("XX")));
    }
}
