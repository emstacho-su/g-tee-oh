//! The axum application and its `OpenAPI` document, built together so the document always
//! describes exactly the routes that are mounted (utoipa-axum, O-116). `app()` takes its
//! state from the configuration that `Config::from_env` reads, so `config` stays the one
//! module that touches the process environment; `app_with` takes explicit state, which is
//! what the integration tests use.

use std::path::PathBuf;

use axum::Router;
use utoipa::OpenApi as _;
use utoipa::openapi::OpenApi;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::config::{self, Config};
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

/// The router and its document, with state from the configuration in the process
/// environment.
///
/// # Errors
///
/// Returns the configuration error when a `solver-query` variable is set but malformed,
/// so a typo fails the `openapi` subcommand the way it fails `serve`.
pub fn app() -> Result<(Router, OpenApi), config::Error> {
    let config = Config::from_env()?;
    Ok(app_with(AppState::from(&config)))
}

/// The router and its document for `state`.
pub fn app_with(state: AppState) -> (Router, OpenApi) {
    let (router, document) = OpenApiRouter::<AppState>::with_openapi(ApiDoc::openapi())
        .routes(routes!(healthz::healthz))
        .split_for_parts();
    (router.with_state(state), document)
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;
    use std::path::PathBuf;

    use super::AppState;
    use crate::config::{Config, FIXTURE_LIBRARY_VAR};

    #[test]
    fn r0_7_app_state_takes_the_fixture_library_path_from_config() {
        let config = Config::from_lookup(|name| {
            (name == FIXTURE_LIBRARY_VAR).then(|| OsString::from("/fixtures/library"))
        })
        .expect("one well formed variable");

        let state = AppState::from(&config);

        assert_eq!(state.fixture_library_path, Some(PathBuf::from("/fixtures/library")));
        let unset = Config::from_lookup(|_| None).expect("nothing set");
        assert_eq!(AppState::from(&unset), AppState::default());
    }
}
