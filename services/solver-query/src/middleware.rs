//! The request-id and latency middleware, and the problem bodies for the answers axum
//! produces on its own (O-158, A9 section 4, plan C.8).
//!
//! Mechanism, outermost first as `app_with` mounts them:
//!
//! - `latency` reads the matched route pattern (`/v1/deal/{id}/reveal`, never the raw
//!   path, so the label set stays bounded), times the rest of the stack and calls
//!   `Metrics::observe` with the final status, including the 404 of an unmatched path.
//! - `request_id` takes `x-request-id` from the request when it is 1 to 128 visible ASCII
//!   bytes, else generates sixteen hexadecimal digits; opens a tracing span carrying it;
//!   and, on the way out, echoes it in the response header and writes it into the problem
//!   body's `instance`. A handler's `ApiError` leaves its `Problem` in the response
//!   extensions (`error::problem_response`), so the body is rebuilt without parsing it.
//!   An error answer without that extension is one axum produced itself: an extractor
//!   rejection (a query string, path or JSON body that does not deserialize, a wrong
//!   content type, a body over the limit), or the router's own 404 and 405. Those are
//!   plain text, so the middleware reads the text as the detail and wraps it: 404 keeps
//!   its status with the `not-found` tag, 405 and 413 keep theirs with their own tags, and
//!   every other client error becomes 400 `bad-request`, which is what the contract
//!   promises for a malformed request whatever the extractor said (415, 422).
//!
//! Generated ids come from a process-wide counter mixed by the `SplitMix64` finalizer, so
//! they are distinct within a process and never reveal the counter. The integrator of S16
//! owns this file.

use std::sync::Arc;
use std::sync::LazyLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use axum::body::{Body, to_bytes};
use axum::extract::{MatchedPath, Request, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use tracing::Instrument as _;

use crate::api::problem::{PROBLEM_TYPE_PREFIX, Problem};
use crate::error::{ApiError, problem_response};
use crate::metrics::Metrics;

/// The header a caller sets to name the request and the service echoes.
pub const REQUEST_ID_HEADER: &str = "x-request-id";

/// The longest incoming request id that is echoed; a longer one is replaced.
pub const MAX_REQUEST_ID_BYTES: usize = 128;

/// The route label of a request no route matched.
pub const UNMATCHED_ROUTE: &str = "unmatched";

/// The problem type tag of a 405 answer.
pub const METHOD_NOT_ALLOWED_TAG: &str = "method-not-allowed";

/// The problem type tag of a 413 answer (the request body limit).
pub const PAYLOAD_TOO_LARGE_TAG: &str = "payload-too-large";

/// How much of a rejection body is read as the detail.
const MAX_REJECTION_BODY_BYTES: usize = 64 * 1024;

/// The `SplitMix64` increment and finalizer constants (Steele, Lea and Flood 2014).
const GOLDEN_GAMMA: u64 = 0x9e37_79b9_7f4a_7c15;
const MIX_1: u64 = 0xbf58_476d_1ce4_e5b9;
const MIX_2: u64 = 0x94d0_49bb_1331_11eb;

/// The process-wide seed of generated ids: the clock and the process id, mixed once.
static ID_SEED: LazyLock<u64> = LazyLock::new(|| {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_nanos());
    let folded = u64::try_from(nanos & u128::from(u64::MAX)).unwrap_or(0);
    mix(folded ^ u64::from(std::process::id()).rotate_left(32))
});

/// How many ids this process generated.
static ID_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Echoes or generates the request id, logs under it, and fills `Problem::instance`.
pub async fn request_id(request: Request, next: Next) -> Response {
    let id = incoming_request_id(request.headers()).unwrap_or_else(generate_request_id);
    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    let span = tracing::info_span!("request", request_id = %id, method = %method, path = %path);
    let response = next.run(request).instrument(span).await;
    let mut response = with_instance(response, &id, &method, &path).await;
    if let Ok(value) = HeaderValue::from_str(&id) {
        response.headers_mut().insert(HeaderName::from_static(REQUEST_ID_HEADER), value);
    }
    response
}

