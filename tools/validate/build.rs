//! Build script of `validate`: embeds the toolchain line every gate report carries, so
//! the report names the compiler that built the tool and no process is spawned at run
//! time (R2.4).
//!
//! Mechanism. Cargo hands a build script the compiler it builds with in the `RUSTC`
//! environment variable. The script runs `$RUSTC --version` (plain `rustc` when the
//! variable is absent), keeps the first line through `toolchain::first_line` and exports
//! it as `VALIDATE_RUSTC_VERSION`, which `machine::rustc_version` reads with `env!`. It
//! emits `rerun-if-env-changed=RUSTC`, so a different compiler path reruns it; a
//! toolchain upgrade under the same path changes the fingerprint cargo keeps for every
//! unit, this script included, so the line cannot go stale. Any failure stops the build
//! with a message naming the compiler.

#![forbid(unsafe_code)]

use std::ffi::OsString;
use std::process::Command;

#[path = "src/toolchain.rs"]
mod toolchain;

/// The variable cargo sets to the compiler it builds with.
const RUSTC_ENV: &str = "RUSTC";

/// The compiler run when `RUSTC` is absent.
const RUSTC_FALLBACK: &str = "rustc";

/// The compile-time variable the library reads.
const EXPORTED_ENV: &str = "VALIDATE_RUSTC_VERSION";

fn main() -> Result<(), String> {
    println!("cargo:rerun-if-env-changed={RUSTC_ENV}");
    let rustc = std::env::var_os(RUSTC_ENV).unwrap_or_else(|| OsString::from(RUSTC_FALLBACK));
    let shown = rustc.to_string_lossy().into_owned();
    let output = Command::new(&rustc)
        .arg("--version")
        .output()
        .map_err(|error| format!("cannot start {shown}: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("{shown} --version failed: {}", stderr.trim()));
    }
    let stdout = String::from_utf8(output.stdout)
        .map_err(|error| format!("{shown} --version printed text that is not UTF-8: {error}"))?;
    let line = toolchain::first_line(&stdout).ok_or_else(|| {
        format!("{shown} --version printed {:?}, not a rustc version line", stdout.trim())
    })?;
    println!("cargo:rustc-env={EXPORTED_ENV}={line}");
    Ok(())
}
