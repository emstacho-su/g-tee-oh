//! The toolchain line every report carries: the first line of `rustc --version`. One
//! file serves two crates: the build script includes it through `#[path]` to check the
//! line it embeds, and the library exposes it so the check has a unit test (R2.4).
//!
//! Mechanism. [`first_line`] takes the first line of the compiler's output, trims it and
//! accepts it only when it starts with [`PREFIX`], so a wrapper that prints something
//! else fails the build instead of landing in a report.

/// The prefix of a `rustc --version` line.
pub const PREFIX: &str = "rustc ";

/// The first line of `stdout`, trimmed, when it starts with [`PREFIX`]; `None` otherwise.
#[must_use]
pub fn first_line(stdout: &str) -> Option<&str> {
    let line = stdout.lines().next()?.trim();
    line.starts_with(PREFIX).then_some(line)
}

#[cfg(test)]
mod tests {
    use super::first_line;

    /// R2.4 (the toolchain field of every gate report): the first line is kept, trimmed,
    /// and anything that does not start with `rustc ` is refused.
    #[test]
    fn r2_4_first_line_keeps_a_rustc_version_line_only() {
        let verbose = "rustc 1.99.1 (58cf8f9c3 2026-10-13)\nbinary: rustc\n";
        assert_eq!(first_line(verbose), Some("rustc 1.99.1 (58cf8f9c3 2026-10-13)"));
        assert_eq!(first_line("  rustc 1.99.1 (x)\r\n"), Some("rustc 1.99.1 (x)"));
        assert_eq!(first_line(""), None);
        assert_eq!(first_line("\nrustc 1.99.1"), None);
        assert_eq!(first_line("rustcx 1.0"), None);
        assert_eq!(first_line("cargo 1.99.1"), None);
    }
}
