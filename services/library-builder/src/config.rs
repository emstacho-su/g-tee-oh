//! Environment configuration for `library-builder` (S18, A5 section 1, plan section A).
//! Nothing is required to start: `BUILDER_BIND` defaults to the loopback `127.0.0.1:7071`
//! (S18 review L2; compose sets `0.0.0.0:7071` so the container network reaches it),
//! `BUILDER_THREADS` to the machine's parallelism, `BUILDER_SCRATCH_DIR` to the system
//! temporary directory (the compose tmpfs at `/tmp`), `BUILDER_WORKER_ID` to the host name
//! alone so it is stable across restarts (see the `worker` submodule for the per-process
//! nonce, the ban on `#` and why two live processes must not share an id), the
//! `BUILDER_DB_*` parts describe the builder-role connection (`database`, O-146; without
//! `BUILDER_DB_PASSWORD` the database is `unconfigured`), `LIBRARY_ROOT` or the `S3_*`
//! variables select the library target (`store`, ADR 0019),
//! `BUILDER_MEMORY_CEILING_BYTES` and `BUILDER_BUDGET_CEILING_BYTES` set the deploy-time
//! [`Limits`] no setting row can exceed (the `limits` submodule; the memory ceiling
//! defaults from the cgroup limit), and `BUILDER_RANGES_FIXTURE` names the hand-made
//! ranges file a job solves from before the
//! first packed preflop solution (O-181). A variable that is set but malformed is an error
//! at startup that names the variable, so a typo never runs on a silent default. A variable
//! set to the empty string counts as unset: that is what a blank `.env` line and compose's
//! `${VAR:-}` interpolation produce, and the documented fallback is what an operator who
//! left the value blank expects.
//!
//! The secrets are the one `Password` type, whose `Debug` shows `REDACTED` (A9 section 3);
//! no connection string is ever built or parsed, so there is no form in which a secret
//! could escape the redaction. The reader takes a lookup function so unit tests never touch
//! the process environment (mutating it is unsound across threads, and edition 2024 marks
//! it unsafe).

mod database;
mod limits;
mod store;
mod worker;

use std::ffi::OsString;
use std::fmt;
use std::net::{AddrParseError, Ipv4Addr, SocketAddr, SocketAddrV4};
use std::num::ParseIntError;
use std::path::PathBuf;

pub use database::{
    DATABASE_HOST_VAR, DATABASE_NAME_VAR, DATABASE_PASSWORD_VAR, DATABASE_PORT_VAR,
    DATABASE_SSL_MODE_VAR, DATABASE_USER_VAR, DEFAULT_DATABASE_HOST, DEFAULT_DATABASE_NAME,
    DEFAULT_DATABASE_PORT, DEFAULT_DATABASE_USER, DatabaseConfig, Password, REDACTED, SslMode,
};
pub use limits::{
    BUDGET_CEILING_VAR, CGROUP_HEADROOM_BYTES, CGROUP_MEMORY_MAX_PATH, MEMORY_CEILING_VAR,
    parse_cgroup_memory_max, read_cgroup_memory_max,
};
pub use store::{
    DEFAULT_LIBRARY_BUCKET, EndpointError, LIBRARY_BUCKET_VAR, LIBRARY_ROOT_VAR, S3_ACCESS_KEY_VAR,
    S3_ALLOW_HTTP_VAR, S3_ENDPOINT_VAR, S3_SECRET_KEY_VAR, S3Config, StoreConfig,
};
pub use worker::{NONCE_SEPARATOR, process_worker_id};

use crate::settings::Limits;

/// Variable holding the thread count the solve pool is sized from (A2 section 5).
pub const THREADS_VAR: &str = "BUILDER_THREADS";

/// Variable naming the listen address of the operations surface, `host:port`.
pub const BIND_VAR: &str = "BUILDER_BIND";

/// Variable naming the directory a build is staged in before its upload (plan C.6).
pub const SCRATCH_DIR_VAR: &str = "BUILDER_SCRATCH_DIR";

/// Variable naming this worker in `build_job.locked_by` (O-185).
pub const WORKER_ID_VAR: &str = "BUILDER_WORKER_ID";

/// Variable naming the hand-made ranges fixture (O-181, O-83).
pub const RANGES_FIXTURE_VAR: &str = "BUILDER_RANGES_FIXTURE";

/// The port the operations surface listens on when `BUILDER_BIND` is unset (A5 section 1).
pub const DEFAULT_PORT: u16 = 7071;

