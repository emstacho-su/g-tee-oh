//! The health self-probe behind `solver-query healthz`: the container `HEALTHCHECK` runs
//! this subcommand, so the image needs neither curl nor wget. It opens one Transmission
//! Control Protocol (TCP) connection to the address the server is bound to (see
//! [`probe_address`]: a bind on every interface is probed through the loopback of the same
//! family), sends a single Hypertext Transfer Protocol (HTTP) `GET /healthz` with
//! `Connection: close`, reads the answer to the end of the stream and judges the status
//! line: 200 is healthy, anything else is not. The standard library's `TcpStream` is
//! enough; no async runtime is started.

use std::fmt;
use std::io::{self, ErrorKind, Read, Write};
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, SocketAddrV4, SocketAddrV6, TcpStream};
use std::time::Duration;

/// How long the probe waits to connect and for each read or write. The Dockerfile gives
/// the whole probe three seconds.
pub const TIMEOUT: Duration = Duration::from_secs(2);

/// The status that means healthy.
pub const HEALTHY_STATUS: u16 = 200;

/// The most the probe reads; the health body is a few hundred bytes.
const READ_LIMIT: usize = 64 * 1024;

/// The separator between the header block and the body.
const HEADER_END: &str = "\r\n\r\n";

/// The address to probe for a server bound at `bind`: the bind's own address and port,
/// except that an unspecified address (`0.0.0.0` or `::`, every interface) becomes the
/// loopback of the same family (`127.0.0.1` or `::1`), the one interface a listener on every
/// interface is sure to answer on. A bind on one concrete address is probed there, since
/// nothing listens on the loopback in that case.
#[must_use]
pub fn probe_address(bind: SocketAddr) -> SocketAddr {
    match bind {
        SocketAddr::V4(v4) if v4.ip().is_unspecified() => {
            SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, v4.port()))
        }
        SocketAddr::V6(v6) if v6.ip().is_unspecified() => SocketAddr::V6(SocketAddrV6::new(
            Ipv6Addr::LOCALHOST,
            v6.port(),
            v6.flowinfo(),
            v6.scope_id(),
        )),
        concrete => concrete,
    }
}

/// The request for `address`. `Connection: close` makes the server end the stream after the
/// response; `Host` carries the address the probe connects to.
fn request_for(address: SocketAddr) -> String {
    format!(
        "GET /healthz HTTP/1.1\r\n\
         Host: {address}\r\n\
         User-Agent: solver-query-healthz\r\n\
         Accept: application/json\r\n\
         Connection: close\r\n\
         \r\n"
    )
}

/// Why the probe got no status line.
#[derive(Debug)]
pub enum Error {
    /// The connection could not be opened: nothing listens, or not yet.
    Connect {
        /// The address that was tried.
        address: SocketAddr,
        /// The failure.
        source: io::Error,
    },
    /// The request could not be sent or the response could not be read.
    Io(io::Error),
    /// The first line of the answer is not an HTTP status line.
    NoStatusLine(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Connect { address, source } => write!(f, "cannot connect to {address}: {source}"),
            Self::Io(source) => write!(f, "probe failed: {source}"),
            Self::NoStatusLine(line) => write!(f, "no HTTP status line, got {line:?}"),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Connect { source, .. } | Self::Io(source) => Some(source),
            Self::NoStatusLine(_) => None,
        }
    }
}

/// What the server answered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    /// The status code from the status line.
    pub status: u16,
    /// The body after the header block, usually the health JSON.
    pub body: String,
}

impl Response {
    /// Whether the status is the healthy one.
    #[must_use]
    pub fn healthy(&self) -> bool {
        self.status == HEALTHY_STATUS
    }
}

/// Sends the probe to `address` (see [`probe_address`] for the one to use for a bind) and
/// returns the response.
///
/// # Errors
///
/// Returns [`Error::Connect`] when nothing accepts the connection, [`Error::Io`] when
/// the exchange fails and [`Error::NoStatusLine`] when the answer is not HTTP.
pub fn status(address: SocketAddr) -> Result<Response, Error> {
    let mut stream = TcpStream::connect_timeout(&address, TIMEOUT)
        .map_err(|source| Error::Connect { address, source })?;
    stream.set_read_timeout(Some(TIMEOUT)).map_err(Error::Io)?;
    stream.set_write_timeout(Some(TIMEOUT)).map_err(Error::Io)?;
    stream.write_all(request_for(address).as_bytes()).map_err(Error::Io)?;
    let raw = read_response(&mut stream)?;
    parse_response(&raw)
}

