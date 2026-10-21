//! Unit tests of `machine` (R2.4, the machine block and provenance of every G1 to G3
//! report). The porcelain parser and the tree judgment take canned `git status` output,
//! so a dirty or clean tree is tested without touching the checkout.

use super::{
    MachineError, TreeState, check_commit, check_name, detect, judge_tree, machine_name,
    name_from_host, parse_porcelain, resolve_commit, round_to_gib, rustc_version,
};
use crate::toolchain;

/// R2.4: the name rule is the schema's pattern, and the commit rule is 40 lowercase hex
/// characters.
#[test]
fn r2_4_machine_name_and_commit_follow_the_schema_patterns() {
    assert!(check_name("zenbook").is_ok());
    assert!(check_name("github-ubuntu").is_ok());
    assert!(check_name("mac2").is_ok());
    assert!(check_name("").is_err());
    assert!(check_name("Zenbook").is_err());
    assert!(check_name("1st").is_err());
    assert!(check_name("zen book").is_err());
    assert!(check_commit("0123456789abcdef0123456789abcdef01234567").is_ok());
    assert!(check_commit("abc").is_err());
    assert!(check_commit(&"a".repeat(39)).is_err());
    assert!(check_commit(&"A".repeat(40)).is_err());
}

/// R2.4: `--machine` wins over `VALIDATE_MACHINE`, which wins over the host name; a given
/// name is checked and never rewritten; the host is asked only when neither is given.
#[test]
fn r2_4_machine_name_prefers_flag_then_env_then_host() {
    let no_host = || -> Option<String> { panic!("the host is not asked") };
    assert_eq!(
        machine_name(Some("flag-name"), Some("env-name"), no_host).ok(),
        Some("flag-name".into())
    );
    assert_eq!(machine_name(None, Some("zenbook"), no_host).ok(), Some("zenbook".into()));
    assert!(matches!(machine_name(Some("Bad Name"), None, no_host), Err(MachineError::BadName(_))));
    let host = || Some("Stack-Laptop".to_owned());
    assert_eq!(machine_name(None, None, host).ok(), Some("stack-laptop".into()));
    let error = machine_name(None, None, || None).expect_err("no name at all");
    assert!(matches!(error, MachineError::NoMachineName { .. }), "{error}");
    assert!(error.to_string().contains("VALIDATE_MACHINE"), "{error}");
}

/// R2.4: a host name is lowercased and every character outside `[a-z0-9-]` becomes a
/// dash; one that still does not start with a letter is a named error.
#[test]
fn r2_4_host_name_maps_onto_the_machine_name_pattern() {
    assert_eq!(name_from_host("ZENBOOK").ok(), Some("zenbook".into()));
    assert_eq!(name_from_host("DESKTOP_AB12.local").ok(), Some("desktop-ab12-local".into()));
    assert_eq!(name_from_host(" mac mini\n").ok(), Some("mac-mini".into()));
    assert_eq!(name_from_host("caf\u{e9}").ok(), Some("caf-".into()));
    for unusable in ["", "1host", "-host", "_x"] {
        let error = name_from_host(unusable).expect_err(unusable);
        assert!(matches!(error, MachineError::NoMachineName { .. }), "{unusable}: {error}");
    }
}

