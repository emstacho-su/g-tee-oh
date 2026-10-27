//! The health self-probe behind `library-builder healthz` (the solver-query pattern): one
//! standard-library TCP connection to `127.0.0.1:<port>`, one HTTP/1.1 `GET /healthz` with
//! `Connection: close`, the answer read to the end of the stream and its status line
//! parsed. No async runtime and no HTTP client crate, so the image needs neither curl nor
//! wget.

use std::io::{ErrorKind, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpStream};

use super::PROBE_TIMEOUT;
use crate::error::BuilderError;

/// The most the probe reads; the health body is a few hundred bytes.
const READ_LIMIT: usize = 64 * 1024;

/// The status code of the `/healthz` answer on the loopback at `port`.
///
/// # Errors
///
/// `BuilderError::Io` when the connection or the exchange fails, `BuilderError::Malformed`
/// when the first line is not an HTTP status line.
pub(super) fn healthz_status(port: u16) -> Result<u16, BuilderError> {
    let address = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port));
    let io_error = |source: std::io::Error| BuilderError::Io {
        path: format!("http://{address}/healthz"),
        source,
    };
    let mut stream = TcpStream::connect_timeout(&address, PROBE_TIMEOUT).map_err(io_error)?;
    stream.set_read_timeout(Some(PROBE_TIMEOUT)).map_err(io_error)?;
    stream.set_write_timeout(Some(PROBE_TIMEOUT)).map_err(io_error)?;
    let request = format!(
        "GET /healthz HTTP/1.1\r\nHost: {address}\r\nUser-Agent: library-builder-healthz\r\n\
         Accept: application/json\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).map_err(io_error)?;
    let raw = read_response(&mut stream).map_err(io_error)?;
    status_of(&raw).ok_or_else(|| BuilderError::Malformed {
        path: format!("http://{address}/healthz"),
        reason: format!("no HTTP status line in {:?}", first_line(&raw)),
    })
}

/// Reads until the server closes the stream or the limit is reached; a timeout after some
/// bytes arrived ends the read, so a server that keeps the connection open is still judged.
fn read_response(stream: &mut TcpStream) -> std::io::Result<Vec<u8>> {
    let mut raw = Vec::new();
    let mut chunk = [0_u8; 1024];
    while raw.len() < READ_LIMIT {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(count) => raw.extend_from_slice(&chunk[..count]),
            Err(error)
                if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut)
                    && !raw.is_empty() =>
            {
                break;
            }
            Err(error) => return Err(error),
        }
    }
    Ok(raw)
}

/// The first line of a raw answer, lossily decoded.
fn first_line(raw: &[u8]) -> String {
    String::from_utf8_lossy(raw).lines().next().unwrap_or_default().to_owned()
}

/// The code of a status line such as `HTTP/1.1 200 OK`.
fn status_of(raw: &[u8]) -> Option<u16> {
    let line = first_line(raw);
    let mut parts = line.split_whitespace();
    let version = parts.next().filter(|part| part.starts_with("HTTP/"));
    let code = parts.next().and_then(|part| part.parse::<u16>().ok());
    version.and(code)
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;

    use super::{healthz_status, status_of};
    use crate::error::BuilderError;

    #[test]
    fn r2_18_status_lines_parse() {
        assert_eq!(status_of(b"HTTP/1.1 200 OK\r\n\r\n{}"), Some(200));
        assert_eq!(status_of(b"HTTP/1.1 503 Service Unavailable\r\n\r\n"), Some(503));
        assert_eq!(status_of(b"nonsense"), None);
        assert_eq!(status_of(b""), None);
    }

    fn serve_once(answer: &'static [u8]) -> (u16, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a loopback port");
        let port = listener.local_addr().expect("bound").port();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().expect("one connection");
            let mut request = [0_u8; 1024];
            let count = socket.read(&mut request).expect("the request");
            socket.write_all(answer).expect("the answer");
            String::from_utf8_lossy(&request[..count]).into_owned()
        });
        (port, server)
    }

    #[test]
    fn r2_18_the_probe_reads_a_status_over_tcp() {
        let (port, server) =
            serve_once(b"HTTP/1.1 503 Service Unavailable\r\nconnection: close\r\n\r\n{}");
        assert_eq!(healthz_status(port).expect("an answer"), 503);
        let request = server.join().expect("the server thread");
        assert!(request.starts_with("GET /healthz HTTP/1.1\r\n"), "{request}");
    }

    #[test]
    fn r2_18_the_probe_names_a_non_http_answer_and_a_closed_port() {
        let (port, server) = serve_once(b"hello");
        assert!(matches!(healthz_status(port), Err(BuilderError::Malformed { .. })));
        server.join().expect("the server thread");
        let listener = TcpListener::bind("127.0.0.1:0").expect("a loopback port");
        let port = listener.local_addr().expect("bound").port();
        drop(listener);
        assert!(matches!(healthz_status(port), Err(BuilderError::Io { .. })));
    }
}
