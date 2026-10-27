//! Where the library is written (ADR 0019, O-183, plan C.6): `LIBRARY_ROOT` names a
//! directory for the `Fs` target (unit tests and the `--once` bench without `SeaweedFS`), or
//! `S3_ENDPOINT` with the library identity `S3_LIBRARY_ACCESS_KEY` and
//! `S3_LIBRARY_SECRET_KEY` and the bucket `LIBRARY_BUCKET` names the S3 (Simple Storage
//! Service) target the compose profiles use. `LIBRARY_ROOT` takes precedence when both are
//! set, so a developer whose `.env` carries the compose endpoint can still point a local
//! run at a directory. Neither set is `Unconfigured`: the health block says so and a
//! command that needs the store fails with a named error. An endpoint without both keys is
//! a configuration error naming the missing variable, so a half-set identity never runs.
//! The secret key is held in [`Password`], so it is redacted wherever the configuration is
//! shown.
//!
//! Plain HTTP to the endpoint carries the library identity's signed requests in the clear,
//! so it is allowed only where the traffic never leaves the machine or the compose network:
//! a loopback host (`127.0.0.1`, `::1`, `localhost`), the compose host `seaweedfs`, or when
//! `S3_ALLOW_HTTP=true` says the operator accepts it (PR #22 review L1). HTTPS is always
//! allowed. [`S3Config::check_endpoint`] applies the rule when the target is built, and its
//! error names the variables.

use std::ffi::OsString;
use std::fmt;
use std::net::IpAddr;
use std::path::PathBuf;

use super::database::{Password, text_or};
use super::{Error, present, unicode};

/// Variable naming the directory of the `Fs` target.
pub const LIBRARY_ROOT_VAR: &str = "LIBRARY_ROOT";

/// Variable naming the S3 endpoint, for example `http://seaweedfs:8333`.
pub const S3_ENDPOINT_VAR: &str = "S3_ENDPOINT";

/// Variable holding the library identity's access key (02 section 6.4).
pub const S3_ACCESS_KEY_VAR: &str = "S3_LIBRARY_ACCESS_KEY";

/// Variable holding the library identity's secret key.
pub const S3_SECRET_KEY_VAR: &str = "S3_LIBRARY_SECRET_KEY";

/// Variable naming the library bucket, optional; [`DEFAULT_LIBRARY_BUCKET`] when unset.
pub const LIBRARY_BUCKET_VAR: &str = "LIBRARY_BUCKET";

/// The bucket when `LIBRARY_BUCKET` is unset: the one compose's bucket-init creates.
pub const DEFAULT_LIBRARY_BUCKET: &str = "library";

/// Variable that, set to `true`, allows plain HTTP to any endpoint host.
pub const S3_ALLOW_HTTP_VAR: &str = "S3_ALLOW_HTTP";

/// The compose service name of the object store, reachable only on the compose network.
pub const COMPOSE_S3_HOST: &str = "seaweedfs";

/// The S3 target's parts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct S3Config {
    /// The endpoint, scheme included; see [`S3Config::check_endpoint`] for `http`.
    pub endpoint: String,
    /// The library identity's access key.
    pub access_key: String,
    /// The library identity's secret key, shown redacted.
    pub secret_key: Password,
    /// The bucket the builds go under.
    pub bucket: String,
    /// `S3_ALLOW_HTTP` is `true` (any letter case); any other value leaves it off.
    pub allow_http: bool,
}

/// Why an endpoint is refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EndpointError {
    /// The endpoint is not a URL with a host.
    Unparsable {
        /// The value as set.
        endpoint: String,
    },
    /// The scheme is neither `http` nor `https`.
    Scheme {
        /// The value as set.
        endpoint: String,
    },
    /// Plain HTTP to a host that is not loopback or the compose host, without
    /// `S3_ALLOW_HTTP=true`.
    PlainHttp {
        /// The value as set.
        endpoint: String,
    },
}

impl fmt::Display for EndpointError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unparsable { endpoint } => {
                write!(f, "{S3_ENDPOINT_VAR}={endpoint:?} is not a URL with a host")
            }
            Self::Scheme { endpoint } => {
                write!(f, "{S3_ENDPOINT_VAR}={endpoint:?} is neither http nor https")
            }
            Self::PlainHttp { endpoint } => write!(
                f,
                "{S3_ENDPOINT_VAR}={endpoint:?} is plain http to a host that is not loopback or \
                 {COMPOSE_S3_HOST}: use https or set {S3_ALLOW_HTTP_VAR}=true"
            ),
        }
    }
}

impl std::error::Error for EndpointError {}

