//! The exact push/fold solve of gate G6a (R2.19, O-223): CFR+ in matrix form to locate
//! the support, then the indifference refinement.
//!
//! Mechanism. In the push/fold game the button's (BTN) gain from pushing over folding
//! with class `i` is linear in the big blind's (BB) call frequencies `c`:
//! `B = base + U c`, and the BB's gain from calling over folding with class `j`, weighted
//! by how often the button pushes each class `p`, is `A = V p`. Both matrices come from
//! the game's three terminals and the class pair weights, so card removal stays exact.
//! Counterfactual regret minimization plus (CFR+) runs on these two vectors (alternating
//! updates, linear averaging) to find which classes mix. The refinement then fixes every
//! other class to its pure action and solves the mixed classes from the indifference
//! equations: the BB's mixed classes must be indifferent (`A_j = 0`), which fixes the
//! button's mixed frequencies, and the button's mixed classes (`B_i = 0`) fix the BB's.
//! Each system is square when both sides mix the same number of classes and is solved by
//! Gaussian elimination in f64. The pure classes are then reset to their best response
//! and the systems solved again until nothing changes. A support whose solution leaves
//! [0, 1], or whose gains exceed the certificate, is rejected; candidate supports are the
//! classes the CFR+ average mixes most, from none up to two per side, and when none
//! certifies, CFR+ runs longer and the search repeats, a bounded number of times.

use super::cfr::{Profile, gains};
use super::game::{CLASSES, Child, Layout, Terminal, game_error};
use super::{PreflopError, is_certified, linalg};

/// CFR+ iterations before the first refinement.
const FIRST_ITERATIONS: u32 = 256;

/// Refinement rounds; CFR+ runs as many iterations again before each later round.
const ROUNDS: u32 = 8;

/// The classes per side, ranked by how mixed the CFR+ average plays them, a support
/// candidate is drawn from.
const CANDIDATES_PER_SIDE: usize = 4;

/// The most classes per side a candidate support mixes.
const MOST_MIXED_PER_SIDE: usize = 2;

/// How often the pure classes are reset to their best response per candidate.
const POLISH_ROUNDS: usize = 8;

/// How far outside [0, 1] a solved frequency may land from rounding before it is clamped.
const FREQUENCY_SLACK: f64 = 1e-12;

/// The push/fold game as two linear maps (see the module docs).
struct PushFold {
    /// The button's push-over-fold gain per class when the BB never calls.
    base: Vec<f64>,
    /// `push_gain[i x CLASSES + j]`: what one unit of BB call frequency with `j` adds.
    push_gain: Vec<f64>,
    /// `call_gain[j x CLASSES + i]`: what one unit of push frequency with `i` adds to the
    /// BB's call-over-fold gain with `j`.
    call_gain: Vec<f64>,
    /// The number of deals.
    deals: f64,
}

/// A strategy profile in push/fold form: push and call frequencies per class.
#[derive(Clone, Debug, PartialEq)]
struct Pair {
    push: Vec<f64>,
    call: Vec<f64>,
}

/// Solves the push/fold game of `layout` exactly; returns the profile and the CFR+
/// iterations run.
pub(super) fn solve(layout: &Layout) -> Result<(Profile, u32), PreflopError> {
    let game = push_fold(layout)?;
    let mut cfr = MatrixCfr::new();
    let mut budget = FIRST_ITERATIONS;
    let mut best = [f64::INFINITY; 2];
    for _ in 0..ROUNDS {
        cfr.run(&game, budget);
        let average = cfr.average();
        if let Some(refined) = refine(&game, &average) {
            let profile = profile(&refined);
            let found = gains(layout, &profile);
            if is_certified(found) {
                return Ok((profile, cfr.iterations));
            }
            best = found;
        } else if best[0].is_infinite() {
            best = gains(layout, &profile(&average));
        }
        budget = budget.saturating_mul(2);
    }
    Err(PreflopError::Certificate { gains_bb: best })
}

