//! The axum application and its `OpenAPI` document, built together so the document always
//! describes exactly the routes that are mounted (utoipa-axum, O-116). `app()` takes its
//! state from the configuration that `Config::from_env` reads, so `config` stays the one
//! module that touches the process environment; `app_with` takes explicit state, which is
//! what the integration tests and the `openapi` subcommand use. Every A5 section 2 route
//! is mounted here (R2.13); one `routes!` call per path, since the macro groups the
//! methods of one path.
//!
//! `AppState` is what every handler reads (plan A.7): the library registry scanned from
//! `FIXTURE_LIBRARY_PATH` at startup (O-144), the query-role pool when
//! `QUERY_DB_PASSWORD` is set (O-146), the deal store (O-152), the metrics registry, the
//! embedded equity table (O-148) and the fixture path `/healthz` reports (O-62). It is
//! cloned per request, so every field is shared behind an `Arc`. `from_config` builds it
//! for the server: a fixture path that is unset, missing or empty gives an empty library,
//! never a panic; `empty` builds it for the `openapi` subcommand, which needs the routes
//! and nothing behind them.
//!
//! Three layers wrap every route and the fallback, innermost first: the request body limit
//! (`REQUEST_BODY_LIMIT_BYTES`, far above the largest request body of the contract), the
//! request-id middleware, and the latency middleware, so the recorded status is the one
//! the caller saw (see `middleware`).

use std::fmt;
use std::path::PathBuf;
use std::sync::Arc;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::middleware::{from_fn, from_fn_with_state};
use utoipa::OpenApi as _;
use utoipa::openapi::OpenApi;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::config::{self, Config};
use crate::db::Db;
use crate::deal::{DEAL_STORE_CAPACITY, DealStore};
use crate::equity::EquityTable;
use crate::library::Library;
use crate::metrics::Metrics;
use crate::middleware::{latency, request_id};
use crate::openapi::ApiDoc;
use crate::routes::{coverage, deal, grade, healthz, insights, metrics, nodes, sample_action};

/// The most bytes a request body may carry, 64 KiB: a grade, deal or sample-action body
/// is under a kilobyte, so anything near this limit is not a request this service takes.
pub const REQUEST_BODY_LIMIT_BYTES: usize = 64 * 1024;

/// State every handler can read; cloned per request, so every field is shared.
#[derive(Clone)]
pub struct AppState {
    /// The solutions registry and the reader (O-144).
    pub library: Arc<Library>,
    /// The query-role pool, when `QUERY_DB_PASSWORD` is set (O-146).
    pub db: Option<Arc<Db>>,
    /// The deals made since startup (O-152).
    pub deals: Arc<DealStore>,
    /// The request counters, the latency histogram and the gauges (O-155).
    pub metrics: Arc<Metrics>,
    /// The 169 by 169 preflop equity table (O-148).
    pub equity: Arc<EquityTable>,
    /// The fixture library directory (`FIXTURE_LIBRARY_PATH`), reported by `/healthz`
    /// (O-62).
    pub fixture_library_path: Option<PathBuf>,
}

impl fmt::Debug for AppState {
    /// The library, whether a pool is held, the store's capacity and the fixture path; the
    /// equity table (169 by 169 numbers) and the metrics are left out.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AppState")
            .field("library", &self.library)
            .field("db", &self.db.is_some())
            .field("deals", &self.deals.capacity())
            .field("fixture_library_path", &self.fixture_library_path)
            .finish_non_exhaustive()
    }
}

/// Why the state could not be built.
#[derive(Debug)]
pub enum StartError {
    /// A configuration variable is malformed.
    Config(config::Error),
    /// `QUERY_DB_PASSWORD` is set but the state was built outside the async runtime, where
    /// the lazy pool cannot spawn its reaper task.
    NoRuntime,
}

impl fmt::Display for StartError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Config(source) => write!(f, "configuration: {source}"),
            Self::NoRuntime => write!(
                f,
                "{} is set, so the state must be built inside the tokio runtime",
                config::DATABASE_PASSWORD_VAR
            ),
        }
    }
}

impl std::error::Error for StartError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Config(source) => Some(source),
            Self::NoRuntime => None,
        }
    }
}

impl AppState {
    /// The state for `config`: scans the fixture library (an unset, missing or empty path
    /// gives an empty library and a warning, never a panic) and opens the lazy pool when a
    /// database is configured, which must happen inside the tokio runtime (the pool spawns
    /// its reaper there); `server::serve` and the integration tests are inside it.
    ///
    /// # Errors
    ///
    /// [`StartError::NoRuntime`] when a database is configured outside the runtime.
    pub fn from_config(config: &Config) -> Result<AppState, StartError> {
        let cache_bytes = config.cache_bytes();
        let library = match &config.fixture_library_path {
            Some(root) => scan_or_empty(root, cache_bytes),
            None => Library::empty(cache_bytes),
        };
        let db = match &config.database {
            Some(database) => Some(Arc::new(open_pool(database)?)),
            None => None,
        };
        Ok(AppState {
            library: Arc::new(library),
            db,
            deals: Arc::new(DealStore::new(DEAL_STORE_CAPACITY)),
            metrics: Arc::new(Metrics::new()),
            equity: EquityTable::embedded(),
            fixture_library_path: config.fixture_library_path.clone(),
        })
    }

    /// A state with an empty library, no database and no fixture path, for the `openapi`
    /// subcommand and for tests of the routes' shape.
    #[must_use]
    pub fn empty() -> AppState {
        AppState {
            library: Arc::new(Library::empty(gto_library::DEFAULT_QUERY_CACHE_BYTES)),
            db: None,
            deals: Arc::new(DealStore::new(DEAL_STORE_CAPACITY)),
            metrics: Arc::new(Metrics::new()),
            equity: EquityTable::embedded(),
            fixture_library_path: None,
        }
    }
}

