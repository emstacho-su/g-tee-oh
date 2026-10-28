//! The spot-class catalog of `GET /v1/coverage?classes=true` (S31, O-270, R4.10, ADR 0004):
//! which spot classes a (configuration, pair) holds, how often each arises, and the nodes a
//! hand of the class is dealt at. The api's automated trainer builds its queue and its
//! frequency priors from this, so it never composes or parses a class key, a family or a
//! line itself.
//!
//! Mechanism: the chunk directory holds key hashes only, so the tree is walked from the
//! pair's root key, breadth first, over the first indexed preflop solution of the pair
//! (`Library::solutions_for`, kind `Preflop`), through the child lookup the nodes route
//! uses (`Library::next_node_keys`), at most `MAX_CLASS_WALK_NODES` nodes. The root's line
//! reach is 1; a child's is its parent's times the acting seat's reach-weighted share of
//! the action at the parent (`grade::action_shares`), so a line reach is the probability
//! that equilibrium play reaches the node. A child the equilibrium never reaches (reach 0)
//! and a child on a later street are not walked. Every preflop node classifies under the
//! catalog configuration (`SpotClass::classify`, the function behind `/v1/nodes`'s
//! `spot_class_key`) and becomes a spot of its class; history labels are the nodes route's
//! button labels (`routes::nodes::action_label`).
//!
//! A class's `line_reach` sums the reach of its first nodes along each line: a node with an
//! ancestor of the same class (a 5-bet under a 4-bet, every blind-versus-blind node under
//! the root) is a spot but adds nothing, so the sum is the probability that any decision of
//! the class arises and stays within (0, 1]. A configuration outside the v1 catalog, a pair
//! with no preflop solution, and a solution that does not hold the root list nothing; a
//! solution the reader marks unavailable is the 503 `/v1/nodes` answers.

use std::cmp::Ordering;
use std::collections::{BTreeMap, VecDeque};
use std::sync::Arc;

use gto_library::{ManifestKind, NodeView, narrow_f32};
use gto_model::{
    ActionToken, ConfigId, DepthBand, GameConfig, NodeKey, Position, PositionPair, SpotClass,
    Street, format_line, v1_configs,
};

use crate::api::coverage::{ClassHistoryEntry, ClassSpot, SpotClassEntry};
use crate::error::ApiError;
use crate::grade::{OOP_SEAT, acting_seat_or_internal, action_shares};
use crate::library::Library;
use crate::routes::nodes::action_label;

/// The most nodes one catalog walk reads (O-270): the synthetic and seeded preflop trees
/// hold far fewer, so the bound only stops a pathological tree.
pub const MAX_CLASS_WALK_NODES: usize = 512;

/// The most spots one class lists, the most frequent first (O-270).
pub const MAX_SPOTS_PER_CLASS: usize = 8;

/// The line reach of the pair's root: every hand of the pair starts there.
const ROOT_REACH: f64 = 1.0;

/// A node waiting to be read, with the line that reached it.
struct Pending {
    key: NodeKey,
    tokens: Vec<ActionToken>,
    history: Vec<ClassHistoryEntry>,
    reach: f64,
    /// The class keys of the node's ancestors, for the first-node rule of `line_reach`.
    path_classes: Vec<String>,
}

/// What the walk gathered for one class.
struct Gathered {
    family: &'static str,
    first_reach: f64,
    spots: Vec<ClassSpot>,
}

/// One walk over one solution of one pair.
struct Walk<'a> {
    library: &'a Library,
    solution_id: &'a str,
    config: &'a GameConfig,
    pair: PositionPair,
}

/// The spot classes of `pair` under `config_id`, sorted by key (see the module docs).
///
/// # Errors
///
/// `ApiError::Unavailable` when the solution is marked unavailable, `ApiError::Internal`
/// for a record no request can cause (a seat byte naming neither seat).
pub fn spot_classes(
    library: &Library,
    config_id: &ConfigId,
    pair: PositionPair,
) -> Result<Vec<SpotClassEntry>, ApiError> {
    let Some(config) = v1_configs().into_iter().find(|config| config.config_id() == *config_id)
    else {
        return Ok(Vec::new());
    };
    let Some(solution) = library
        .solutions_for(config_id, pair)
        .into_iter()
        .find(|info| info.kind == ManifestKind::Preflop)
    else {
        return Ok(Vec::new());
    };
    let walk = Walk { library, solution_id: &solution.id, config: &config, pair };
    let gathered = walk.run(NodeKey::preflop(config_id.clone(), pair, Vec::new()))?;
    Ok(gathered.into_iter().map(|(key, class)| walk.entry(key, class)).collect())
}

/// `spot_classes` on tokio's blocking pool, for the handler (the walk reads files).
///
/// # Errors
///
/// As `spot_classes`, plus `ApiError::Internal` when the blocking task did not run.
pub async fn spot_classes_blocking(
    library: Arc<Library>,
    config_id: ConfigId,
    pair: PositionPair,
) -> Result<Vec<SpotClassEntry>, ApiError> {
    tokio::task::spawn_blocking(move || spot_classes(&library, &config_id, pair))
        .await
        .map_err(|err| ApiError::Internal(format!("the class walk did not run: {err}")))?
}