/// The listen address when `BUILDER_BIND` is unset: the loopback, port 7071, so a builder
/// run outside compose is not reachable from the network (S18 review L2).
pub const DEFAULT_BIND: SocketAddr =
    SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, DEFAULT_PORT));

/// The worker name when neither `BUILDER_WORKER_ID` nor a host name variable is set.
pub const DEFAULT_WORKER_NAME: &str = "builder";

/// The variables that carry the host name on Windows and on Unix, for the worker id.
const HOST_NAME_VARS: [&str; 2] = ["COMPUTERNAME", "HOSTNAME"];

/// The values the builder runs with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    /// The builder-role connection parts, when `BUILDER_DB_PASSWORD` is set (O-146).
    pub database: Option<DatabaseConfig>,
    /// The library target (ADR 0019).
    pub store: StoreConfig,
    /// The thread count the solve pool is sized from, at least 1.
    pub threads: usize,
    /// Where the operations surface listens.
    pub bind: SocketAddr,
    /// The staging directory.
    pub scratch_dir: PathBuf,
    /// This worker's stable name, without `#`; [`process_worker_id`] adds the per-process
    /// nonce a claim writes to `build_job.locked_by`.
    pub worker_id: String,
    /// The hand-made ranges fixture, when configured.
    pub ranges_fixture: Option<PathBuf>,
    /// The deploy-time ceilings on `memory_cap_bytes` and `budget_bytes`.
    pub limits: Limits,
}

/// A variable that is set but cannot be used.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    /// `BUILDER_BIND` is not a `host:port` socket address.
    InvalidBind {
        /// The value as set.
        value: String,
        /// The parse failure.
        source: AddrParseError,
    },
    /// `BUILDER_THREADS` is not a positive integer.
    InvalidThreads {
        /// The value as set.
        value: String,
        /// The parse failure, `None` for a well formed zero.
        source: Option<ParseIntError>,
    },
    /// `BUILDER_DB_PORT` is not a port number.
    InvalidDatabasePort {
        /// The value as set.
        value: String,
        /// The parse failure.
        source: ParseIntError,
    },
    /// `BUILDER_DB_SSLMODE` is not one of libpq's `sslmode` words (see [`SslMode`]).
    InvalidDatabaseSslMode {
        /// The value as set.
        value: String,
    },
    /// `S3_ENDPOINT` is set but a variable the S3 target needs is not.
    MissingS3Variable {
        /// The variable that is missing.
        name: &'static str,
    },
    /// A variable holds bytes that are not Unicode, so it cannot be parsed at all.
    NotUnicode {
        /// The variable name.
        name: &'static str,
    },
    /// The worker id (`BUILDER_WORKER_ID`, or the host name it defaults to) contains `#`,
    /// the separator of the per-process nonce.
    InvalidWorkerId {
        /// The id as read.
        value: String,
    },
    /// A ceiling variable is not a positive byte count.
    InvalidCeiling {
        /// The variable name.
        name: &'static str,
        /// The value as set.
        value: String,
        /// The parse failure, `None` for a well formed zero.
        source: Option<ParseIntError>,
    },
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidBind { value, source } => {
                write!(f, "{BIND_VAR}={value:?} is not a host:port address: {source}")
            }
            Self::InvalidThreads { value, source: Some(source) } => {
                write!(f, "{THREADS_VAR}={value:?} is not a thread count: {source}")
            }
            Self::InvalidThreads { value, source: None } => {
                write!(f, "{THREADS_VAR}={value:?} must be at least 1")
            }
            Self::InvalidDatabasePort { value, source } => {
                write!(f, "{DATABASE_PORT_VAR}={value:?} is not a port number: {source}")
            }
            Self::InvalidDatabaseSslMode { value } => {
                let words = SslMode::words();
                write!(f, "{DATABASE_SSL_MODE_VAR}={value:?} is not one of {words}")
            }
            Self::MissingS3Variable { name } => {
                write!(f, "{S3_ENDPOINT_VAR} is set but {name} is not")
            }
            Self::NotUnicode { name } => write!(f, "{name} is set but is not valid Unicode"),
            Self::InvalidWorkerId { value } => write!(
                f,
                "the worker id {value:?} ({WORKER_ID_VAR} or the host name) contains \
                 {NONCE_SEPARATOR:?}, which separates the process nonce"
            ),
            Self::InvalidCeiling { name, value, source: Some(source) } => {
                write!(f, "{name}={value:?} is not a byte count: {source}")
            }
            Self::InvalidCeiling { name, value, source: None } => {
                write!(f, "{name}={value:?} must be at least 1")
            }
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::InvalidBind { source, .. } => Some(source),
            Self::InvalidThreads { source: Some(source), .. }
            | Self::InvalidCeiling { source: Some(source), .. }
            | Self::InvalidDatabasePort { source, .. } => Some(source),
            Self::InvalidThreads { source: None, .. }
            | Self::InvalidCeiling { source: None, .. }
            | Self::InvalidDatabaseSslMode { .. }
            | Self::MissingS3Variable { .. }
            | Self::NotUnicode { .. }
            | Self::InvalidWorkerId { .. } => None,
        }
    }
}

