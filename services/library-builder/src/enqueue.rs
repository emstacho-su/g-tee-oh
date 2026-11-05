//! One flop build queued by hand (S20, O-61, O-510): `library-builder queue`.
//!
//! A `build_job` row needs the tree hash its configuration's convention gives now
//! ([`crate::job::resolve`] refuses any other), so a job cannot be inserted by SQL. This
//! module builds one [`JobSpec`] the way the planner does (the configuration from the v1
//! catalog, the sizing convention from the database, `gto_tree::tree_hash` of the
//! postflop tree, the pair and its lines from `gto_planner::rank_pairs`, the lines checked
//! against the range source, K by the pair's rank (`k_runouts` for the first
//! `k_frequent_pairs` pairs, `k_runouts_rare` for the rest, O-191) unless given, the planner's
//! size estimate) and writes it through [`JobQueue::write_plan`] as a one-job plan, so an
//! existing key is never duplicated. The job's priority is [`HEAD_PRIORITY`] unless given:
//! above anything the planner writes (its priorities are shares of one), so the loop claims it
//! next. When the key already exists, nothing is inserted and the command reports it and exits
//! 1; a `blocked_budget` row of that key is promoted to `queued` by `write_plan` but keeps its
//! planner priority, K and lines, so it is reported as promoted, not as queued at the head. A
//! hand-queued job is the operator's decision and is not cut by the storage budget (the
//! planner's O-204 cut applies to planned jobs). Deploy 1 under O-61 queues the O-52 line this
//! way with planning off; S20b and gap requests use the same command.

use gto_model::{Flop, PositionPair, canonical_flop};
use gto_planner::{ConfigScope, JobSpec, Plan, estimated_bytes, rank_pairs};
use gto_tree::{PreflopLine, SizingConventionSpec, TreeConfig, tree_hash, tree_hash_hex};
use serde::Serialize;

use crate::error::BuilderError;
use crate::job::{Env, catalog_config};
use crate::queue::JobQueue;
use crate::settings::BuilderSettings;

/// The priority of a hand-queued job when none is given: above every planner priority
/// (a share of one), so the job is the queue head.
pub const HEAD_PRIORITY: f64 = 1.0e9;

/// What `queue` was asked for.
#[derive(Clone, Debug, PartialEq)]
pub struct QueueRequest {
    /// `game_config.id`, in the v1 catalog.
    pub config_id: String,
    /// The pair as text, for example `BB-BTN`.
    pub pair: String,
    /// The flop as text; it is canonicalized before the row is written.
    pub flop: String,
    /// The flop lines as text, for example `r250.c`; at least one, none twice.
    pub lines: Vec<String>,
    /// Runouts to keep, else the K the planner gives the pair's rank.
    pub k_runouts: Option<u16>,
    /// The priority, else [`HEAD_PRIORITY`].
    pub priority: Option<f64>,
}

/// What `queue` wrote, printed as one JSON line.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct QueueWrite {
    /// The configuration.
    pub game_config_id: String,
    /// The pair.
    pub position_pair: String,
    /// The canonical flop the row carries.
    pub flop: String,
    /// The flop as given.
    pub given_flop: String,
    /// The lines.
    pub preflop_lines: Vec<String>,
    /// The tree hash, hexadecimal.
    pub tree_config_hash: String,
    /// Runouts to keep.
    pub k_runouts: u16,
    /// The priority written.
    pub priority: f64,
    /// The planner's size estimate for the job.
    pub estimated_bytes: u64,
    /// Rows inserted as `queued` (1 or 0).
    pub queued: u64,
    /// `blocked_budget` rows promoted to `queued` (1 or 0).
    pub promoted: u64,
}

impl QueueWrite {
    /// True when the row was inserted as asked; false when the key already exists (a promoted
    /// `blocked_budget` row keeps its planner priority, K and lines, so it is not what was asked).
    #[must_use]
    pub fn wrote(&self) -> bool {
        self.queued > 0
    }
}