/// The two linear maps of a push/fold layout, after checking its shape.
fn push_fold(layout: &Layout) -> Result<PushFold, PreflopError> {
    let shape = |what: &str| game_error(format!("the game is not the push/fold game: {what}"));
    let [root, facing] = layout.nodes.as_slice() else {
        return Err(shape("it does not have two decision nodes"));
    };
    let [Child::Terminal(folds), Child::Node(1)] = root.children.as_slice() else {
        return Err(shape("the root does not have two children, a fold and the all-in"));
    };
    let [Child::Terminal(called_off), Child::Terminal(showdown)] = facing.children.as_slice()
    else {
        return Err(shape("the all-in is not answered by a fold and a call"));
    };
    if root.seat != 1 || facing.seat != 0 {
        return Err(shape("the button does not act first"));
    }
    let t = |index: usize| layout.terminals[index];
    let (folds, called_off, showdown) = (t(*folds), t(*called_off), t(*showdown));
    let weights = &layout.weights;
    let gain = |from: &Terminal, to: &Terminal, seat: usize, at: usize| {
        (to.base_bb[seat] - from.base_bb[seat]) * weights.pairs[at]
            + (to.scale_bb[seat] - from.scale_bb[seat]) * weights.pairs_equity[at]
    };
    let cells = 0..CLASSES * CLASSES;
    let push_gain = cells.clone().map(|at| gain(&called_off, &showdown, 1, at)).collect();
    let call_gain = cells.map(|at| gain(&called_off, &showdown, 0, at)).collect();
    let base = (0..CLASSES)
        .map(|row| (0..CLASSES).map(|col| gain(&folds, &called_off, 1, row * CLASSES + col)).sum())
        .collect();
    Ok(PushFold { base, push_gain, call_gain, deals: weights.total })
}

impl PushFold {
    /// The button's push-over-fold gain per class against `call`.
    fn push_values(&self, call: &[f64]) -> Vec<f64> {
        rows(&self.push_gain).zip(&self.base).map(|(row, base)| base + dot(row, call)).collect()
    }

    /// The BB's call-over-fold gain per class against `push`.
    fn call_values(&self, push: &[f64]) -> Vec<f64> {
        rows(&self.call_gain).map(|row| dot(row, push)).collect()
    }

    /// Each seat's best-response gain in big blinds per hand, BB first (pair order).
    fn gains(&self, pair: &Pair) -> [f64; 2] {
        let gain = |values: &[f64], played: &[f64]| {
            values.iter().zip(played).map(|(v, f)| v.max(0.0) - f * v).sum::<f64>() / self.deals
        };
        [
            gain(&self.call_values(&pair.push), &pair.call),
            gain(&self.push_values(&pair.call), &pair.push),
        ]
    }
}

/// The rows of a `CLASSES x CLASSES` matrix.
fn rows(matrix: &[f64]) -> std::slice::ChunksExact<'_, f64> {
    matrix.chunks_exact(CLASSES)
}

/// The dot product.
fn dot(left: &[f64], right: &[f64]) -> f64 {
    left.iter().zip(right).map(|(a, b)| a * b).sum()
}

/// The layout profile of a push/fold pair: node 0 folds or pushes, node 1 folds or calls.
fn profile(pair: &Pair) -> Profile {
    let node = |aggressive: &[f64]| {
        let fold = aggressive.iter().map(|f| 1.0 - f);
        fold.chain(aggressive.iter().copied()).collect::<Vec<f64>>()
    };
    vec![node(&pair.push), node(&pair.call)]
}

/// CFR+ on the push/fold maps: per side the floored regrets of folding and of the
/// aggressive action, and the linearly weighted sum of the aggressive frequency.
struct MatrixCfr {
    push_regrets: [Vec<f64>; 2],
    call_regrets: [Vec<f64>; 2],
    push_sum: Vec<f64>,
    call_sum: Vec<f64>,
    weight_sum: f64,
    iterations: u32,
}

