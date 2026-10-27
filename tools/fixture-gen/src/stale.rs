//! Removal of synthetic solutions an earlier run left behind (O-225).
//!
//! Mechanism. A configuration belongs to one set (`check_sets`), so after its pairs are
//! packed, every solution directory under `<out_root>/preflop/<config_id>/` is either one
//! this run wrote or a leftover. A leftover is removed only when its `manifest.json` says
//! `synthetic: true`; a directory without that flag (an own solve, a reference import or
//! anything unreadable) is left alone, so the generator can only delete what a generator
//! wrote.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use gto_library::MANIFEST_FILE;
use gto_model::ConfigId;

use crate::{GenError, Generated};

/// Removes the synthetic solutions of `config_id` under `out_root` that `kept` does not
/// list, and returns the directories removed, in name order.
pub(crate) fn remove(
    out_root: &Path,
    config_id: &ConfigId,
    kept: &[Generated],
) -> Result<Vec<PathBuf>, GenError> {
    let dir = out_root.join("preflop").join(config_id.as_str());
    let keep: BTreeSet<&str> = kept.iter().map(|s| s.solution_id.as_str()).collect();
    let io = |path: &Path, source| GenError::Io { path: path.display().to_string(), source };
    let mut entries: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map_err(|source| io(&dir, source))?
        .map(|entry| entry.map(|e| e.path()))
        .collect::<Result<_, _>>()
        .map_err(|source| io(&dir, source))?;
    entries.sort();
    let stale: Vec<PathBuf> = entries
        .into_iter()
        .filter(|path| path.is_dir())
        .filter(|path| {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default();
            !keep.contains(name) && is_synthetic(path)
        })
        .collect();
    for path in &stale {
        std::fs::remove_dir_all(path).map_err(|source| io(path, source))?;
    }
    Ok(stale)
}

/// True when the directory's manifest parses and says `synthetic: true`.
fn is_synthetic(dir: &Path) -> bool {
    std::fs::read(dir.join(MANIFEST_FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|manifest| manifest.get("synthetic").and_then(serde_json::Value::as_bool))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use gto_model::ConfigId;

    use super::remove;
    use crate::Generated;

    fn solution(root: &Path, id: &str, synthetic: bool) {
        let dir = root.join("preflop").join("cfg_6_online_100").join(id);
        std::fs::create_dir_all(&dir).expect("a directory");
        let manifest = format!("{{\"synthetic\": {synthetic}}}");
        std::fs::write(dir.join("manifest.json"), manifest).expect("a manifest");
    }

    #[test]
    fn r2_20_stale_removes_only_unlisted_synthetic_solutions() {
        let root = tempfile::tempdir().expect("a directory");
        solution(root.path(), "kept", true);
        solution(root.path(), "old", true);
        solution(root.path(), "solved", false);
        let kept = Generated {
            set: "s".into(),
            config_id: "cfg_6_online_100".into(),
            pair: "BB-BTN".into(),
            solution_id: "kept".into(),
            prefix: root.path().to_path_buf(),
        };
        let config = ConfigId::new("cfg_6_online_100").expect("an id");
        let removed = remove(root.path(), &config, &[kept]).expect("the clean-up runs");
        assert_eq!(removed.len(), 1);
        let dir = root.path().join("preflop").join("cfg_6_online_100");
        assert!(dir.join("kept").is_dir() && dir.join("solved").is_dir());
        assert!(!dir.join("old").exists());
    }
}
