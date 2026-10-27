//! The seeded synthetic strategy model (O-226): never a solve.
//!
//! Mechanism. Each seat of the pair gets a score per hand class: the class's equity
//! percentile against a random hand (`inputs::class_scores`) plus seeded uniform noise of
//! half-width `SCORE_NOISE` times the class's distance from the top score, so the order of
//! the premium classes holds while the middle of the range shuffles. At every node the actions, which `gto-tree` lists from passive to
//! aggressive (fold or check, then the call or limp, then the one raise), take contiguous
//! score bands of the actor's range: the last action the top band, the first action
//! everything below the lowest threshold. Each band past the first takes a seeded share of
//! the actor's combo-weighted range drawn from `band_share`, wide for an open and narrower
//! for each later raise, and its threshold is the matching weighted quantile of the
//! scores. Across each threshold a cubic smoothstep blends the two bands, so the classes
//! near an edge mix; its half-width is `EDGE` times the score spread of the actor's range,
//! so a narrow premium range late in the tree still has pure classes; the smoothstep is the logistic curve's shape
//! built from arithmetic alone, because `exp` comes from the platform's math library and
//! may differ in the last bit between platforms, which would change the solution ids
//! (O-131). Frequencies under `MIN_FREQUENCY` are dropped and the row renormalized, so pure
//! classes exist. If a band holds no hand of the range, the edge doubles and the node is
//! recomputed, bounded by `MAX_EDGE`; an empty band past that fails the generator.
//!
//! Reach per seat is the product of that seat's own frequencies along the line; the other
//! seat's reach carries through unchanged. A node lists the classes its actor reaches.
//!
//! Expected values (EVs) follow O-224's reading in big blinds (bb): the actor's expected
//! final stack minus its stack behind, so a fold is exactly 0. The most frequent action has
//! the best EV; every other action loses a seeded positive amount, scaled by the pot and
//! growing with the class's score distance from that action's band, shrinking when the
//! action is played nearly as often as the best one. The first action's EV is fixed: 0 for
//! a fold, a share of the pot by score for a check. The best action's EV is the first
//! action's EV plus the first action's loss, and every other action sits its own loss
//! below the best.

use std::collections::BTreeMap;

use gto_model::{ActionToken, HandClass, PositionPair};
use gto_tree::{PreflopNode, PreflopTree};
use rand::Rng;
use rand_chacha::ChaCha8Rng;

use crate::GenError;
use crate::inputs::CLASSES;

/// Half-width of the uniform noise added to each seat's scores, per unit of distance from
/// the top score: about 0.04 in the middle of the range, almost none for the premiums.
const SCORE_NOISE: f64 = 0.08;
/// Half-width of the smoothstep at a band edge, per unit of the range's score spread.
const EDGE: f64 = 0.03;
/// The widest edge tried before an empty band fails the generator, per unit of spread.
const MAX_EDGE: f64 = 2.0;
/// The least gap between two thresholds per unit of spread, so every band has width.
const MIN_GAP: f64 = 0.02;
/// The least spread a range is given, so a range of one class still has an edge.
const MIN_SPREAD: f64 = 0.01;
/// Frequencies below this are dropped; the library stores them at 1/255 anyway.
const MIN_FREQUENCY: f64 = 0.001;
/// The most of the range the bands past the first may take together.
const MAX_ACTIVE_SHARE: f64 = 0.9;
/// Loss in pots per unit of score distance from an action's band.
const LOSS_PER_SCORE: f64 = 1.5;
/// The seeded part of a loss, in pots.
const LOSS_JITTER: (f64, f64) = (0.002, 0.03);
/// The least loss of an action that is not the best, in pots (5 storage units of 0.01%).
const LOSS_FLOOR: f64 = 0.0005;
/// At a check-first node, the best action's EV is this share of the pot times the score.
const CHECK_POT_SHARE: f64 = 0.5;
/// Centi-big-blinds per big blind, as a float.
const CBB_PER_BB: f64 = 100.0;

/// One class's row at a node.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct HandRow {
    /// The class index.
    pub class: u16,
    /// Reach per seat in pair order.
    pub reach: [f64; 2],
    /// One frequency per action.
    pub frequencies: Vec<f64>,
    /// One EV in bb per action.
    pub ev_bb: Vec<f64>,
}

/// Each seat's reach per class, in pair order.
type Reach = [Vec<f64>; 2];