impl MatrixCfr {
    fn new() -> Self {
        let zeros = vec![0.0; CLASSES];
        MatrixCfr {
            push_regrets: [zeros.clone(), zeros.clone()],
            call_regrets: [zeros.clone(), zeros.clone()],
            push_sum: zeros.clone(),
            call_sum: zeros,
            weight_sum: 0.0,
            iterations: 0,
        }
    }

    /// Runs `count` more iterations: the button updates, then the BB against it.
    fn run(&mut self, game: &PushFold, count: u32) {
        for _ in 0..count {
            self.iterations += 1;
            let weight = f64::from(self.iterations);
            self.weight_sum += weight;
            let push = current(&self.push_regrets);
            let values = game.push_values(&current(&self.call_regrets));
            update(&mut self.push_regrets, &mut self.push_sum, &push, &values, weight);
            let call = current(&self.call_regrets);
            let values = game.call_values(&current(&self.push_regrets));
            update(&mut self.call_regrets, &mut self.call_sum, &call, &values, weight);
        }
    }

    /// The average strategy.
    fn average(&self) -> Pair {
        let mean = |sum: &[f64]| sum.iter().map(|s| s / self.weight_sum).collect();
        Pair { push: mean(&self.push_sum), call: mean(&self.call_sum) }
    }
}

/// Regret matching on `[fold, aggressive]` regrets: the aggressive frequency per class.
fn current(regrets: &[Vec<f64>; 2]) -> Vec<f64> {
    regrets[0]
        .iter()
        .zip(&regrets[1])
        .map(|(fold, aggressive)| {
            let total = fold + aggressive;
            if total > 0.0 { aggressive / total } else { 0.5 }
        })
        .collect()
}

/// One CFR+ update of a side: folding is worth 0 and the aggressive action `values`.
fn update(
    regrets: &mut [Vec<f64>; 2],
    sum: &mut [f64],
    played: &[f64],
    values: &[f64],
    weight: f64,
) {
    for class in 0..CLASSES {
        let (frequency, value) = (played[class], values[class]);
        let node = frequency * value;
        regrets[0][class] = (regrets[0][class] - node).max(0.0);
        regrets[1][class] = (regrets[1][class] + value - node).max(0.0);
        sum[class] += weight * frequency;
    }
}

/// The first candidate support that refines to a profile within the certificate.
fn refine(game: &PushFold, average: &Pair) -> Option<Pair> {
    let push_ranked = most_mixed(&average.push);
    let call_ranked = most_mixed(&average.call);
    (0..=MOST_MIXED_PER_SIDE).find_map(|size| {
        let push_sets = subsets(&push_ranked, size);
        let call_sets = subsets(&call_ranked, size);
        push_sets.iter().find_map(|mixed_push| {
            call_sets.iter().find_map(|mixed_call| {
                let support = Support { push: mixed_push, call: mixed_call };
                let refined = polish(game, average, &support)?;
                let certified = is_certified(game.gains(&refined));
                certified.then_some(refined)
            })
        })
    })
}

/// The classes ranked by `min(f, 1 - f)`, most mixed first, `CANDIDATES_PER_SIDE` of them.
fn most_mixed(frequencies: &[f64]) -> Vec<usize> {
    let mut ranked: Vec<usize> = (0..frequencies.len()).collect();
    let mixedness = |class: &usize| frequencies[*class].min(1.0 - frequencies[*class]);
    ranked.sort_by(|a, b| mixedness(b).total_cmp(&mixedness(a)).then(a.cmp(b)));
    ranked.truncate(CANDIDATES_PER_SIDE);
    ranked
}

/// Every subset of `items` with `size` members, for `size` up to two.
fn subsets(items: &[usize], size: usize) -> Vec<Vec<usize>> {
    match size {
        0 => vec![Vec::new()],
        1 => items.iter().map(|item| vec![*item]).collect(),
        _ => items
            .iter()
            .enumerate()
            .flat_map(|(at, first)| items[at + 1..].iter().map(move |second| vec![*first, *second]))
            .collect(),
    }
}

