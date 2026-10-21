//! The one error body of the service (O-158): a Request for Comments (RFC) 9457 problem
//! details object, served as `application/problem+json`. Every error response in the
//! `OpenAPI` document references this schema, so the TypeScript client reads one shape.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// The media type of every error body.
pub const PROBLEM_JSON: &str = "application/problem+json";

/// The prefix of every problem `type`; the tag after it names the kind of problem.
pub const PROBLEM_TYPE_PREFIX: &str = "urn:g-tee-oh:problem:";

/// An RFC 9457 problem details body.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Problem {
    /// A stable identifier of the kind of problem, `urn:g-tee-oh:problem:<tag>`.
    #[serde(rename = "type")]
    #[schema(example = "urn:g-tee-oh:problem:bad-request")]
    pub type_uri: String,
    /// A short summary of the kind of problem, the same for every occurrence.
    #[schema(example = "Bad request")]
    pub title: String,
    /// The Hypertext Transfer Protocol (HTTP) status code of the response.
    #[schema(example = 400)]
    pub status: u16,
    /// What went wrong in this occurrence; never a path beyond the store prefix.
    #[schema(example = "invalid node key \"cfg/BB-BTN\": expected 3 path segments")]
    pub detail: String,
    /// The request id (the `x-request-id` header, echoed); null until the request-id
    /// middleware attaches it.
    #[schema(example = "0123456789abcdef")]
    pub instance: Option<String>,
}