/// The rows of every node of `tree`, in the tree's node order.
pub(crate) fn strategies(
    tree: &PreflopTree,
    base_scores: &[f64],
    rng: &mut ChaCha8Rng,
) -> Result<Vec<Vec<HandRow>>, GenError> {
    let scores: [Vec<f64>; 2] = [noisy(base_scores, rng), noisy(base_scores, rng)];
    let mut reaches: BTreeMap<Vec<ActionToken>, Reach> = BTreeMap::new();
    reaches.insert(Vec::new(), [vec![1.0; CLASSES], vec![1.0; CLASSES]]);
    let mut rows = Vec::with_capacity(tree.nodes().len());
    for node in tree.nodes() {
        let reach = reaches.remove(&node.line).ok_or_else(|| {
            GenError::Build(format!("node {:?} comes before its parent", node.line))
        })?;
        let actor = seat_of(tree.pair(), node)?;
        let plan = node_plan(node, &scores[actor], &reach[actor], rng)?;
        for (index, token) in node.actions.iter().enumerate() {
            let line = [node.line.as_slice(), &[*token]].concat();
            reaches.insert(line, child_reach(&reach, actor, &plan.frequencies, index));
        }
        rows.push(node_rows(node, &scores[actor], &reach, actor, &plan, rng));
    }
    Ok(rows)
}

/// The scores plus seeded noise that shrinks toward the top, one draw per class in index
/// order.
fn noisy(base: &[f64], rng: &mut ChaCha8Rng) -> Vec<f64> {
    base.iter()
        .map(|score| {
            let width = SCORE_NOISE * (1.0 - score).max(0.0);
            score + uniform(rng, -width, width)
        })
        .collect()
}

/// A uniform draw in `[low, high)`.
fn uniform(rng: &mut ChaCha8Rng, low: f64, high: f64) -> f64 {
    low + (high - low) * rng.random::<f64>()
}

/// The actor's index in pair order.
fn seat_of(pair: PositionPair, node: &PreflopNode) -> Result<usize, GenError> {
    if node.actor == pair.oop() {
        Ok(0)
    } else if node.actor == pair.ip() {
        Ok(1)
    } else {
        Err(GenError::Build(format!("{} acts in a {pair} tree", node.actor)))
    }
}

/// The bands of one node and every class's frequencies under them.
struct NodePlan {
    /// The thresholds between consecutive actions, ascending.
    thresholds: Vec<f64>,
    /// `frequencies[class][action]`.
    frequencies: Vec<Vec<f64>>,
}

/// Draws the band shares of a node and finds bands that each hold part of the range.
fn node_plan(
    node: &PreflopNode,
    scores: &[f64],
    reach: &[f64],
    rng: &mut ChaCha8Rng,
) -> Result<NodePlan, GenError> {
    let weights = combo_weights(reach);
    let shares = band_shares(node, rng);
    let spread = range_spread(scores, &weights);
    let thresholds = thresholds(scores, &weights, &shares, MIN_GAP * spread);
    let mut edge = EDGE * spread;
    while edge <= MAX_EDGE * spread {
        let frequencies: Vec<Vec<f64>> =
            scores.iter().map(|score| band_frequencies(*score, &thresholds, edge)).collect();
        if every_band_played(&frequencies, &weights, node.actions.len()) {
            return Ok(NodePlan { thresholds, frequencies });
        }
        edge *= 2.0;
    }
    let line = gto_model::format_line(&node.line);
    Err(GenError::Build(format!("node {line:?} has an action no hand of the range plays")))
}

/// The score range of the classes the actor reaches, at least `MIN_SPREAD`: the unit the
/// edge and the gap scale with, so a narrow premium range still has pure classes.
fn range_spread(scores: &[f64], weights: &[f64]) -> f64 {
    let reached = scores.iter().zip(weights).filter(|(_, w)| **w > 0.0).map(|(s, _)| *s);
    let (low, high) = reached
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(low, high), s| (low.min(s), high.max(s)));
    (high - low).max(MIN_SPREAD)
}

/// Combos times reach, per class.
fn combo_weights(reach: &[f64]) -> Vec<f64> {
    HandClass::all().zip(reach).map(|(class, r)| f64::from(class.combo_count()) * r).collect()
}

/// The seeded share of the range each action past the first takes, capped together.
fn band_shares(node: &PreflopNode, rng: &mut ChaCha8Rng) -> Vec<f64> {
    let raises = node.line.iter().filter(|token| token.is_aggressive()).count();
    let facing_all_in = node.line.contains(&ActionToken::AllIn);
    let drawn: Vec<f64> = node
        .actions
        .iter()
        .skip(1)
        .map(|token| {
            let (low, high) = band_share(*token, raises, facing_all_in);
            uniform(rng, low, high)
        })
        .collect();
    let total: f64 = drawn.iter().sum();
    let scale = if total > MAX_ACTIVE_SHARE { MAX_ACTIVE_SHARE / total } else { 1.0 };
    drawn.into_iter().map(|share| share * scale).collect()
}