impl Config {
    /// Reads the configuration from the process environment.
    ///
    /// # Errors
    ///
    /// Returns the first variable that is set but malformed; see [`Error`].
    pub fn from_env() -> Result<Self, Error> {
        Self::from_sources(|name| std::env::var_os(name), read_cgroup_memory_max())
    }

    /// Reads the configuration through `lookup`, which answers like `std::env::var_os`, with
    /// no cgroup limit known. A variable that is unset or set to the empty string takes its
    /// fallback.
    ///
    /// # Errors
    ///
    /// Returns the first variable that is set but malformed; see [`Error`].
    pub fn from_lookup<F>(lookup: F) -> Result<Self, Error>
    where
        F: Fn(&str) -> Option<OsString>,
    {
        Self::from_sources(lookup, None)
    }

    /// [`Config::from_lookup`] with `cgroup_memory_max`, the container's memory limit in
    /// bytes when known, as the fallback source of the memory ceiling.
    ///
    /// # Errors
    ///
    /// Returns the first variable that is set but malformed; see [`Error`].
    pub fn from_sources<F>(lookup: F, cgroup_memory_max: Option<u64>) -> Result<Self, Error>
    where
        F: Fn(&str) -> Option<OsString>,
    {
        let database = database::read(&lookup)?;
        let store = store::read(&lookup)?;
        let threads = match unicode(&lookup, THREADS_VAR)? {
            Some(value) => parse_threads(value)?,
            None => default_threads(),
        };
        let bind = match unicode(&lookup, BIND_VAR)? {
            Some(value) => value.parse().map_err(|source| Error::InvalidBind { value, source })?,
            None => DEFAULT_BIND,
        };
        let scratch_dir =
            present(&lookup, SCRATCH_DIR_VAR).map_or_else(std::env::temp_dir, PathBuf::from);
        let worker_id = match unicode(&lookup, WORKER_ID_VAR)? {
            Some(value) => value,
            None => default_worker_id(&lookup),
        };
        if worker_id.contains(NONCE_SEPARATOR) {
            return Err(Error::InvalidWorkerId { value: worker_id });
        }
        let ranges_fixture = present(&lookup, RANGES_FIXTURE_VAR).map(PathBuf::from);
        let limits = limits::read(&lookup, cgroup_memory_max)?;
        Ok(Self { database, store, threads, bind, scratch_dir, worker_id, ranges_fixture, limits })
    }
}

/// A positive thread count.
fn parse_threads(value: String) -> Result<usize, Error> {
    match value.parse::<usize>() {
        Ok(0) => Err(Error::InvalidThreads { value, source: None }),
        Ok(threads) => Ok(threads),
        Err(source) => Err(Error::InvalidThreads { value, source: Some(source) }),
    }
}

/// The machine's parallelism, or 1 when it cannot be read.
fn default_threads() -> usize {
    std::thread::available_parallelism().map_or(1, std::num::NonZeroUsize::get)
}

/// The host name from the first set host name variable, `DEFAULT_WORKER_NAME` when none
/// is; no process id, so the id is stable across restarts (S18 review MEDIUM 8).
fn default_worker_id<F>(lookup: &F) -> String
where
    F: Fn(&str) -> Option<OsString>,
{
    HOST_NAME_VARS
        .iter()
        .find_map(|name| present(lookup, name))
        .map_or_else(|| DEFAULT_WORKER_NAME.to_owned(), |v| v.to_string_lossy().into_owned())
}

/// Looks `name` up; a variable set to the empty string counts as unset (see the module docs).
fn present<F>(lookup: &F, name: &str) -> Option<OsString>
where
    F: Fn(&str) -> Option<OsString>,
{
    lookup(name).filter(|value| !value.is_empty())
}

