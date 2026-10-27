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
/// `existing`.
#[must_use]
pub fn schedule(
    candidates: Vec<JobSpec>,
    existing: &BTreeSet<JobKey>,
    committed_bytes: u64,
    budget_bytes: u64,
) -> Plan {
    let _ = (candidates, existing, budget_bytes);
    Plan { queued: Vec::new(), blocked: Vec::new(), committed_bytes }
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
