//! The builder-role connection parts (O-28, O-146): `BUILDER_DB_HOST`, `BUILDER_DB_PORT`,
//! `BUILDER_DB_NAME`, `BUILDER_DB_USER`, `BUILDER_DB_PASSWORD` and `BUILDER_DB_SSLMODE`,
//! the shape solver-query reads its `QUERY_DB_*` parts in. The builder hands them to sqlx's
//! connect-options builder (`db::Db::connect_lazy`) and never parses or prints a connection
//! string, so there is no form of the configuration in which the password could sit where a
//! redaction would miss it, and no character of the password needs percent-encoding.
//! `BUILDER_DB_PASSWORD` enables the database: unset, the builder runs with the database
//! `unconfigured` (the health block says so) and every command that needs it fails with a
//! named error. The other parts take their defaults when unset and are validated whether or
//! not a password is set, so a typo never waits for the password to surface.
//!
//! [`Password`] is the one secret type of the service: its `Debug` shows [`REDACTED`]
//! (A9 section 3, a secret is never logged) and only [`Password::expose`] returns the
//! text, for the pool and the S3 client. The store configuration keeps the S3 secret key in
//! it as well (`config::store`).

use std::ffi::OsString;
use std::fmt;
use std::str::FromStr;

use super::{Error, unicode};

/// Variable naming the Postgres host, optional; [`DEFAULT_DATABASE_HOST`] when unset.
pub const DATABASE_HOST_VAR: &str = "BUILDER_DB_HOST";

/// Variable holding the Postgres port, optional; [`DEFAULT_DATABASE_PORT`] when unset.
pub const DATABASE_PORT_VAR: &str = "BUILDER_DB_PORT";

/// Variable naming the database, optional; [`DEFAULT_DATABASE_NAME`] when unset.
pub const DATABASE_NAME_VAR: &str = "BUILDER_DB_NAME";

/// Variable naming the login, optional; [`DEFAULT_DATABASE_USER`] when unset.
pub const DATABASE_USER_VAR: &str = "BUILDER_DB_USER";

/// Variable holding the login's password; set, it enables the database.
pub const DATABASE_PASSWORD_VAR: &str = "BUILDER_DB_PASSWORD";

/// Variable selecting the Secure Sockets Layer (SSL) mode, one of libpq's `sslmode` words
/// (see [`SslMode`]), optional; `prefer`, sqlx's own default, when unset.
pub const DATABASE_SSL_MODE_VAR: &str = "BUILDER_DB_SSLMODE";

/// The host when `BUILDER_DB_HOST` is unset: the address the dev profile publishes
/// Postgres on (`127.0.0.1:5432:5432` in compose), for a run on the host. Not `localhost`:
/// on Windows that resolves to `::1` first, nothing listens there, and the attempt spends
/// the probe budget before `127.0.0.1` is tried. Compose sets the service name `postgres`.
pub const DEFAULT_DATABASE_HOST: &str = "127.0.0.1";

/// The port when `BUILDER_DB_PORT` is unset: Postgres's own.
pub const DEFAULT_DATABASE_PORT: u16 = 5432;

/// The database when `BUILDER_DB_NAME` is unset: compose's `POSTGRES_DB`.
pub const DEFAULT_DATABASE_NAME: &str = "gto";

/// The login when `BUILDER_DB_USER` is unset: the builder role's login (O-28).
pub const DEFAULT_DATABASE_USER: &str = "builder_login";

/// What stands for a secret wherever the configuration is shown.
pub const REDACTED: &str = "***";

/// The parts of the builder-role connection; built only when `BUILDER_DB_PASSWORD` is set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DatabaseConfig {
    /// The Postgres host name or address.
    pub host: String,
    /// The Postgres port.
    pub port: u16,
    /// The database name.
    pub name: String,
    /// The login role.
    pub user: String,
    /// The login's password, shown redacted.
    pub password: Password,
    /// How the connection is protected.
    pub ssl_mode: SslMode,
}

/// A secret that is never printed: `Debug` shows [`REDACTED`]. The database password and
/// the S3 secret key are both held in it.
#[derive(Clone, PartialEq, Eq)]
pub struct Password(String);

impl Password {
    /// Wraps `value`.
    #[must_use]
    pub fn new(value: String) -> Self {
        Password(value)
    }

