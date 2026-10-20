//! `GET /healthz` (A5 section 2): the liveness answer the compose health check, the
//! `healthz` self-probe subcommand and the end-to-end job read. The `fixture_library`
//! block makes the `FIXTURE_LIBRARY_PATH` mount observable (O-62): `present` is true when
//! that directory exists at request time, so a mount that arrives late shows up without
//! a restart. The body is JavaScript Object Notation (JSON).

use std::path::PathBuf;

use axum::Json;
use axum::extract::State;
use serde::Serialize;
use utoipa::ToSchema;

use crate::app::AppState;
use crate::{SERVICE_NAME, VERSION};

/// The `status` value: a process that answers at all is alive.
pub const STATUS_OK: &str = "ok";

/// The health response body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct Healthz {
    /// Always `ok`.
    #[schema(example = "ok")]
    pub status: &'static str,
    /// The service name, `solver-query`.
    #[schema(example = "solver-query")]
    pub service: &'static str,
    /// The crate version.
    #[schema(example = "0.1.0")]
    pub version: &'static str,
    /// The fixture library mount (O-62).
    pub fixture_library: FixtureLibrary,
}

/// What the service knows about the fixture library directory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct FixtureLibrary {
    /// `FIXTURE_LIBRARY_PATH` as configured, or null when unset.
    #[schema(example = "/fixtures/library")]
    pub path: Option<String>,
    /// Whether that directory exists right now.
    pub present: bool,
}

/// Answers the health probe.
#[utoipa::path(
    get,
    path = "/healthz",
    responses((status = 200, description = "The service is alive", body = Healthz))
)]
pub async fn healthz(State(state): State<AppState>) -> Json<Healthz> {
    let fixture_library = fixture_library(state.fixture_library_path).await;
    Json(Healthz { status: STATUS_OK, service: SERVICE_NAME, version: VERSION, fixture_library })
}

/// Describes the fixture library directory. The filesystem check runs on the blocking
/// pool so a slow mount never stalls the request threads.
async fn fixture_library(path: Option<PathBuf>) -> FixtureLibrary {
    let Some(path) = path else {
        return FixtureLibrary { path: None, present: false };
    };
    let probed = path.clone();
    let present = match tokio::task::spawn_blocking(move || probed.is_dir()).await {
        Ok(present) => present,
        Err(error) => {
            tracing::warn!(path = %path.display(), %error, "fixture library check did not run");
            false
        }
    };
    FixtureLibrary { path: Some(path.to_string_lossy().into_owned()), present }
}