/// Queues one job for `request` under `settings`.
///
/// # Errors
///
/// `BuilderError::Usage` with no line or a line given twice; `BuilderError::UnknownConfig`
/// outside the v1 catalog; the model and tree errors for a pair or flop that does not
/// parse; `BuilderError::UnknownLine` for a line the pair's tree lacks;
/// `BuilderError::MissingRanges` for a line the range source does not cover; and the
/// database errors.
pub async fn queue_one<Q: JobQueue>(
    env: &Env<Q>,
    request: &QueueRequest,
    settings: &BuilderSettings,
) -> Result<QueueWrite, BuilderError> {
    check_lines(&request.lines)?;
    let config = catalog_config(&request.config_id)?;
    let convention = env.queue.sizing_convention(&request.config_id).await?;
    let spec = SizingConventionSpec::from_json(&convention.to_string())?;
    let pair: PositionPair = request.pair.parse()?;
    let given: Flop = request.flop.parse()?;
    let (flop, _) = canonical_flop(given);
    let tree = TreeConfig::from_spec(&spec)?;
    let hash = tree_hash(&tree);
    let scope = ConfigScope { config: config.clone(), convention: spec };
    let ranked = rank_pairs(&scope, env.reach.as_ref(), &settings.planner)?;
    let ranked_pair = ranked.iter().find(|ranked| ranked.pair == pair);
    let known: Vec<String> = ranked_pair
        .map(|ranked| ranked.lines.iter().map(PreflopLine::text).collect())
        .unwrap_or_default();
    let pair_text = pair.to_string();
    for line in &request.lines {
        if !known.contains(line) {
            return Err(BuilderError::UnknownLine {
                config_id: request.config_id.clone(),
                pair: pair_text.clone(),
                line: line.clone(),
            });
        }
        // Refused here rather than parked after three failed claims (O-176, O-181).
        env.ranges.ranges(&request.config_id, &pair_text, line)?;
    }
    // The lines are known, so the pair is ranked; its K is the planner's for that rank.
    let k_runouts = request
        .k_runouts
        .or_else(|| ranked_pair.map(|ranked| ranked.k_runouts))
        .unwrap_or(settings.planner.k_runouts_rare);
    let priority = request.priority.unwrap_or(HEAD_PRIORITY);
    let estimated = estimated_bytes(request.lines.len(), k_runouts, &settings.planner);
    let job = JobSpec {
        game_config_id: config.config_id(),
        position_pair: pair,
        flop,
        preflop_lines: request.lines.clone(),
        tree_config_hash: hash,
        k_runouts,
        priority,
        estimated_bytes: estimated,
    };
    let plan = Plan { queued: vec![job], blocked: Vec::new(), committed_bytes: 0 };
    let write = env.queue.write_plan(&plan).await?;
    Ok(QueueWrite {
        game_config_id: request.config_id.clone(),
        position_pair: pair_text,
        flop: flop.to_string(),
        given_flop: request.flop.clone(),
        preflop_lines: request.lines.clone(),
        tree_config_hash: tree_hash_hex(&tree),
        k_runouts,
        priority,
        estimated_bytes: estimated,
        queued: write.queued,
        promoted: write.promoted,
    })
}

/// At least one line, none twice.
fn check_lines(lines: &[String]) -> Result<(), BuilderError> {
    if lines.is_empty() {
        return Err(BuilderError::Usage("queue needs at least one --line <text>".to_owned()));
    }
    for (index, line) in lines.iter().enumerate() {
        if lines[..index].contains(line) {
            return Err(BuilderError::Usage(format!("queue --line {line:?} is given twice")));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::check_lines;

    #[test]
    fn r2_22_lines_are_at_least_one_and_never_twice() {
        assert!(check_lines(&[]).is_err());
        assert!(check_lines(&["r250.c".to_owned()]).is_ok());
        assert!(check_lines(&["r250.c".to_owned(), "r250.r1000.c".to_owned()]).is_ok());
        assert!(check_lines(&["r250.c".to_owned(), "r250.c".to_owned()]).is_err());
    }
}