    /// The secret text, for the pool and the S3 client only.
    #[must_use]
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Password {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Password({REDACTED:?})")
    }
}

/// libpq's `sslmode` words, the set sqlx accepts; `db` maps each to sqlx's own type.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum SslMode {
    /// Never use SSL.
    Disable,
    /// Try a plain connection first, then SSL.
    Allow,
    /// Try SSL first, then a plain connection; the default.
    #[default]
    Prefer,
    /// Require SSL without checking the certificate.
    Require,
    /// Require SSL and a certificate from a trusted authority.
    VerifyCa,
    /// Require SSL, a trusted certificate and a matching host name.
    VerifyFull,
}

impl SslMode {
    /// Every mode, in libpq's order.
    pub const ALL: [SslMode; 6] = [
        SslMode::Disable,
        SslMode::Allow,
        SslMode::Prefer,
        SslMode::Require,
        SslMode::VerifyCa,
        SslMode::VerifyFull,
    ];

    /// The word as libpq and sqlx spell it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            SslMode::Disable => "disable",
            SslMode::Allow => "allow",
            SslMode::Prefer => "prefer",
            SslMode::Require => "require",
            SslMode::VerifyCa => "verify-ca",
            SslMode::VerifyFull => "verify-full",
        }
    }

    /// Every word, comma separated, for the error message.
    pub(super) fn words() -> String {
        SslMode::ALL.iter().map(|mode| mode.as_str()).collect::<Vec<_>>().join(", ")
    }
}

impl FromStr for SslMode {
    type Err = Error;

    /// Accepts the word in any case, as sqlx does.
    fn from_str(value: &str) -> Result<Self, Error> {
        SslMode::ALL
            .into_iter()
            .find(|mode| mode.as_str().eq_ignore_ascii_case(value))
            .ok_or_else(|| Error::InvalidDatabaseSslMode { value: value.to_owned() })
    }
}

impl fmt::Display for SslMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Reads the parts through `lookup` (see the module docs): every part is validated, and
/// the result is `None` without a password.
pub(super) fn read<F>(lookup: &F) -> Result<Option<DatabaseConfig>, Error>
where
    F: Fn(&str) -> Option<OsString>,
{
    let host = text_or(lookup, DATABASE_HOST_VAR, DEFAULT_DATABASE_HOST)?;
    let port = match unicode(lookup, DATABASE_PORT_VAR)? {
        Some(value) => {
            value.parse().map_err(|source| Error::InvalidDatabasePort { value, source })?
        }
        None => DEFAULT_DATABASE_PORT,
    };
    let name = text_or(lookup, DATABASE_NAME_VAR, DEFAULT_DATABASE_NAME)?;
    let user = text_or(lookup, DATABASE_USER_VAR, DEFAULT_DATABASE_USER)?;
    let ssl_mode = match unicode(lookup, DATABASE_SSL_MODE_VAR)? {
        Some(value) => value.parse()?,
        None => SslMode::default(),
    };
    let password = unicode(lookup, DATABASE_PASSWORD_VAR)?.map(Password::new);
    Ok(password.map(|password| DatabaseConfig { host, port, name, user, password, ssl_mode }))
}

