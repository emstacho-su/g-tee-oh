//! Environment configuration for `solver-query`. Nothing is required: `SOLVER_QUERY_BIND`
//! defaults to `0.0.0.0:7070` (A5 section 1), `FIXTURE_LIBRARY_PATH` names the library
//! directory the registry scans at startup and the health response reports (O-62, O-144),
//! `QUERY_CACHE_BYTES` is the reader's chunk cache budget (`DEFAULT_QUERY_CACHE_BYTES`
//! when unset), `QUERY_DATABASE_URL` is the query-role connection string (O-146; without
//! it the database is `unconfigured`), and `SOLVER_QUERY_LOG` selects the log format. A
//! variable that is set but malformed is an error at startup that names the variable, so
//! a typo never runs on a silent default. A variable set to the empty string counts as
//! unset: that is what a blank `.env` line and compose's `${VAR:-}` interpolation produce,
//! and the documented fallback is what an operator who left the value blank expects.
//!
//! The connection string holds a password, so it lives in `DatabaseUrl`, whose `Debug` and
//! `Display` show the scheme, user and host with the password replaced (A9 section 3: the
//! password is never logged); only `DatabaseUrl::as_str` hands the secret to the pool.
//!
//! The reader takes a lookup function so unit tests never touch the process environment
//! (mutating it is unsound across threads, and edition 2024 marks it unsafe).

use std::ffi::OsString;
use std::fmt;
use std::net::{AddrParseError, Ipv4Addr, SocketAddr, SocketAddrV4};
use std::num::ParseIntError;
use std::path::PathBuf;

use gto_library::DEFAULT_QUERY_CACHE_BYTES;

/// Variable naming the listen address, `host:port`.
pub const BIND_VAR: &str = "SOLVER_QUERY_BIND";

/// Variable naming the fixture library directory (O-62).
pub const FIXTURE_LIBRARY_VAR: &str = "FIXTURE_LIBRARY_PATH";

/// Variable holding the chunk cache budget in bytes.
pub const CACHE_BYTES_VAR: &str = "QUERY_CACHE_BYTES";

/// Variable holding the query-role connection string (O-146), optional.
pub const DATABASE_URL_VAR: &str = "QUERY_DATABASE_URL";

/// Variable selecting the log format: `json` for one JavaScript Object Notation (JSON)
/// object per line, `text` or unset for the human format.
pub const LOG_FORMAT_VAR: &str = "SOLVER_QUERY_LOG";

/// The port the service listens on when `SOLVER_QUERY_BIND` is unset (A5 section 1).
pub const DEFAULT_PORT: u16 = 7070;

/// The listen address when `SOLVER_QUERY_BIND` is unset: every interface, port 7070.
pub const DEFAULT_BIND: SocketAddr =
    SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, DEFAULT_PORT));

/// The schemes a `QUERY_DATABASE_URL` may start with.
pub const DATABASE_URL_SCHEMES: [&str; 2] = ["postgres://", "postgresql://"];

/// What replaces the password when a connection string is shown.
pub const REDACTED_PASSWORD: &str = "***";

/// The values the service runs with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    /// Where the server listens.
    pub bind: SocketAddr,
    /// The fixture library directory, when configured.
    pub fixture_library_path: Option<PathBuf>,
    /// The chunk cache budget in bytes, when configured; see [`Config::cache_bytes`].
    pub query_cache_bytes: Option<u64>,
    /// The query-role connection string, when configured.
    pub query_database_url: Option<DatabaseUrl>,
    /// Whether logs are emitted as JSON lines.
    pub log_json: bool,
}

/// A Postgres connection string whose password is never printed.
#[derive(Clone, PartialEq, Eq)]
pub struct DatabaseUrl(String);

impl DatabaseUrl {
    /// Accepts a string starting with one of [`DATABASE_URL_SCHEMES`].
    ///
    /// # Errors
    ///
    /// [`Error::InvalidDatabaseUrl`], which names the variable and never the value.
    pub fn new(value: String) -> Result<Self, Error> {
        if DATABASE_URL_SCHEMES.iter().any(|scheme| value.starts_with(scheme)) {
            Ok(DatabaseUrl(value))
        } else {
            Err(Error::InvalidDatabaseUrl)
        }
    }

    /// The connection string with its password, for the pool only.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The connection string with the password replaced by [`REDACTED_PASSWORD`]: the
    /// text up to the user name, then the host and the rest. A string without userinfo is
    /// shown as is.
    #[must_use]
    pub fn redacted(&self) -> String {
        let url = &self.0;
        let Some(scheme_end) = url.find("://") else {
            return url.clone();
        };
        let rest = &url[scheme_end + 3..];
        let authority = &rest[..rest.find('/').unwrap_or(rest.len())];
        let Some(at) = authority.rfind('@') else {
            return url.clone();
        };
        let user = authority[..at].split(':').next().unwrap_or_default();
        format!("{}://{user}:{REDACTED_PASSWORD}@{}", &url[..scheme_end], &rest[at + 1..])
    }
}