/// Times the request and records it under the matched route and the final status.
pub async fn latency(
    State(metrics): State<Arc<Metrics>>,
    request: Request,
    next: Next,
) -> Response {
    let route =
        request.extensions().get::<MatchedPath>().map_or(UNMATCHED_ROUTE, MatchedPath::as_str);
    let route = route.to_owned();
    let started = Instant::now();
    let response = next.run(request).await;
    metrics.observe(&route, response.status().as_u16(), started.elapsed());
    response
}

/// The incoming `x-request-id` when it is 1 to `MAX_REQUEST_ID_BYTES` visible ASCII bytes.
fn incoming_request_id(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(REQUEST_ID_HEADER)?.to_str().ok()?;
    let acceptable = (1..=MAX_REQUEST_ID_BYTES).contains(&value.len())
        && value.bytes().all(|b| b.is_ascii_graphic());
    acceptable.then(|| value.to_owned())
}

/// Sixteen hexadecimal digits, distinct for every call within the process.
#[must_use]
pub fn generate_request_id() -> String {
    let n = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{:016x}", mix(ID_SEED.wrapping_add(n.wrapping_mul(GOLDEN_GAMMA))))
}

/// The `SplitMix64` output function.
fn mix(mut z: u64) -> u64 {
    z = (z ^ (z >> 30)).wrapping_mul(MIX_1);
    z = (z ^ (z >> 27)).wrapping_mul(MIX_2);
    z ^ (z >> 31)
}

/// The response with `id` in its problem body: a handler's problem gets its `instance`,
/// an error answer axum produced becomes a problem, and a success passes through.
async fn with_instance(response: Response, id: &str, method: &Method, path: &str) -> Response {
    if let Some(problem) = response.extensions().get::<Problem>() {
        return problem_response(Problem { instance: Some(id.to_owned()), ..problem.clone() });
    }
    let status = response.status();
    if !(status.is_client_error() || status.is_server_error()) {
        return response;
    }
    let detail = rejection_detail(response.into_body(), status, method, path).await;
    let problem = rejection_problem(status, detail);
    problem_response(Problem { instance: Some(id.to_owned()), ..problem })
}

/// The text of an answer axum produced, or the status's reason when there is none.
async fn rejection_detail(body: Body, status: StatusCode, method: &Method, path: &str) -> String {
    let text = match to_bytes(body, MAX_REJECTION_BODY_BYTES).await {
        Ok(bytes) => String::from_utf8_lossy(&bytes).trim().to_owned(),
        Err(_) => String::new(),
    };
    if text.is_empty() {
        let reason = status.canonical_reason().unwrap_or("rejected");
        format!("{method} {path}: {reason}")
    } else {
        text
    }
}

/// The problem for an answer axum produced (see the module docs).
fn rejection_problem(status: StatusCode, detail: String) -> Problem {
    match status {
        StatusCode::NOT_FOUND => ApiError::NotFound(detail).problem(),
        StatusCode::METHOD_NOT_ALLOWED => {
            tagged(METHOD_NOT_ALLOWED_TAG, "Method not allowed", status, detail)
        }
        StatusCode::PAYLOAD_TOO_LARGE => {
            tagged(PAYLOAD_TOO_LARGE_TAG, "Payload too large", status, detail)
        }
        client if client.is_client_error() => ApiError::BadRequest(detail).problem(),
        server => {
            tracing::error!(status = %server, %detail, "an error answer without a problem body");
            ApiError::Internal(detail).problem()
        }
    }
}

/// A problem outside the `ApiError` variants, keeping its status.
fn tagged(tag: &str, title: &str, status: StatusCode, detail: String) -> Problem {
    Problem {
        type_uri: format!("{PROBLEM_TYPE_PREFIX}{tag}"),
        title: title.to_owned(),
        status: status.as_u16(),
        detail,
        instance: None,
    }
}

#[cfg(test)]
mod tests;