impl Walk<'_> {
    /// Walks breadth first from `root` and gathers every class met, by key.
    fn run(&self, root: NodeKey) -> Result<BTreeMap<String, Gathered>, ApiError> {
        let start = Pending {
            key: root,
            tokens: Vec::new(),
            history: Vec::new(),
            reach: ROOT_REACH,
            path_classes: Vec::new(),
        };
        let mut queue = VecDeque::from([start]);
        let mut classes: BTreeMap<String, Gathered> = BTreeMap::new();
        let mut read = 0_usize;
        while let Some(pending) = queue.pop_front() {
            if read == MAX_CLASS_WALK_NODES {
                tracing::warn!(solution = self.solution_id, "the class walk stopped at its bound");
                break;
            }
            read += 1;
            let view = match self.library.node(self.solution_id, &pending.key) {
                Ok(view) => view,
                Err(ApiError::NotFound(_)) if pending.tokens.is_empty() => return Ok(classes),
                Err(error) => return Err(error),
            };
            let hero = self.hero(&view)?;
            let class_key = self.gather(&mut classes, &pending, &view, hero);
            queue.extend(self.children(&pending, &view, hero, class_key)?);
        }
        Ok(classes)
    }

    /// The seat to act at the node.
    fn hero(&self, view: &NodeView) -> Result<Position, ApiError> {
        let seat = acting_seat_or_internal(view)?;
        Ok(if seat == OOP_SEAT { self.pair.oop() } else { self.pair.ip() })
    }

    /// Adds the node to its class as a spot and returns the class key; `None` for a node
    /// with no v1 class.
    fn gather(
        &self,
        classes: &mut BTreeMap<String, Gathered>,
        pending: &Pending,
        view: &NodeView,
        hero: Position,
    ) -> Option<String> {
        let class = SpotClass::classify(self.config, &pending.key).ok()?;
        let key = class.key().ok()?.as_str().to_owned();
        let gathered = classes.entry(key.clone()).or_insert_with(|| Gathered {
            family: class.family.as_str(),
            first_reach: 0.0,
            spots: Vec::new(),
        });
        if !pending.path_classes.contains(&key) {
            gathered.first_reach += pending.reach;
        }
        gathered.spots.push(ClassSpot {
            line: (!pending.tokens.is_empty()).then(|| format_line(&pending.tokens)),
            start_node_key: pending.key.to_string(),
            hero_position: hero.as_str().to_owned(),
            pot_cbb: view.record().pot.get(),
            line_reach: narrow_f32(pending.reach),
            history: pending.history.clone(),
        });
        Some(key)
    }

    /// The preflop children the equilibrium reaches, each with its line and reach.
    fn children(
        &self,
        parent: &Pending,
        view: &NodeView,
        hero: Position,
        class_key: Option<String>,
    ) -> Result<Vec<Pending>, ApiError> {
        let tokens: Vec<ActionToken> = view.actions().iter().map(|action| action.token).collect();
        let next = self.library.next_node_keys(self.solution_id, &parent.key, &tokens)?;
        let shares = action_shares(view);
        let path_classes: Vec<String> =
            parent.path_classes.iter().cloned().chain(class_key).collect();
        let children = view
            .actions()
            .iter()
            .zip(next)
            .zip(shares)
            .filter_map(|((action, child), share)| {
                let child = child.filter(|key| key.street() == Street::Preflop)?;
                let reach = parent.reach * share;
                (reach > 0.0).then(|| Pending {
                    key: child,
                    tokens: parent.tokens.iter().copied().chain([action.token]).collect(),
                    history: parent
                        .history
                        .iter()
                        .cloned()
                        .chain([ClassHistoryEntry {
                            position: hero.as_str().to_owned(),
                            token: action.token.to_string(),
                            label: action_label(action, Street::Preflop),
                        }])
                        .collect(),
                    reach,
                    path_classes: path_classes.clone(),
                })
            })
            .collect();
        Ok(children)
    }

    /// The contract entry of one gathered class.
    fn entry(&self, spot_class_key: String, gathered: Gathered) -> SpotClassEntry {
        let mut spots = gathered.spots;
        spots.sort_by(by_reach_then_line);
        spots.truncate(MAX_SPOTS_PER_CLASS);
        SpotClassEntry {
            spot_class_key,
            family: gathered.family.to_owned(),
            format: self.config.format.as_str().to_owned(),
            depth_band: DepthBand::from_cbb(self.config.depth_cbb).as_str().to_owned(),
            table_size: self.config.table_size.get(),
            solution_id: self.solution_id.to_owned(),
            line_reach: narrow_f32(gathered.first_reach.min(ROOT_REACH)),
            spots,
        }
    }
}

/// Line reach descending, then line ascending (the root's null line first).
fn by_reach_then_line(a: &ClassSpot, b: &ClassSpot) -> Ordering {
    b.line_reach.total_cmp(&a.line_reach).then_with(|| a.line.cmp(&b.line))
}

#[cfg(test)]
mod tests;
