//! `GET /healthz` (A5 section 2, A9 section 4, R0.7, R2.13): the liveness body. The S06
//! fields (`status`, `service`, `version`, `fixture_library`) are unchanged because the
//! compose health check and `infra/compose/smoke.mjs` read them; S16 adds the `library`
//! block (the registry over `FIXTURE_LIBRARY_PATH` and the reader's cache, O-144) and the
//! `database` block (the query-role connection, O-146).

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// The health response body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Healthz {
    /// Always `ok`.
    #[schema(example = "ok")]
    pub status: String,
    /// The service name, `solver-query`.
    #[schema(example = "solver-query")]
    pub service: String,
    /// The crate version.
    #[schema(example = "0.1.0")]
    pub version: String,
    /// The fixture library mount (O-62).
    pub fixture_library: FixtureLibrary,
    /// The solutions registry and the reader's cache.
    pub library: LibraryHealth,
    /// The query-role database connection.
    pub database: DatabaseHealth,
}

/// What the service knows about the fixture library directory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct FixtureLibrary {
    /// `FIXTURE_LIBRARY_PATH` as configured, or null when unset.
    #[schema(example = "/fixtures/library")]
    pub path: Option<String>,
    /// Whether that directory exists right now.
    pub present: bool,
}

/// The registry scanned at startup and the reader's frame cache (A3 section 5).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct LibraryHealth {
    /// How many solutions the startup scan indexed.
    pub indexed: u32,
    /// How many solutions the reader has marked unavailable since startup.
    pub unavailable: u32,
    /// The bytes of decoded frames the cache holds now.
    pub cache_used_bytes: u64,
    /// The cache budget, `QUERY_CACHE_BYTES` or the library default.
    pub cache_bytes: u64,
}

/// The query-role connection (O-28, O-146).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct DatabaseHealth {
    /// True when `QUERY_DB_PASSWORD` is set (the query-role connection is configured).
    pub configured: bool,
    /// True when the role probe answered on this request.
    pub connected: bool,
    /// The role the probe reported, `query` when connected as expected; null otherwise.
    #[schema(example = "query")]
    pub role: Option<String>,
}