/// Reads until the server closes the stream or the limit is reached. A read timeout
/// after some bytes arrived ends the read instead of failing it, so a server that
/// ignores `Connection: close` still gets judged on what it sent.
fn read_response(stream: &mut TcpStream) -> Result<Vec<u8>, Error> {
    let mut raw = Vec::new();
    let mut chunk = [0_u8; 1024];
    while raw.len() < READ_LIMIT {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(count) => raw.extend_from_slice(&chunk[..count]),
            Err(error) if timed_out(&error) && !raw.is_empty() => break,
            Err(error) => return Err(Error::Io(error)),
        }
    }
    Ok(raw)
}

/// Whether a read error is the timeout set on the stream.
fn timed_out(error: &io::Error) -> bool {
    matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut)
}

/// Splits a raw HTTP response into its status code and body.
///
/// # Errors
///
/// Returns [`Error::NoStatusLine`] when the first line is not `HTTP/<v> <code> ...`.
pub fn parse_response(raw: &[u8]) -> Result<Response, Error> {
    let text = String::from_utf8_lossy(raw);
    let text: &str = &text;
    let (head, body) = text.split_once(HEADER_END).unwrap_or((text, ""));
    let status = parse_status_line(head.lines().next().unwrap_or_default())?;
    Ok(Response { status, body: body.to_owned() })
}

/// Reads the status code out of a status line such as `HTTP/1.1 200 OK`.
fn parse_status_line(line: &str) -> Result<u16, Error> {
    let mut parts = line.split_whitespace();
    let version = parts.next().filter(|part| part.starts_with("HTTP/"));
    let code = parts.next().and_then(|part| part.parse::<u16>().ok());
    match (version, code) {
        (Some(_), Some(code)) => Ok(code),
        _ => Err(Error::NoStatusLine(line.to_owned())),
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpListener};

    use super::{Error, Response, parse_response, probe_address, status};

    /// Parses a literal socket address in a test.
    fn address(literal: &str) -> SocketAddr {
        literal.parse().expect("a literal socket address")
    }

    #[test]
    fn r0_7_probe_targets_the_loopback_for_an_unspecified_bind() {
        assert_eq!(probe_address(address("0.0.0.0:7070")), address("127.0.0.1:7070"));
        assert_eq!(probe_address(address("[::]:7070")), address("[::1]:7070"));
        assert_eq!(probe_address(address("10.0.0.5:7070")), address("10.0.0.5:7070"));
        assert_eq!(probe_address(address("127.0.0.1:7071")), address("127.0.0.1:7071"));
    }

    const CANNED: &str = "HTTP/1.1 200 OK\r\n\
        content-type: application/json\r\n\
        content-length: 15\r\n\
        connection: close\r\n\
        \r\n\
        {\"status\":\"ok\"}";

    #[test]
    fn r0_7_probe_parses_status_and_body() {
        let response = parse_response(CANNED.as_bytes()).expect("a canned 200");
        assert_eq!(response, Response { status: 200, body: "{\"status\":\"ok\"}".to_owned() });
        assert!(response.healthy());

        let response = parse_response(b"HTTP/1.1 503 Service Unavailable\r\n\r\n").expect("a 503");
        assert_eq!(response.status, 503);
        assert!(!response.healthy());
        assert_eq!(response.body, "");

        let error = parse_response(b"not http at all").expect_err("no status line");
        assert!(matches!(error, Error::NoStatusLine(ref line) if line == "not http at all"));
    }

    #[test]
    fn r0_7_probe_reads_a_canned_response_over_tcp() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a loopback port");
        let bound = listener.local_addr().expect("the bound address");
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().expect("one connection");
            let mut request = [0_u8; 1024];
            let count = socket.read(&mut request).expect("the request arrives");
            let request = String::from_utf8_lossy(&request[..count]);
            assert!(request.starts_with("GET /healthz HTTP/1.1\r\n"), "request was {request}");
            assert!(request.contains(&format!("\r\nHost: {bound}\r\n")), "request was {request}");
            socket.write_all(CANNED.as_bytes()).expect("the answer is written");
        });

        let response = status(bound).expect("the probe reads the answer");
        server.join().expect("the server thread finishes");

        assert_eq!(response, Response { status: 200, body: "{\"status\":\"ok\"}".to_owned() });
    }

    #[test]
    fn r0_7_probe_reports_a_closed_port() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a loopback port");
        let bound = listener.local_addr().expect("the bound address");
        drop(listener);

        let error = status(bound).expect_err("nothing listens any more");
        assert!(matches!(error, Error::Connect { .. }), "error was {error}");
    }
}