/// The classes each side mixes in a candidate support.
struct Support<'a> {
    push: &'a [usize],
    call: &'a [usize],
}

/// Solves `support` from the CFR+ average's pure actions, resetting the pure classes to
/// their best response until they settle; `None` when a solve fails or leaves [0, 1].
fn polish(game: &PushFold, average: &Pair, support: &Support<'_>) -> Option<Pair> {
    let round = |frequencies: &[f64]| {
        frequencies.iter().map(|f| if *f >= 0.5 { 1.0 } else { 0.0 }).collect()
    };
    let mut pair = Pair { push: round(&average.push), call: round(&average.call) };
    for _ in 0..POLISH_ROUNDS {
        let solved = solve_support(game, &pair, support)?;
        let push_values = game.push_values(&solved.call);
        let call_values = game.call_values(&solved.push);
        let next = Pair {
            push: best_response(&solved.push, &push_values, support.push),
            call: best_response(&solved.call, &call_values, support.call),
        };
        if next == solved {
            return Some(solved);
        }
        pair = next;
    }
    None
}

/// The pure classes outside `mixed` set to their best response against `values`.
fn best_response(played: &[f64], values: &[f64], mixed: &[usize]) -> Vec<f64> {
    played
        .iter()
        .zip(values)
        .enumerate()
        .map(|(class, (f, v))| {
            if mixed.contains(&class) || *v == 0.0 {
                *f
            } else if *v > 0.0 {
                1.0
            } else {
                0.0
            }
        })
        .collect()
}

/// The mixed frequencies of `support` from the indifference equations, the other classes
/// as `pair` plays them.
fn solve_support(game: &PushFold, pair: &Pair, support: &Support<'_>) -> Option<Pair> {
    if support.push.len() != support.call.len() {
        return None;
    }
    let push = indifferent(&game.call_gain, None, &pair.push, support.call, support.push)?;
    let call =
        indifferent(&game.push_gain, Some(&game.base), &pair.call, support.push, support.call)?;
    Some(Pair { push, call })
}

/// Solves `rows` of `matrix x + base = 0` for the entries `unknowns` of `x`, the other
/// entries fixed as `fixed` holds them; the frequencies must land in [0, 1].
fn indifferent(
    matrix: &[f64],
    base: Option<&[f64]>,
    fixed: &[f64],
    equations: &[usize],
    unknowns: &[usize],
) -> Option<Vec<f64>> {
    let mut known = fixed.to_vec();
    for class in unknowns {
        known[*class] = 0.0;
    }
    let system: Vec<Vec<f64>> = equations
        .iter()
        .map(|row| unknowns.iter().map(|col| matrix[row * CLASSES + col]).collect())
        .collect();
    let rhs: Vec<f64> = equations
        .iter()
        .map(|row| {
            -(dot(&matrix[row * CLASSES..(row + 1) * CLASSES], &known)
                + base.map_or(0.0, |b| b[*row]))
        })
        .collect();
    let solution = linalg::solve(&system, &rhs)?;
    let inside = solution.iter().all(|f| (-FREQUENCY_SLACK..=1.0 + FREQUENCY_SLACK).contains(f));
    if !inside {
        return None;
    }
    unknowns.iter().zip(&solution).for_each(|(class, f)| known[*class] = f.clamp(0.0, 1.0));
    Some(known)
}

#[cfg(test)]
mod tests {
    use super::{most_mixed, subsets};

    #[test]
    fn r2_19_candidates_rank_the_most_mixed_classes_first() {
        let ranked = most_mixed(&[1.0, 0.5, 0.0, 0.9, 0.2, 0.01]);
        assert_eq!(ranked, vec![1, 4, 3, 5]);
        assert_eq!(subsets(&ranked, 0), vec![Vec::<usize>::new()]);
        assert_eq!(subsets(&ranked, 1).len(), 4);
        assert_eq!(subsets(&ranked, 2).len(), 6);
    }
}