/// The lazy pool over the parts of `database`, refused outside the runtime (see
/// `AppState::from_config`).
fn open_pool(database: &config::DatabaseConfig) -> Result<Db, StartError> {
    if tokio::runtime::Handle::try_current().is_err() {
        return Err(StartError::NoRuntime);
    }
    Ok(Db::connect_lazy(database))
}

/// The scanned library, or an empty one when the root cannot be scanned (O-62: the mount
/// may arrive late; `/healthz` keeps reporting whether it is present).
fn scan_or_empty(root: &std::path::Path, cache_bytes: u64) -> Library {
    match Library::scan(root, cache_bytes) {
        Ok(library) => {
            let stats = library.stats();
            tracing::info!(root = %root.display(), indexed = stats.indexed, "library scanned");
            library
        }
        Err(error) => {
            tracing::warn!(root = %root.display(), %error, "library not scanned; serving none");
            Library::empty(cache_bytes)
        }
    }
}

/// The router and its document, with state from the configuration in the process
/// environment.
///
/// # Errors
///
/// [`StartError::Config`] when a `solver-query` variable is set but malformed, and
/// [`StartError::NoRuntime`] when a database is configured outside the tokio runtime.
pub fn app() -> Result<(Router, OpenApi), StartError> {
    let config = Config::from_env().map_err(StartError::Config)?;
    Ok(app_with(AppState::from_config(&config)?))
}

/// The router and its document for `state`, with the body limit, the request-id and the
/// latency middleware mounted (see the module docs).
pub fn app_with(state: AppState) -> (Router, OpenApi) {
    let metrics = Arc::clone(&state.metrics);
    let (router, document) = OpenApiRouter::<AppState>::with_openapi(ApiDoc::openapi())
        .routes(routes!(healthz::healthz))
        .routes(routes!(metrics::metrics))
        .routes(routes!(nodes::nodes))
        .routes(routes!(grade::grade))
        .routes(routes!(insights::insights))
        .routes(routes!(deal::deal))
        .routes(routes!(deal::reveal))
        .routes(routes!(sample_action::sample_action))
        .routes(routes!(coverage::coverage))
        .split_for_parts();
    let router = router
        .layer(DefaultBodyLimit::max(REQUEST_BODY_LIMIT_BYTES))
        .layer(from_fn(request_id))
        .layer(from_fn_with_state(metrics, latency))
        .with_state(state);
    (router, document)
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;
    use std::path::PathBuf;

    use gto_library::DEFAULT_QUERY_CACHE_BYTES;

    use super::{AppState, StartError};
    use crate::config::{CACHE_BYTES_VAR, Config, DATABASE_PASSWORD_VAR, FIXTURE_LIBRARY_VAR};
    use crate::deal::DEAL_STORE_CAPACITY;

    fn config(pairs: &[(&str, &str)]) -> Config {
        Config::from_lookup(|name| {
            pairs.iter().find(|(key, _)| *key == name).map(|(_, value)| OsString::from(value))
        })
        .expect("well formed variables")
    }

    #[test]
    fn r2_13_app_state_from_config_scans_a_missing_fixture_path_into_an_empty_library() {
        let missing = "/no/such/fixture/library";
        let state = AppState::from_config(&config(&[(FIXTURE_LIBRARY_VAR, missing)]))
            .expect("a missing path never fails the start");
        assert_eq!(state.fixture_library_path, Some(PathBuf::from(missing)));
        let figures = state.library.stats();
        assert_eq!((figures.indexed, figures.cache_bytes), (0, DEFAULT_QUERY_CACHE_BYTES));
        assert!(state.db.is_none(), "no QUERY_DB_PASSWORD, no pool");
        assert_eq!(state.deals.capacity(), DEAL_STORE_CAPACITY);
        assert_eq!(state.metrics.requests_observed(), 0);
        assert_eq!(state.equity.classes.len(), 169);

        let sized = AppState::from_config(&config(&[(CACHE_BYTES_VAR, "1024")])).expect("ok");
        assert_eq!(sized.library.stats().cache_bytes, 1024);
        assert!(sized.fixture_library_path.is_none());
    }

    /// A dev placeholder password, never a real secret.
    const PASSWORD: &str = "change-me-query";

    #[tokio::test]
    async fn r2_13_app_state_opens_a_lazy_pool_from_the_database_parts() {
        let state = AppState::from_config(&config(&[(DATABASE_PASSWORD_VAR, PASSWORD)]))
            .expect("a lazy pool opens nothing");
        assert!(state.db.is_some());
        let shown = format!("{state:?}");
        assert!(shown.contains("db: true"), "{shown}");
        assert!(!shown.contains(PASSWORD), "the state Debug leaks: {shown}");
    }

    #[test]
    fn r2_13_app_state_refuses_a_database_outside_the_runtime() {
        let error = AppState::from_config(&config(&[(DATABASE_PASSWORD_VAR, PASSWORD)]))
            .expect_err("no runtime here, so the pool cannot spawn its reaper");
        assert!(matches!(error, StartError::NoRuntime), "{error}");
        assert!(error.to_string().contains(DATABASE_PASSWORD_VAR), "{error}");
    }

    #[test]
    fn r0_7_app_state_empty_holds_the_routes_and_nothing_behind_them() {
        let state = AppState::empty();
        assert!(state.fixture_library_path.is_none());
        assert_eq!(state.library.stats().indexed, 0);
        assert!(state.db.is_none());
    }
}