/// `name` when set, else `fallback`.
pub(super) fn text_or<F>(lookup: &F, name: &'static str, fallback: &str) -> Result<String, Error>
where
    F: Fn(&str) -> Option<OsString>,
{
    Ok(unicode(lookup, name)?.unwrap_or_else(|| fallback.to_owned()))
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;

    use super::{
        DATABASE_HOST_VAR, DATABASE_NAME_VAR, DATABASE_PASSWORD_VAR, DATABASE_PORT_VAR,
        DATABASE_SSL_MODE_VAR, DATABASE_USER_VAR, DEFAULT_DATABASE_HOST, DEFAULT_DATABASE_NAME,
        DEFAULT_DATABASE_PORT, DEFAULT_DATABASE_USER, DatabaseConfig, Password, REDACTED, SslMode,
        read,
    };
    use crate::config::{Config, Error};

    /// A dev placeholder password, never a real secret.
    const PASSWORD: &str = "change-me-builder";

    fn lookup<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<OsString> + 'a {
        move |name| {
            pairs.iter().find(|(key, _)| *key == name).map(|(_, value)| OsString::from(value))
        }
    }

    #[test]
    fn r2_17_database_is_unconfigured_without_a_password() {
        assert_eq!(read(&lookup(&[])).expect("nothing set"), None);
        let host_only = lookup(&[(DATABASE_HOST_VAR, "db.internal"), (DATABASE_PASSWORD_VAR, "")]);
        assert_eq!(read(&host_only).expect("an empty password is unset"), None);
    }

    #[test]
    fn r2_17_database_parts_default_around_the_password() {
        let database = read(&lookup(&[(DATABASE_PASSWORD_VAR, PASSWORD)]))
            .expect("well formed")
            .expect("a password configures the database");
        assert_eq!(database.host, DEFAULT_DATABASE_HOST);
        assert_eq!(database.port, DEFAULT_DATABASE_PORT);
        assert_eq!(database.name, DEFAULT_DATABASE_NAME);
        assert_eq!(database.user, DEFAULT_DATABASE_USER);
        assert_eq!(database.password.expose(), PASSWORD);
        assert_eq!(database.ssl_mode, SslMode::Prefer, "sqlx's default when unset");
    }

    #[test]
    fn r2_17_database_reads_every_part_and_needs_no_encoding() {
        let odd = "p@ss/w?rd#%&=:";
        let database = read(&lookup(&[
            (DATABASE_HOST_VAR, "postgres"),
            (DATABASE_PORT_VAR, "5433"),
            (DATABASE_NAME_VAR, "gto_test"),
            (DATABASE_USER_VAR, "other_login"),
            (DATABASE_PASSWORD_VAR, odd),
            (DATABASE_SSL_MODE_VAR, "Disable"),
        ]))
        .expect("well formed")
        .expect("configured");
        assert_eq!(
            database,
            DatabaseConfig {
                host: "postgres".to_owned(),
                port: 5433,
                name: "gto_test".to_owned(),
                user: "other_login".to_owned(),
                password: Password::new(odd.to_owned()),
                ssl_mode: SslMode::Disable,
            }
        );
        assert_eq!(database.password.expose(), odd, "every character reaches the pool as is");
    }

    #[test]
    fn r2_17_database_names_a_malformed_part_even_without_a_password() {
        let error = read(&lookup(&[(DATABASE_PORT_VAR, "54x2")])).expect_err("not a port");
        assert!(matches!(error, Error::InvalidDatabasePort { ref value, .. } if value == "54x2"));
        assert!(error.to_string().contains(DATABASE_PORT_VAR), "message was {error}");

        let word = lookup(&[(DATABASE_SSL_MODE_VAR, "yes"), (DATABASE_PASSWORD_VAR, PASSWORD)]);
        let error = read(&word).expect_err("not an sslmode word");
        assert_eq!(error, Error::InvalidDatabaseSslMode { value: "yes".to_owned() });
        let message = error.to_string();
        assert!(message.contains(DATABASE_SSL_MODE_VAR), "message was {message}");
        assert!(message.contains("verify-full"), "the message lists the words: {message}");
        assert!(!message.contains(PASSWORD), "message leaks the password: {message}");
    }

    #[test]
    fn r2_17_password_is_redacted_wherever_the_config_is_shown() {
        let password = Password::new(PASSWORD.to_owned());
        assert_eq!(password.expose(), PASSWORD, "the pool gets the secret");
        assert_eq!(format!("{password:?}"), format!("Password({REDACTED:?})"));
        let config =
            Config::from_lookup(lookup(&[(DATABASE_PASSWORD_VAR, PASSWORD)])).expect("well formed");
        let shown = format!("{config:?}");
        assert!(!shown.contains(PASSWORD), "the config Debug leaks: {shown}");
        assert!(shown.contains(REDACTED), "{shown}");
        assert!(shown.contains(DEFAULT_DATABASE_USER), "the parts are shown: {shown}");
    }

    #[test]
    fn r2_17_ssl_mode_words_round_trip() {
        for mode in SslMode::ALL {
            assert_eq!(mode.as_str().parse::<SslMode>().expect("its own word"), mode);
            assert_eq!(mode.to_string(), mode.as_str());
        }
        assert_eq!("VERIFY-CA".parse::<SslMode>().expect("any case"), SslMode::VerifyCa);
        assert_eq!(SslMode::default(), SslMode::Prefer);
    }
}
