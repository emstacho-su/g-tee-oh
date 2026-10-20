//! The axum application and its `OpenAPI` document, built together so the document always
//! describes exactly the routes that are mounted (utoipa-axum, O-116). `app()` takes the
//! fixture library path from the environment; `app_with` takes explicit state, which is
//! what the integration tests use.

use std::path::PathBuf;

use axum::Router;
use utoipa::OpenApi as _;
use utoipa::openapi::OpenApi;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::config::{Config, FIXTURE_LIBRARY_VAR};
use crate::openapi::ApiDoc;
use crate::routes::healthz;

/// State every handler can read; cloned per request, so keep it small.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AppState {
    /// The fixture library directory (`FIXTURE_LIBRARY_PATH`), reported by `/healthz`
    /// (O-62).
    pub fixture_library_path: Option<PathBuf>,
}

impl From<&Config> for AppState {
    fn from(config: &Config) -> Self {
        Self { fixture_library_path: config.fixture_library_path.clone() }
    }
}

/// The router and its document, with state read from the process environment. Only
/// `FIXTURE_LIBRARY_PATH` is read here, and a path needs no parsing, so this cannot fail.
pub fn app() -> (Router, OpenApi) {
    let fixture_library_path = std::env::var_os(FIXTURE_LIBRARY_VAR).map(PathBuf::from);
    app_with(AppState { fixture_library_path })
}

/// The router and its document for `state`.
pub fn app_with(state: AppState) -> (Router, OpenApi) {
    let (router, document) = OpenApiRouter::<AppState>::with_openapi(ApiDoc::openapi())
        .routes(routes!(healthz::healthz))
        .split_for_parts();
    (router.with_state(state), document)
}