impl S3Config {
    /// Whether the client may speak plain HTTP to the endpoint: `false` for `https`, `true`
    /// for an allowed `http` endpoint (see the module docs).
    ///
    /// # Errors
    ///
    /// [`EndpointError`] naming `S3_ENDPOINT` and, for plain HTTP, `S3_ALLOW_HTTP`.
    pub fn check_endpoint(&self) -> Result<bool, EndpointError> {
        let endpoint = || self.endpoint.clone();
        let url = reqwest::Url::parse(&self.endpoint)
            .map_err(|_| EndpointError::Unparsable { endpoint: endpoint() })?;
        let host =
            url.host_str().ok_or_else(|| EndpointError::Unparsable { endpoint: endpoint() })?;
        match url.scheme() {
            "https" => Ok(false),
            "http" if self.allow_http || is_local_host(host) => Ok(true),
            "http" => Err(EndpointError::PlainHttp { endpoint: endpoint() }),
            _ => Err(EndpointError::Scheme { endpoint: endpoint() }),
        }
    }
}

/// A loopback address, `localhost`, or the compose host. An IPv6 host comes in brackets.
fn is_local_host(host: &str) -> bool {
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    match bare.parse::<IpAddr>() {
        Ok(address) => address.is_loopback(),
        Err(_) => {
            bare.eq_ignore_ascii_case("localhost") || bare.eq_ignore_ascii_case(COMPOSE_S3_HOST)
        }
    }
}

/// The library target the environment selects.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoreConfig {
    /// Neither `LIBRARY_ROOT` nor `S3_ENDPOINT` is set.
    Unconfigured,
    /// Files under a directory, through gto-library's `FsStore`.
    Fs {
        /// The directory the build prefixes go under.
        root: PathBuf,
    },
    /// The library bucket through `object_store`.
    S3(S3Config),
}

impl StoreConfig {
    /// The kind the health block reports: `unconfigured`, `fs` or `s3`.
    #[must_use]
    pub const fn kind(&self) -> &'static str {
        match self {
            StoreConfig::Unconfigured => "unconfigured",
            StoreConfig::Fs { .. } => "fs",
            StoreConfig::S3(_) => "s3",
        }
    }

    /// True when a target is selected.
    #[must_use]
    pub const fn is_configured(&self) -> bool {
        !matches!(self, StoreConfig::Unconfigured)
    }
}

/// Reads the target through `lookup` (see the module docs).
pub(super) fn read<F>(lookup: &F) -> Result<StoreConfig, Error>
where
    F: Fn(&str) -> Option<OsString>,
{
    if let Some(root) = present(lookup, LIBRARY_ROOT_VAR) {
        return Ok(StoreConfig::Fs { root: PathBuf::from(root) });
    }
    let Some(endpoint) = unicode(lookup, S3_ENDPOINT_VAR)? else {
        return Ok(StoreConfig::Unconfigured);
    };
    let access_key = required(lookup, S3_ACCESS_KEY_VAR)?;
    let secret_key = Password::new(required(lookup, S3_SECRET_KEY_VAR)?);
    let bucket = text_or(lookup, LIBRARY_BUCKET_VAR, DEFAULT_LIBRARY_BUCKET)?;
    let allow_http =
        unicode(lookup, S3_ALLOW_HTTP_VAR)?.is_some_and(|value| value.eq_ignore_ascii_case("true"));
    Ok(StoreConfig::S3(S3Config { endpoint, access_key, secret_key, bucket, allow_http }))
}

