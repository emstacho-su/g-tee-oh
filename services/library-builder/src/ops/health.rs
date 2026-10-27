//! The dependency probes behind `/healthz` (S18 review MEDIUM 9, L3).
//!
//! [`Probes`] names the two checks, the database and the store, so a test can put slow or
//! hung fakes in place of the live ones ([`LiveProbes`]). [`run_probes`] starts both at
//! once with `tokio::join!` and cuts each at [`PROBE_TIMEOUT`], so `/healthz` answers within
//! about that timeout even when both dependencies hang.
//!
//! The answer is cached for [`PROBE_CACHE_TTL`] behind one async mutex in [`ProbeCache`].
//! A request takes the mutex, reuses a fresh answer, or else runs the probes while it
//! holds the mutex. Concurrent requests wait on the mutex and then find that fresh answer,
//! so they share one in-flight probe (single flight), and a flood of requests runs at most
//! one database probe per window instead of draining the 4-connection pool.

use std::future::Future;
use std::time::Duration;

use sqlx::PgPool;
use tokio::sync::Mutex;
use tokio::time::Instant;

use super::{PROBE_TIMEOUT, STATUS_OK, StoreHealth, UNAVAILABLE, UNCONFIGURED};
use crate::store::LibraryTarget;

/// How long a probe answer is reused before the next request probes again.
pub const PROBE_CACHE_TTL: Duration = Duration::from_secs(5);

/// The database probe: the login and whether it holds the builder role (O-28).
const DATABASE_PROBE_SQL: &str =
    "select current_user::text, pg_has_role(current_user, 'builder', 'member')";

/// The two dependency checks of `/healthz`. Each answers `None` when that dependency is
/// not configured, else a future that answers whether it is healthy. The caller bounds
/// each future by [`PROBE_TIMEOUT`], so an implementation need not.
pub trait Probes: Sync {
    /// The database check: true when it answers and the login holds the builder role.
    fn database(&self) -> Option<impl Future<Output = bool> + Send>;

    /// The store's kind (`fs` or `s3`) and its check: true when it answers.
    fn store(&self) -> Option<(&'static str, impl Future<Output = bool> + Send)>;
}

/// The live checks: the builder-role pool and the library target, each when configured.
#[derive(Clone, Copy, Debug)]
pub struct LiveProbes<'a> {
    /// The pool, when the database is configured.
    pub database: Option<&'a PgPool>,
    /// The library target, when configured.
    pub target: Option<&'a LibraryTarget>,
}

impl Probes for LiveProbes<'_> {
    fn database(&self) -> Option<impl Future<Output = bool> + Send> {
        self.database.map(check_database)
    }

    fn store(&self) -> Option<(&'static str, impl Future<Output = bool> + Send)> {
        self.target.map(|target| (target.kind(), check_store(target)))
    }
}

/// What the probes found, as `/healthz` writes it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProbeReport {
    /// `unconfigured`, `ok` or `unavailable`.
    pub database: String,
    /// The store block.
    pub store: StoreHealth,
}

impl ProbeReport {
    /// Whether a configured dependency failed.
    #[must_use]
    pub fn degraded(&self) -> bool {
        let database_failed = self.database != UNCONFIGURED && self.database != STATUS_OK;
        let store_failed = self.store.kind != UNCONFIGURED && !self.store.reachable;
        database_failed || store_failed
    }
}

/// Runs both probes at once, each cut at [`PROBE_TIMEOUT`].
pub async fn run_probes<P: Probes>(probes: &P) -> ProbeReport {
    let database = async {
        match probes.database() {
            None => UNCONFIGURED,
            Some(check) => {
                if bounded("database", check).await {
                    STATUS_OK
                } else {
                    UNAVAILABLE
                }
            }
        }
    };
    let store = async {
        match probes.store() {
            None => StoreHealth { kind: UNCONFIGURED.to_owned(), reachable: false },
            Some((kind, check)) => {
                StoreHealth { kind: kind.to_owned(), reachable: bounded(kind, check).await }
            }
        }
    };
    let (database, store) = tokio::join!(database, store);
    ProbeReport { database: database.to_owned(), store }
}

/// `check`'s answer, or false (logged) when it takes longer than [`PROBE_TIMEOUT`].
async fn bounded(name: &str, check: impl Future<Output = bool>) -> bool {
    if let Ok(answer) = tokio::time::timeout(PROBE_TIMEOUT, check).await {
        answer
    } else {
        tracing::warn!(probe = name, timeout = ?PROBE_TIMEOUT, "health probe timed out");
        false
    }
}

/// The last probe answer and when it was taken, behind the single-flight mutex.
#[derive(Debug, Default)]
pub struct ProbeCache {
    last: Mutex<Option<(Instant, ProbeReport)>>,
}

impl ProbeCache {
    /// The cached answer when younger than [`PROBE_CACHE_TTL`], else a fresh one from
    /// `probes`, taken while the mutex is held so concurrent callers share it.
    pub async fn get_or_probe<P: Probes>(&self, probes: &P) -> ProbeReport {
        let mut last = self.last.lock().await;
        if let Some((taken, report)) = last.as_ref()
            && taken.elapsed() < PROBE_CACHE_TTL
        {
            return report.clone();
        }
        let report = run_probes(probes).await;
        *last = Some((Instant::now(), report.clone()));
        report
    }
}

/// True when the probe query answers and the login holds the builder role; a failure is
/// logged without the password.
async fn check_database(pool: &PgPool) -> bool {
    match sqlx::query_as::<_, (String, bool)>(DATABASE_PROBE_SQL).fetch_one(pool).await {
        Ok((_, true)) => true,
        Ok((login, false)) => {
            tracing::warn!(login, "the database login does not hold the builder role");
            false
        }
        Err(error) => {
            tracing::warn!(%error, "database probe failed");
            false
        }
    }
}

/// True when the target answers; a failure is logged.
async fn check_store(target: &LibraryTarget) -> bool {
    match target.probe().await {
        Ok(()) => true,
        Err(error) => {
            tracing::warn!(%error, kind = target.kind(), "store probe failed");
            false
        }
    }
}