/// The range of shares an action past the first may take: opens wide, each later raise
/// narrower; calls wider as the pot grows.
fn band_share(token: ActionToken, raises: usize, facing_all_in: bool) -> (f64, f64) {
    if token.is_aggressive() {
        return match raises {
            0 => (0.15, 0.45),
            1 => (0.06, 0.15),
            2 => (0.05, 0.12),
            _ => (0.04, 0.10),
        };
    }
    match (token, raises) {
        (ActionToken::Limp, _) => (0.03, 0.15),
        _ if facing_all_in => (0.25, 0.50),
        (_, 0 | 1) => (0.10, 0.30),
        _ => (0.20, 0.40),
    }
}

/// The thresholds between bands: for action j past the first, the weighted quantile at one
/// minus the shares of actions j and above, each at least `min_gap` above the one before.
fn thresholds(scores: &[f64], weights: &[f64], shares: &[f64], min_gap: f64) -> Vec<f64> {
    let mut order: Vec<usize> = (0..scores.len()).filter(|c| weights[*c] > 0.0).collect();
    order.sort_by(|a, b| scores[*a].total_cmp(&scores[*b]).then(a.cmp(b)));
    let total: f64 = order.iter().map(|c| weights[*c]).sum();
    let mut found: Vec<f64> = Vec::with_capacity(shares.len());
    for start in 0..shares.len() {
        let above: f64 = shares[start..].iter().sum();
        let quantile = weighted_quantile(&order, scores, weights, (1.0 - above) * total);
        let floor = found.last().map_or(f64::NEG_INFINITY, |last| last + min_gap);
        found.push(quantile.max(floor));
    }
    found
}

/// The score of the first class in `order` with at least `target` weight below it, so the
/// classes from it upward hold the rest of the range.
fn weighted_quantile(order: &[usize], scores: &[f64], weights: &[f64], target: f64) -> f64 {
    let mut below = 0.0;
    for class in order {
        if below >= target {
            return scores[*class];
        }
        below += weights[*class];
    }
    order.last().map_or(0.0, |class| scores[*class])
}

/// The cubic smoothstep: 0 below 0, 1 above 1, `3x^2 - 2x^3` between.
fn smoothstep(x: f64) -> f64 {
    let x = x.clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}

/// One class's frequencies: the share above each threshold, differenced into bands, small
/// entries dropped and the row renormalized.
fn band_frequencies(score: f64, thresholds: &[f64], edge: f64) -> Vec<f64> {
    let above: Vec<f64> =
        thresholds.iter().map(|t| smoothstep((score - t + edge) / (2.0 * edge))).collect();
    let raw: Vec<f64> = (0..=above.len())
        .map(|band| {
            let lower = if band == 0 { 1.0 } else { above[band - 1] };
            let upper = above.get(band).copied().unwrap_or(0.0);
            (lower - upper).max(0.0)
        })
        .collect();
    let kept: Vec<f64> = raw.iter().map(|f| if *f < MIN_FREQUENCY { 0.0 } else { *f }).collect();
    let sum: f64 = kept.iter().sum();
    kept.iter().map(|f| f / sum).collect()
}

/// True when every action has some weight of the range.
fn every_band_played(frequencies: &[Vec<f64>], weights: &[f64], actions: usize) -> bool {
    (0..actions).all(|action| {
        frequencies.iter().zip(weights).any(|(row, weight)| *weight > 0.0 && row[action] > 0.0)
    })
}

/// The reach after the actor takes `action`: the actor's reach times its frequency.
fn child_reach(reach: &Reach, actor: usize, frequencies: &[Vec<f64>], action: usize) -> Reach {
    let mut next = reach.clone();
    next[actor] = reach[actor].iter().zip(frequencies).map(|(r, row)| r * row[action]).collect();
    next
}

/// The rows of the classes the actor reaches, with their EVs.
fn node_rows(
    node: &PreflopNode,
    scores: &[f64],
    reach: &Reach,
    actor: usize,
    plan: &NodePlan,
    rng: &mut ChaCha8Rng,
) -> Vec<HandRow> {
    let pot_bb = f64::from(node.pot.get()) / CBB_PER_BB;
    let fold_first = node.actions.first() == Some(&ActionToken::Fold);
    (0..CLASSES)
        .filter(|class| reach[actor][*class] > 0.0)
        .map(|class| {
            let frequencies = plan.frequencies[class].clone();
            let shape = EvShape { score: scores[class], thresholds: &plan.thresholds, pot_bb };
            let ev_bb = evs(&frequencies, &shape, fold_first, rng);
            HandRow {
                class: u16::try_from(class).unwrap_or(u16::MAX),
                reach: [reach[0][class], reach[1][class]],
                frequencies,
                ev_bb,
            }
        })
        .collect()
}