/// A variable the S3 target cannot do without.
fn required<F>(lookup: &F, name: &'static str) -> Result<String, Error>
where
    F: Fn(&str) -> Option<OsString>,
{
    unicode(lookup, name)?.ok_or(Error::MissingS3Variable { name })
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;
    use std::path::PathBuf;

    use super::{
        DEFAULT_LIBRARY_BUCKET, EndpointError, LIBRARY_BUCKET_VAR, LIBRARY_ROOT_VAR,
        S3_ACCESS_KEY_VAR, S3_ALLOW_HTTP_VAR, S3_ENDPOINT_VAR, S3_SECRET_KEY_VAR, S3Config,
        StoreConfig, read,
    };
    use crate::config::{Error, Password};

    /// Dev placeholder credentials, never real secrets.
    const ACCESS: &str = "change-me-s3-library-key";
    const SECRET: &str = "change-me-s3-library-secret";

    fn lookup<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<OsString> + 'a {
        move |name| {
            pairs.iter().find(|(key, _)| *key == name).map(|(_, value)| OsString::from(value))
        }
    }

    #[test]
    fn r2_17_store_is_unconfigured_without_a_root_or_an_endpoint() {
        let store = read(&lookup(&[])).expect("nothing set");
        assert_eq!(store, StoreConfig::Unconfigured);
        assert_eq!(store.kind(), "unconfigured");
        assert!(!store.is_configured());
    }

    #[test]
    fn r2_17_library_root_selects_the_fs_target_over_s3() {
        let store = read(&lookup(&[
            (LIBRARY_ROOT_VAR, "/tmp/library"),
            (S3_ENDPOINT_VAR, "http://seaweedfs:8333"),
        ]))
        .expect("well formed");
        assert_eq!(store, StoreConfig::Fs { root: PathBuf::from("/tmp/library") });
        assert_eq!(store.kind(), "fs");
    }

    #[test]
    fn r2_17_s3_target_reads_the_library_identity_and_defaults_the_bucket() {
        let store = read(&lookup(&[
            (S3_ENDPOINT_VAR, "http://seaweedfs:8333"),
            (S3_ACCESS_KEY_VAR, ACCESS),
            (S3_SECRET_KEY_VAR, SECRET),
        ]))
        .expect("well formed");
        assert_eq!(
            store,
            StoreConfig::S3(S3Config {
                endpoint: "http://seaweedfs:8333".to_owned(),
                access_key: ACCESS.to_owned(),
                secret_key: Password::new(SECRET.to_owned()),
                bucket: DEFAULT_LIBRARY_BUCKET.to_owned(),
                allow_http: false,
            })
        );
        assert_eq!(store.kind(), "s3");
        let shown = format!("{store:?}");
        assert!(!shown.contains(SECRET), "the secret key leaks: {shown}");
        assert!(shown.contains(ACCESS), "the access key is shown: {shown}");
        let named = read(&lookup(&[
            (S3_ENDPOINT_VAR, "http://seaweedfs:8333"),
            (S3_ACCESS_KEY_VAR, ACCESS),
            (S3_SECRET_KEY_VAR, SECRET),
            (LIBRARY_BUCKET_VAR, "library-test"),
        ]))
        .expect("well formed");
        assert!(matches!(named, StoreConfig::S3(ref s3) if s3.bucket == "library-test"));
    }

    #[test]
    fn r2_17_an_endpoint_without_both_keys_names_the_missing_variable() {
        let error =
            read(&lookup(&[(S3_ENDPOINT_VAR, "http://seaweedfs:8333")])).expect_err("no keys");
        assert_eq!(error, Error::MissingS3Variable { name: S3_ACCESS_KEY_VAR });
        let error = read(&lookup(&[
            (S3_ENDPOINT_VAR, "http://seaweedfs:8333"),
            (S3_ACCESS_KEY_VAR, ACCESS),
            (S3_SECRET_KEY_VAR, ""),
        ]))
        .expect_err("an empty secret is unset");
        assert_eq!(error, Error::MissingS3Variable { name: S3_SECRET_KEY_VAR });
        assert!(error.to_string().contains(S3_SECRET_KEY_VAR), "message was {error}");
    }

    fn s3(endpoint: &str, allow: Option<&str>) -> S3Config {
        let mut pairs = vec![
            (S3_ENDPOINT_VAR, endpoint),
            (S3_ACCESS_KEY_VAR, ACCESS),
            (S3_SECRET_KEY_VAR, SECRET),
        ];
        if let Some(value) = allow {
            pairs.push((S3_ALLOW_HTTP_VAR, value));
        }
        match read(&lookup(&pairs)).expect("well formed") {
            StoreConfig::S3(s3) => s3,
            other => panic!("expected S3, got {other:?}"),
        }
    }

    #[test]
    fn r2_17_plain_http_is_allowed_only_to_loopback_or_the_compose_host() {
        for local in [
            "http://127.0.0.1:8333",
            "http://[::1]:8333",
            "http://localhost:8333",
            "http://LOCALHOST",
            "http://seaweedfs:8333",
        ] {
            assert_eq!(s3(local, None).check_endpoint(), Ok(true), "{local}");
        }
        assert_eq!(s3("https://s3.example.org", None).check_endpoint(), Ok(false));
        let remote = "http://s3.example.org:8333";
        let error = s3(remote, None).check_endpoint().expect_err("plain http off the machine");
        assert_eq!(error, EndpointError::PlainHttp { endpoint: remote.to_owned() });
        let message = error.to_string();
        assert!(
            message.contains(S3_ENDPOINT_VAR) && message.contains(S3_ALLOW_HTTP_VAR),
            "{message}"
        );
        assert_eq!(s3(remote, Some("true")).check_endpoint(), Ok(true));
        assert_eq!(s3(remote, Some("TRUE")).check_endpoint(), Ok(true));
        assert!(s3(remote, Some("yes")).check_endpoint().is_err(), "only true allows it");
        assert!(matches!(
            s3("ftp://seaweedfs", None).check_endpoint(),
            Err(EndpointError::Scheme { .. })
        ));
        assert!(matches!(
            s3("seaweedfs:8333/x", None).check_endpoint(),
            Err(EndpointError::Unparsable { .. } | EndpointError::Scheme { .. })
        ));
        assert!(matches!(
            s3("not a url", None).check_endpoint(),
            Err(EndpointError::Unparsable { .. })
        ));
    }
}
