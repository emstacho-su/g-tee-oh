//! Scheduling under the storage budget (R2.16, 02 section 5.2, A5 section 4, O-204).

use std::collections::BTreeSet;

use crate::enumerate::{JobKey, JobSpec, enumerate};
use crate::error::PlanError;
use crate::reach::ReachSource;
use crate::settings::{ConfigScope, PlannerSettings};

/// The result of one planning pass.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Plan {
    /// Jobs within the budget, in priority order.
    pub queued: Vec<JobSpec>,
    /// Jobs past the budget cut, in priority order: the first job that did not fit and
    /// every job after it.
    pub blocked: Vec<JobSpec>,
    /// The bytes committed after the queued jobs: the starting figure plus their
    /// estimates.
    pub committed_bytes: u64,
}

/// Splits `candidates` (in priority order) into queued and blocked under `budget_bytes`,
/// starting from `committed_bytes`, after dropping every candidate whose key is in
/// `existing`. A candidate is queued while the running sum stays at or under the budget;
/// at the first that does not fit, it and every later candidate are blocked, so no
/// smaller job skips ahead (O-204). A sum past `u64::MAX` does not fit.
#[must_use]
pub fn schedule(
    candidates: Vec<JobSpec>,
    existing: &BTreeSet<JobKey>,
    committed_bytes: u64,
    budget_bytes: u64,
) -> Plan {
    let fresh: Vec<JobSpec> =
        candidates.into_iter().filter(|spec| !existing.contains(&spec.key())).collect();
    let mut committed = committed_bytes;
    let mut cut = fresh.len();
    for (index, spec) in fresh.iter().enumerate() {
        match committed.checked_add(spec.estimated_bytes) {
            Some(next) if next <= budget_bytes => committed = next,
            _ => {
                cut = index;
                break;
            }
        }
    }
    let mut queued = fresh;
    let blocked = queued.split_off(cut);
    Plan { queued, blocked, committed_bytes: committed }
}

/// [`enumerate`] then [`schedule`] under `settings.budget_bytes`.
///
/// # Errors
///
/// As [`enumerate`].
pub fn plan(
    scopes: &[ConfigScope],
    reach: &dyn ReachSource,
    settings: &PlannerSettings,
    existing: &BTreeSet<JobKey>,
    committed_bytes: u64,
) -> Result<Plan, PlanError> {
    let candidates = enumerate(scopes, reach, settings)?;
    Ok(schedule(candidates, existing, committed_bytes, settings.budget_bytes))
}

#[cfg(test)]
mod tests {
    use gto_model::canonical_flops;

    use super::*;

    fn job(index: usize, bytes: u64) -> JobSpec {
        JobSpec {
            game_config_id: "cfg_6_online_100".parse().expect("an id"),
            position_pair: "BB-BTN".parse().expect("a pair"),
            flop: canonical_flops()[index].flop,
            preflop_lines: vec!["r250.c".to_owned()],
            tree_config_hash: [0; 32],
            k_runouts: 20,
            priority: 1.0,
            estimated_bytes: bytes,
        }
    }

    #[test]
    fn r2_16_a_sum_past_u64_max_does_not_fit() {
        let plan = schedule(vec![job(0, 10), job(1, u64::MAX)], &BTreeSet::new(), 5, u64::MAX);
        assert_eq!(plan.queued, vec![job(0, 10)]);
        assert_eq!(plan.blocked, vec![job(1, u64::MAX)]);
        assert_eq!(plan.committed_bytes, 15);
    }

    #[test]
    fn r2_16_no_candidates_is_an_empty_plan() {
        let plan = schedule(Vec::new(), &BTreeSet::new(), 42, 100);
        assert_eq!(plan, Plan { queued: Vec::new(), blocked: Vec::new(), committed_bytes: 42 });
    }
}
