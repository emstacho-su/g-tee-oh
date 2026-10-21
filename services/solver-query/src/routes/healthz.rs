//! `GET /healthz` (A5 section 2): the liveness answer the compose health check, the
//! `healthz` self-probe subcommand and the end-to-end job read. The `fixture_library`
//! block makes the `FIXTURE_LIBRARY_PATH` mount observable (O-62): `present` is true when
//! that directory exists at request time, so a mount that arrives late shows up without
//! a restart. The `library` and `database` blocks (plan C.8) report zeros and
//! `unconfigured` until the registry and the query-role pool reach `AppState`. The body
//! is JavaScript Object Notation (JSON).

use std::path::PathBuf;

use axum::Json;
use axum::extract::State;

use crate::api::health::{DatabaseHealth, FixtureLibrary, Healthz, LibraryHealth};
use crate::app::AppState;
use crate::{SERVICE_NAME, VERSION};

/// The `status` value: a process that answers at all is alive.
pub const STATUS_OK: &str = "ok";

/// Answers the health probe.
#[utoipa::path(
    get,
    path = "/healthz",
    tag = "ops",
    responses((status = 200, description = "The service is alive", body = Healthz))
)]
pub async fn healthz(State(state): State<AppState>) -> Json<Healthz> {
    let fixture_library = fixture_library(state.fixture_library_path).await;
    Json(Healthz {
        status: STATUS_OK.to_owned(),
        service: SERVICE_NAME.to_owned(),
        version: VERSION.to_owned(),
        fixture_library,
        library: LibraryHealth { indexed: 0, unavailable: 0, cache_used_bytes: 0, cache_bytes: 0 },
        database: DatabaseHealth { configured: false, connected: false, role: None },
    })
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