/// Looks `name` up and requires it to be Unicode when set and non-empty.
fn unicode<F>(lookup: &F, name: &'static str) -> Result<Option<String>, Error>
where
    F: Fn(&str) -> Option<OsString>,
{
    present(lookup, name)
        .map(|value| value.into_string().map_err(|_| Error::NotUnicode { name }))
        .transpose()
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;
    use std::net::SocketAddr;
    use std::path::PathBuf;

    use super::{
        BIND_VAR, BUDGET_CEILING_VAR, CGROUP_HEADROOM_BYTES, Config, DATABASE_PASSWORD_VAR,
        DEFAULT_BIND, DEFAULT_DATABASE_HOST, DEFAULT_WORKER_NAME, Error, LIBRARY_ROOT_VAR,
        MEMORY_CEILING_VAR, RANGES_FIXTURE_VAR, SCRATCH_DIR_VAR, StoreConfig, THREADS_VAR,
        WORKER_ID_VAR, parse_cgroup_memory_max, process_worker_id,
    };
    use crate::settings::{DEFAULT_BUDGET_CEILING_BYTES, DEFAULT_MEMORY_CEILING_BYTES, Limits};

    /// A dev placeholder password, never a real secret.
    const PASSWORD: &str = "change-me-builder";

    fn lookup<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<OsString> + 'a {
        move |name| {
            pairs.iter().find(|(key, _)| *key == name).map(|(_, value)| OsString::from(value))
        }
    }

    #[test]
    fn r2_18_config_defaults_when_nothing_is_set() {
        let config = Config::from_lookup(lookup(&[])).expect("no variable is required");
        assert_eq!(config.bind, DEFAULT_BIND);
        // Loopback only (S18 review L2); compose sets 0.0.0.0:7071 for the container network.
        assert_eq!(config.bind.to_string(), "127.0.0.1:7071");
        assert_eq!(config.database, None);
        assert_eq!(config.store, StoreConfig::Unconfigured);
        assert!(config.threads >= 1);
        assert_eq!(config.scratch_dir, std::env::temp_dir());
        // The default worker id is stable across restarts: the host name alone, no process
        // id (S18 review MEDIUM 8).
        assert_eq!(config.worker_id, DEFAULT_WORKER_NAME);
        assert_eq!(config.ranges_fixture, None);
        assert_eq!(config.limits, Limits::default());
        let hosted = Config::from_lookup(lookup(&[("COMPUTERNAME", ""), ("HOSTNAME", "zenbook")]))
            .expect("a host name");
        assert_eq!(hosted.worker_id, "zenbook");
    }

    #[test]
    fn r2_18_a_worker_id_with_a_hash_is_refused() {
        let error = Config::from_lookup(lookup(&[(WORKER_ID_VAR, "zenbook#2")]))
            .expect_err("# separates the process nonce");
        assert_eq!(error, Error::InvalidWorkerId { value: "zenbook#2".to_owned() });
        assert!(error.to_string().contains(WORKER_ID_VAR), "message was {error}");
        let error = Config::from_lookup(lookup(&[("HOSTNAME", "odd#host")]))
            .expect_err("a host name with # is refused too");
        assert!(matches!(error, Error::InvalidWorkerId { .. }), "{error:?}");
    }

    #[test]
    fn r2_18_the_process_worker_id_appends_a_stable_nonce() {
        let id = process_worker_id("zenbook");
        let (stable, nonce) = id.split_once('#').expect("a # separator");
        assert_eq!(stable, "zenbook");
        let (pid, started) = nonce.split_once('-').expect("pid and start time");
        assert_eq!(u32::from_str_radix(pid, 16).expect("hex pid"), std::process::id());
        assert!(u64::from_str_radix(started, 16).expect("hex start time") > 0);
        assert_eq!(process_worker_id("zenbook"), id, "the same within one process");
    }

    #[test]
    fn r2_18_the_ceilings_come_from_the_environment_or_the_cgroup() {
        let gib = 1024 * 1024 * 1024;
        let from_cgroup = Config::from_sources(lookup(&[]), Some(5 * gib)).expect("defaults");
        assert_eq!(from_cgroup.limits.memory_ceiling_bytes, 5 * gib - CGROUP_HEADROOM_BYTES);
        assert_eq!(from_cgroup.limits.budget_ceiling_bytes, DEFAULT_BUDGET_CEILING_BYTES);
        let tiny = Config::from_sources(lookup(&[]), Some(gib / 2)).expect("defaults");
        assert_eq!(tiny.limits.memory_ceiling_bytes, gib / 4, "half a limit under the headroom");
        let no_cgroup = Config::from_sources(lookup(&[]), None).expect("defaults");
        assert_eq!(no_cgroup.limits.memory_ceiling_bytes, DEFAULT_MEMORY_CEILING_BYTES);
        let set = Config::from_sources(
            lookup(&[(MEMORY_CEILING_VAR, "3000000000"), (BUDGET_CEILING_VAR, "1000000")]),
            Some(5 * gib),
        )
        .expect("well formed");
        assert_eq!(set.limits.memory_ceiling_bytes, 3_000_000_000, "the variable wins");
        assert_eq!(set.limits.budget_ceiling_bytes, 1_000_000);
        for bad in ["lots", "0", "-1"] {
            let error = Config::from_lookup(lookup(&[(MEMORY_CEILING_VAR, bad)]))
                .expect_err("not a positive byte count");
            assert!(
                matches!(error, Error::InvalidCeiling { name, .. } if name == MEMORY_CEILING_VAR)
            );
            assert!(error.to_string().contains(MEMORY_CEILING_VAR), "message was {error}");
        }
        assert_eq!(parse_cgroup_memory_max("5368709120\n"), Some(5 * gib));
        assert_eq!(parse_cgroup_memory_max("max\n"), None);
        assert_eq!(parse_cgroup_memory_max(""), None);
    }

    #[test]
    fn r2_18_config_reads_every_variable() {
        let config = Config::from_lookup(lookup(&[
            (BIND_VAR, "127.0.0.1:7072"),
            (THREADS_VAR, "6"),
            (SCRATCH_DIR_VAR, "/tmp/builder"),
            (WORKER_ID_VAR, "zenbook-1"),
            (RANGES_FIXTURE_VAR, "validation/fixtures/builder/tiny-bb-btn-srp.json"),
            (LIBRARY_ROOT_VAR, "/tmp/library"),
            (DATABASE_PASSWORD_VAR, PASSWORD),
        ]))
        .expect("every value is well formed");
        let expected: SocketAddr = "127.0.0.1:7072".parse().expect("a literal address");
        assert_eq!(config.bind, expected);
        assert_eq!(config.threads, 6);
        assert_eq!(config.scratch_dir, PathBuf::from("/tmp/builder"));
        assert_eq!(config.worker_id, "zenbook-1");
        assert_eq!(
            config.ranges_fixture,
            Some(PathBuf::from("validation/fixtures/builder/tiny-bb-btn-srp.json"))
        );
        assert_eq!(config.store, StoreConfig::Fs { root: PathBuf::from("/tmp/library") });
        let database = config.database.expect("a password configures the database");
        assert_eq!(database.password.expose(), PASSWORD);
        assert_eq!(database.host, DEFAULT_DATABASE_HOST, "the other parts default");
    }

    #[test]
    fn r2_18_config_treats_an_empty_variable_as_unset() {
        let config = Config::from_lookup(lookup(&[
            (BIND_VAR, ""),
            (THREADS_VAR, ""),
            (SCRATCH_DIR_VAR, ""),
            (RANGES_FIXTURE_VAR, ""),
            (LIBRARY_ROOT_VAR, ""),
            (DATABASE_PASSWORD_VAR, ""),
        ]))
        .expect("an empty value is the documented fallback, not a malformed value");
        assert_eq!(config.bind, DEFAULT_BIND);
        assert_eq!(config.database, None);
        assert_eq!(config.store, StoreConfig::Unconfigured);
        assert_eq!(config.ranges_fixture, None);
    }

    #[test]
    fn r2_18_config_names_the_malformed_variable() {
        let error = Config::from_lookup(lookup(&[(THREADS_VAR, "four")]))
            .expect_err("a word is not a thread count");
        assert!(matches!(error, Error::InvalidThreads { ref value, .. } if value == "four"));
        assert!(error.to_string().contains(THREADS_VAR), "message was {error}");

        let error = Config::from_lookup(lookup(&[(THREADS_VAR, "0")])).expect_err("zero threads");
        assert_eq!(error, Error::InvalidThreads { value: "0".to_owned(), source: None });
        assert!(error.to_string().contains("at least 1"), "message was {error}");

        let error = Config::from_lookup(lookup(&[(BIND_VAR, "7071")]))
            .expect_err("a bare port is not an address");
        assert!(matches!(error, Error::InvalidBind { ref value, .. } if value == "7071"));
        assert!(error.to_string().contains(BIND_VAR), "message was {error}");
    }
}