/// R2.4: canned `git status --porcelain` output: nothing is clean; a modified, staged,
/// untracked or renamed entry is dirty and names its first path (the new name for a
/// rename); a line not in the v1 form is an error naming git.
#[test]
fn r2_4_porcelain_parser_reads_clean_and_dirty_trees() {
    assert_eq!(parse_porcelain("").ok(), Some(TreeState::Clean));
    assert_eq!(parse_porcelain("\n").ok(), Some(TreeState::Clean));
    let dirty = |path: &str| Some(TreeState::Dirty { first_path: path.to_owned() });
    assert_eq!(parse_porcelain(" M justfile\n?? new.txt\n").ok(), dirty("justfile"));
    assert_eq!(
        parse_porcelain("M  tools/validate/src/main.rs\n").ok(),
        dirty("tools/validate/src/main.rs")
    );
    assert_eq!(parse_porcelain("?? scratch/\n").ok(), dirty("scratch/"));
    assert_eq!(parse_porcelain("R  old.rs -> new.rs\n").ok(), dirty("new.rs"));
    assert_eq!(parse_porcelain(" M \"with space.txt\"\r\n").ok(), dirty("\"with space.txt\""));
    for malformed in ["M", "XYZpath", " M "] {
        let error = parse_porcelain(malformed).expect_err(malformed);
        assert!(matches!(error, MachineError::Unexpected { program: "git", .. }), "{error}");
    }
}

/// R2.4: a clean tree runs and is not marked; a dirty tree without `--allow-dirty` is
/// `DirtyTree` naming the first path; with it the run goes ahead and is marked dirty.
#[test]
fn r2_4_dirty_tree_is_refused_unless_allowed() {
    let dirty = || TreeState::Dirty { first_path: "justfile".to_owned() };
    assert_eq!(judge_tree(TreeState::Clean, false).ok(), Some(false));
    assert_eq!(judge_tree(TreeState::Clean, true).ok(), Some(false));
    assert_eq!(judge_tree(dirty(), true).ok(), Some(true));
    let error = judge_tree(dirty(), false).expect_err("refused");
    assert!(matches!(&error, MachineError::DirtyTree { path } if path == "justfile"), "{error}");
    assert!(error.to_string().contains("--allow-dirty"), "{error}");
}

/// R2.4: the probes answer on the host that runs the tests, with every field inside the
/// schema's bounds, and a bad name is refused before sysinfo is asked. The commit is
/// resolved with `allow_dirty`, since a development tree may be dirty.
#[test]
fn r2_4_probes_answer_on_this_host() {
    let machine = detect("test-machine").expect("sysinfo answers");
    assert_eq!(machine.name, "test-machine");
    assert_ne!(machine.os, "");
    assert_ne!(machine.cpu, "");
    assert!(machine.cores >= 1);
    assert!(machine.memory_gb >= 1);
    assert!(detect("Bad Name").is_err());
    let resolved = resolve_commit(&crate::repo_root(), None, true).expect("git answers");
    assert!(check_commit(&resolved.commit).is_ok(), "{}", resolved.commit);
    let given = "0123456789abcdef0123456789abcdef01234567";
    let pinned = resolve_commit(&crate::repo_root(), Some(given), true).expect("given");
    assert_eq!(pinned.commit, given);
    let bad = resolve_commit(&crate::repo_root(), Some("abc"), true);
    assert!(matches!(bad, Err(MachineError::BadCommit(_))));
}

/// R2.4: the embedded toolchain line is one line that starts with `rustc `, the check the
/// build script applied, so a report never carries a wrapper's output.
#[test]
fn r2_4_embedded_toolchain_is_a_rustc_version_line() {
    let toolchain = rustc_version();
    assert!(toolchain.starts_with(toolchain::PREFIX), "{toolchain}");
    assert!(!toolchain.contains('\n') && !toolchain.contains('\r'), "{toolchain:?}");
    assert_eq!(toolchain::first_line(toolchain), Some(toolchain));
}

/// R2.4: memory rounds to the nearest gibibyte.
#[test]
fn r2_4_memory_rounds_to_the_nearest_gibibyte() {
    let gib = 1u64 << 30;
    assert_eq!(round_to_gib(0), 0);
    assert_eq!(round_to_gib(gib / 2 - 1), 0);
    assert_eq!(round_to_gib(gib / 2), 1);
    assert_eq!(round_to_gib(16 * gib - 1), 16);
    assert_eq!(round_to_gib(33_654_878_208), 31);
    assert_eq!(round_to_gib(u64::MAX), u64::MAX / gib);
}