impl fmt::Debug for DatabaseUrl {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "DatabaseUrl({:?})", self.redacted())
    }
}

impl fmt::Display for DatabaseUrl {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.redacted())
    }
}

/// A variable that is set but cannot be used.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    /// `SOLVER_QUERY_BIND` is not a `host:port` socket address.
    InvalidBind {
        /// The value as set.
        value: String,
        /// The parse failure.
        source: AddrParseError,
    },
    /// `QUERY_CACHE_BYTES` is not an unsigned integer.
    InvalidCacheBytes {
        /// The value as set.
        value: String,
        /// The parse failure.
        source: ParseIntError,
    },
    /// `QUERY_DATABASE_URL` does not start with a Postgres scheme; the value is a secret
    /// and is not carried here.
    InvalidDatabaseUrl,
    /// `SOLVER_QUERY_LOG` is neither `json` nor `text`.
    InvalidLogFormat {
        /// The value as set.
        value: String,
    },
    /// A variable holds bytes that are not Unicode, so it cannot be parsed at all.
    NotUnicode {
        /// The variable name.
        name: &'static str,
    },
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidBind { value, source } => {
                write!(f, "{BIND_VAR}={value:?} is not a host:port address: {source}")
            }
            Self::InvalidCacheBytes { value, source } => {
                write!(f, "{CACHE_BYTES_VAR}={value:?} is not a byte count: {source}")
            }
            Self::InvalidDatabaseUrl => {
                let schemes = DATABASE_URL_SCHEMES.join(" or ");
                write!(f, "{DATABASE_URL_VAR} must start with {schemes}; the value is not shown")
            }
            Self::InvalidLogFormat { value } => {
                write!(f, "{LOG_FORMAT_VAR}={value:?} is neither json nor text")
            }
            Self::NotUnicode { name } => write!(f, "{name} is set but is not valid Unicode"),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::InvalidBind { source, .. } => Some(source),
            Self::InvalidCacheBytes { source, .. } => Some(source),
            Self::InvalidDatabaseUrl | Self::InvalidLogFormat { .. } | Self::NotUnicode { .. } => {
                None
            }
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
        Self::from_lookup(|name| std::env::var_os(name))
    }

    /// Reads the configuration through `lookup`, which answers like `std::env::var_os`. A
    /// variable that is unset or set to the empty string takes its fallback.
    ///
    /// # Errors
    ///
    /// Returns the first variable that is set but malformed; see [`Error`].
    pub fn from_lookup<F>(lookup: F) -> Result<Self, Error>
    where
        F: Fn(&str) -> Option<OsString>,
    {
        let bind = match unicode(&lookup, BIND_VAR)? {
            Some(value) => value.parse().map_err(|source| Error::InvalidBind { value, source })?,
            None => DEFAULT_BIND,
        };
        let fixture_library_path = present(&lookup, FIXTURE_LIBRARY_VAR).map(PathBuf::from);
        let query_cache_bytes = match unicode(&lookup, CACHE_BYTES_VAR)? {
            Some(value) => {
                Some(value.parse().map_err(|source| Error::InvalidCacheBytes { value, source })?)
            }
            None => None,
        };
        let query_database_url =
            unicode(&lookup, DATABASE_URL_VAR)?.map(DatabaseUrl::new).transpose()?;
        let log_json = match unicode(&lookup, LOG_FORMAT_VAR)?.as_deref() {
            Some("json") => true,
            None | Some("text") => false,
            Some(other) => return Err(Error::InvalidLogFormat { value: other.to_owned() }),
        };
        Ok(Self { bind, fixture_library_path, query_cache_bytes, query_database_url, log_json })
    }

    /// The chunk cache budget: `QUERY_CACHE_BYTES`, or the library default when unset.
    #[must_use]
    pub fn cache_bytes(&self) -> u64 {
        self.query_cache_bytes.unwrap_or(DEFAULT_QUERY_CACHE_BYTES)
    }
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

    use gto_library::DEFAULT_QUERY_CACHE_BYTES;

    use super::{
        BIND_VAR, CACHE_BYTES_VAR, Config, DATABASE_URL_VAR, DEFAULT_BIND, DatabaseUrl, Error,
        FIXTURE_LIBRARY_VAR, LOG_FORMAT_VAR,
    };

    /// A connection string with a dev placeholder password, never a real secret.
    const URL: &str = "postgres://query_login:change-me-query@localhost:5432/gto?sslmode=disable";
    const SHOWN: &str = "postgres://query_login:***@localhost:5432/gto?sslmode=disable";

    fn lookup<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<OsString> + 'a {
        move |name| {
            pairs.iter().find(|(key, _)| *key == name).map(|(_, value)| OsString::from(value))
        }
    }

    #[test]
    fn r0_7_config_defaults_when_nothing_is_set() {
        let config = Config::from_lookup(lookup(&[])).expect("no variable is required");
        assert_eq!(config.bind, DEFAULT_BIND);
        assert_eq!(config.bind.to_string(), "0.0.0.0:7070");
        assert_eq!(config.fixture_library_path, None);
        assert_eq!(config.query_cache_bytes, None);
        assert_eq!(config.cache_bytes(), DEFAULT_QUERY_CACHE_BYTES);
        assert_eq!(config.query_database_url, None);
        assert!(!config.log_json);
    }

    #[test]
    fn r0_7_config_reads_every_variable() {
        let config = Config::from_lookup(lookup(&[
            (BIND_VAR, "127.0.0.1:7071"),
            (FIXTURE_LIBRARY_VAR, "/fixtures/library"),
            (CACHE_BYTES_VAR, "268435456"),
            (DATABASE_URL_VAR, URL),
            (LOG_FORMAT_VAR, "json"),
        ]))
        .expect("every value is well formed");
        let expected: SocketAddr = "127.0.0.1:7071".parse().expect("a literal address");
        assert_eq!(config.bind, expected);
        assert_eq!(config.fixture_library_path, Some(PathBuf::from("/fixtures/library")));
        assert_eq!(config.query_cache_bytes, Some(268_435_456));
        assert_eq!(config.cache_bytes(), 268_435_456);
        assert_eq!(config.query_database_url.as_ref().map(DatabaseUrl::as_str), Some(URL));
        assert!(config.log_json);
    }

    #[test]
    fn r0_7_config_treats_an_empty_variable_as_unset() {
        let config = Config::from_lookup(lookup(&[
            (BIND_VAR, ""),
            (FIXTURE_LIBRARY_VAR, ""),
            (CACHE_BYTES_VAR, ""),
            (DATABASE_URL_VAR, ""),
            (LOG_FORMAT_VAR, ""),
        ]))
        .expect("an empty value is the documented fallback, not a malformed value");
        assert_eq!(config.bind, DEFAULT_BIND);
        assert_eq!(config.fixture_library_path, None);
        assert_eq!(config.query_cache_bytes, None);
        assert_eq!(config.query_database_url, None);
        assert!(!config.log_json);
    }

    #[test]
    fn r0_7_config_names_the_malformed_variable() {
        let error = Config::from_lookup(lookup(&[(CACHE_BYTES_VAR, "256MB")]))
            .expect_err("a unit suffix is not a byte count");
        assert!(matches!(error, Error::InvalidCacheBytes { ref value, .. } if value == "256MB"));
        assert!(error.to_string().contains(CACHE_BYTES_VAR), "message was {error}");

        let error = Config::from_lookup(lookup(&[(BIND_VAR, "7070")]))
            .expect_err("a bare port is not an address");
        assert!(matches!(error, Error::InvalidBind { ref value, .. } if value == "7070"));
        assert!(error.to_string().contains(BIND_VAR), "message was {error}");

        let error = Config::from_lookup(lookup(&[(LOG_FORMAT_VAR, "yaml")]))
            .expect_err("only json and text are log formats");
        assert_eq!(error, Error::InvalidLogFormat { value: "yaml".to_owned() });
        assert!(error.to_string().contains(LOG_FORMAT_VAR), "message was {error}");
    }

    #[test]
    fn r2_13_database_url_is_redacted_wherever_it_is_shown() {
        let url = DatabaseUrl::new(URL.to_owned()).expect("a postgres scheme");
        assert_eq!(url.as_str(), URL, "the pool gets the secret");
        assert_eq!(url.redacted(), SHOWN);
        assert_eq!(url.to_string(), SHOWN);
        assert_eq!(format!("{url:?}"), format!("DatabaseUrl({SHOWN:?})"));
        let config = Config::from_lookup(lookup(&[(DATABASE_URL_VAR, URL)])).expect("well formed");
        let shown = format!("{config:?}");
        assert!(!shown.contains("change-me-query"), "the config Debug leaks: {shown}");
        assert!(shown.contains(SHOWN), "{shown}");

        let plain = DatabaseUrl::new("postgresql://localhost/gto".to_owned()).expect("no userinfo");
        assert_eq!(plain.redacted(), "postgresql://localhost/gto");
        let odd = DatabaseUrl::new("postgres://u:p@ss@host/db".to_owned()).expect("an @ inside");
        assert_eq!(odd.redacted(), "postgres://u:***@host/db", "the last @ ends the userinfo");
    }

    #[test]
    fn r2_13_database_url_needs_a_postgres_scheme_and_the_error_hides_the_value() {
        let error = Config::from_lookup(lookup(&[(DATABASE_URL_VAR, "mysql://x:secret@h/d")]))
            .expect_err("not a postgres scheme");
        assert_eq!(error, Error::InvalidDatabaseUrl);
        let message = error.to_string();
        assert!(message.contains(DATABASE_URL_VAR), "message was {message}");
        assert!(!message.contains("secret"), "message leaks the value: {message}");
    }
}