/// What a class's EVs depend on besides its frequencies.
struct EvShape<'a> {
    score: f64,
    thresholds: &'a [f64],
    pot_bb: f64,
}

/// One EV per action: the most frequent best, the others below it by a seeded loss.
fn evs(
    frequencies: &[f64],
    shape: &EvShape<'_>,
    fold_first: bool,
    rng: &mut ChaCha8Rng,
) -> Vec<f64> {
    let best = frequencies
        .iter()
        .enumerate()
        .fold(0, |best, (index, f)| if *f > frequencies[best] { index } else { best });
    let losses: Vec<f64> = (0..frequencies.len())
        .map(|action| {
            let jitter = uniform(rng, LOSS_JITTER.0, LOSS_JITTER.1);
            if action == best {
                return 0.0;
            }
            let played = 1.0 - frequencies[action] / frequencies[best];
            let distance = band_distance(shape.score, shape.thresholds, action);
            shape.pot_bb * (played * (LOSS_PER_SCORE * distance + jitter) + LOSS_FLOOR)
        })
        .collect();
    let first =
        if fold_first { 0.0 } else { shape.pot_bb * CHECK_POT_SHARE * shape.score.clamp(0.0, 1.0) };
    let anchor = first + losses[0];
    losses
        .iter()
        .enumerate()
        .map(|(action, loss)| if action == 0 { first } else { anchor - loss })
        .collect()
}

/// How far a score lies outside the band of `action`, 0 inside it.
fn band_distance(score: f64, thresholds: &[f64], action: usize) -> f64 {
    let lower = if action == 0 { f64::NEG_INFINITY } else { thresholds[action - 1] };
    let upper = thresholds.get(action).copied().unwrap_or(f64::INFINITY);
    (lower - score).max(score - upper).max(0.0)
}

#[cfg(test)]
mod tests {
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;

    use super::{EvShape, band_distance, band_frequencies, evs, smoothstep, thresholds};

    #[test]
    fn r2_20_band_frequencies_are_pure_inside_and_mixed_at_an_edge() {
        let cuts = [0.4, 0.8];
        assert_eq!(band_frequencies(0.1, &cuts, 0.03), vec![1.0, 0.0, 0.0]);
        assert_eq!(band_frequencies(0.6, &cuts, 0.03), vec![0.0, 1.0, 0.0]);
        assert_eq!(band_frequencies(0.95, &cuts, 0.03), vec![0.0, 0.0, 1.0]);
        let edge = band_frequencies(0.81, &cuts, 0.03);
        assert!(edge[1] > 0.0 && edge[2] > 0.0, "{edge:?}");
        assert!((edge.iter().sum::<f64>() - 1.0).abs() < 1e-12);
        assert!((smoothstep(0.5) - 0.5).abs() < 1e-15);
    }

    #[test]
    fn r2_20_thresholds_follow_the_shares_and_keep_a_gap() {
        let scores: Vec<f64> = (0..10).map(|i| f64::from(i) / 10.0).collect();
        let weights = vec![1.0; 10];
        let found = thresholds(&scores, &weights, &[0.3, 0.2], 0.02);
        assert_eq!(found, vec![0.5, 0.8]);
        let tight = thresholds(&scores, &weights, &[0.0, 0.0], 0.02);
        assert!(tight[1] >= tight[0] + 0.02 - 1e-12, "{tight:?}");
    }

    #[test]
    fn r2_20_most_frequent_action_has_the_best_ev_and_fold_is_zero() {
        let mut rng = ChaCha8Rng::seed_from_u64(1);
        let shape = EvShape { score: 0.9, thresholds: &[0.4, 0.8], pot_bb: 1.5 };
        let ev = evs(&[0.0, 0.2, 0.8], &shape, true, &mut rng);
        assert!(ev[0].abs() < f64::EPSILON, "{ev:?}");
        assert!(ev[2] > ev[1] && ev[2] > ev[0], "{ev:?}");
        let folded = evs(&[1.0, 0.0, 0.0], &shape, true, &mut rng);
        assert!(folded[1] < 0.0 && folded[2] < 0.0, "{folded:?}");
        assert!(band_distance(0.9, &[0.4, 0.8], 0) > 0.49);
    }
}
