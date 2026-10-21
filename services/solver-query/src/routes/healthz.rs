//! `GET /healthz` (A5 section 2, A9 section 4, R2.13): the liveness answer the compose
//! health check, the `healthz` self-probe subcommand and the end-to-end job read. The
//! `fixture_library` block makes the `FIXTURE_LIBRARY_PATH` mount observable (O-62):
//! `present` is true when that directory exists at request time, so a mount that arrives
//! late shows up without a restart. The `library` block is `Library::stats` (the startup
//! scan's count, the solutions the reader marked unavailable, the cache in use and its
//! budget, O-144). The `database` block is the query-role connection (O-146): `configured`
//! when `QUERY_DATABASE_URL` is set, `connected` and the `role` when the probe of
//! `Db::probe_role` answered on this request, within its timeout, so a database that is
//! down lowers nothing but this block. `status` stays `ok` whatever the blocks say: the
//! process answering is what the probe measures. The body is JavaScript Object Notation
//! (JSON).

use std::path::PathBuf;

use axum::Json;
use axum::extract::State;

use crate::api::health::{DatabaseHealth, FixtureLibrary, Healthz, LibraryHealth};
use crate::app::AppState;
use crate::db::Db;
use crate::library::LibraryStats;
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
    let library = library_health(state.library.stats());
    let database = database_health(state.db.as_deref()).await;
    Json(Healthz {
        status: STATUS_OK.to_owned(),
        service: SERVICE_NAME.to_owned(),
        version: VERSION.to_owned(),
        fixture_library,
        library,
        database,
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

/// The registry and cache figures as the contract names them.
fn library_health(stats: LibraryStats) -> LibraryHealth {
    LibraryHealth {
        indexed: stats.indexed,
        unavailable: stats.unavailable,
        cache_used_bytes: stats.cache_used_bytes,
        cache_bytes: stats.cache_bytes,
    }
}

/// The query-role connection: unconfigured without a pool, else what the probe answered.
async fn database_health(db: Option<&Db>) -> DatabaseHealth {
    let Some(db) = db else {
        return DatabaseHealth { configured: false, connected: false, role: None };
    };
    match db.probe_role().await {
        Ok(probe) => DatabaseHealth { configured: true, connected: true, role: Some(probe.role()) },
        Err(_) => DatabaseHealth { configured: true, connected: false, role: None },
    }
}

#[cfg(test)]
mod tests {
    use super::{database_health, library_health};
    use crate::library::LibraryStats;

    #[test]
    fn r2_13_library_health_carries_every_registry_figure() {
        let stats =
            LibraryStats { indexed: 2, unavailable: 1, cache_used_bytes: 10, cache_bytes: 20 };
        let health = library_health(stats);
        assert_eq!((health.indexed, health.unavailable), (2, 1));
        assert_eq!((health.cache_used_bytes, health.cache_bytes), (10, 20));
    }

    #[tokio::test]
    async fn r2_13_database_health_is_unconfigured_without_a_pool() {
        let health = database_health(None).await;
        assert!(!health.configured && !health.connected && health.role.is_none());
    }
}
