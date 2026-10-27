//! Vector counterfactual regret minimization plus (CFR+) over a `Layout`, and the exact
//! evaluations the solver reports with (R2.19, R2.21).
//!
//! Mechanism. A strategy holds, per decision node, one frequency per action and hand
//! class (`[action x CLASSES + class]`). The counterfactual value of seat `s` at a node is
//! a vector over its own 169 classes: at a terminal it is the payoff weighted by the
//! opponent's reach and the class pair weights, `base x (pairs . reach) + scale x
//! (pairs_equity . reach)`; at the seat's own node the children's values are mixed by
//! its strategy (or maximized, for a best response); at the opponent's node the children
//! are summed with the opponent's reach scaled by its frequencies. CFR+ updates one seat
//! per pass (alternating updates): regrets are floored at zero, the current strategy is
//! regret matching on them, and the average strategy weights iteration `t` by `t` (linear
//! averaging) times the seat's own reach. A seat's best-response gain is the best
//! response's value minus the strategy's value, summed over its classes and divided by
//! the number of deals, so it is in big blinds (bb) per hand.

use super::game::{CLASSES, Child, Layout};

/// A strategy per node, `[action x CLASSES + class]`.
pub(super) type Profile = Vec<Vec<f64>>;

/// How the seat whose values are computed plays its own nodes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Own {
    /// By the profile.
    Follow,
    /// By a best response, class by class.
    Best,
}

/// `matrix . vector` for a `CLASSES x CLASSES` row-major matrix.
pub(super) fn mat_vec(matrix: &[f64], vector: &[f64]) -> Vec<f64> {
    matrix
        .chunks_exact(CLASSES)
        .map(|row| row.iter().zip(vector).map(|(weight, value)| weight * value).sum())
        .collect()
}

/// The frequencies of `action` at a node strategy.
pub(super) fn action_row(strategy: &[f64], action: usize) -> &[f64] {
    &strategy[action * CLASSES..(action + 1) * CLASSES]
}

/// Element-wise product.
fn times(left: &[f64], right: &[f64]) -> Vec<f64> {
    left.iter().zip(right).map(|(a, b)| a * b).collect()
}

/// Seat `seat`'s counterfactual values at `child` against `opp_reach`.
pub(super) fn values(
    layout: &Layout,
    profile: &Profile,
    child: Child,
    seat: usize,
    opp_reach: &[f64],
    own: Own,
) -> Vec<f64> {
    let index = match child {
        Child::Terminal(index) => return terminal_values(layout, index, seat, opp_reach),
        Child::Node(index) => index,
    };
    let node = &layout.nodes[index];
    let strategy = &profile[index];
    if node.seat == seat {
        let children: Vec<Vec<f64>> = node
            .children
            .iter()
            .map(|child| values(layout, profile, *child, seat, opp_reach, own))
            .collect();
        combine(&children, strategy, own)
    } else {
        let mut total = vec![0.0; CLASSES];
        for (action, child) in node.children.iter().enumerate() {
            let reach = times(opp_reach, action_row(strategy, action));
            let value = values(layout, profile, *child, seat, &reach, own);
            total.iter_mut().zip(&value).for_each(|(sum, v)| *sum += v);
        }
        total
    }
}

/// The node value from its children's values: mixed by `strategy` or maximized.
fn combine(children: &[Vec<f64>], strategy: &[f64], own: Own) -> Vec<f64> {
    (0..CLASSES)
        .map(|class| match own {
            Own::Follow => children
                .iter()
                .enumerate()
                .map(|(action, value)| strategy[action * CLASSES + class] * value[class])
                .sum(),
            Own::Best => {
                children.iter().map(|value| value[class]).fold(f64::NEG_INFINITY, f64::max)
            }
        })
        .collect()
}

/// Seat `seat`'s counterfactual values at terminal `index` against `opp_reach`.
fn terminal_values(layout: &Layout, index: usize, seat: usize, opp_reach: &[f64]) -> Vec<f64> {
    let terminal = &layout.terminals[index];
    let (base, scale) = (terminal.base_bb[seat], terminal.scale_bb[seat]);
    let weighted = mat_vec(&layout.weights.pairs, opp_reach);
    if scale == 0.0 {
        return weighted.iter().map(|w| base * w).collect();
    }
    let with_equity = mat_vec(&layout.weights.pairs_equity, opp_reach);
    weighted.iter().zip(&with_equity).map(|(w, we)| base * w + scale * we).collect()
}

/// Each seat's best-response gain in bb per hand against `profile`, in pair order.
pub(super) fn gains(layout: &Layout, profile: &Profile) -> [f64; 2] {
    let ones = vec![1.0; CLASSES];
    [0, 1].map(|seat| {
        let follow: f64 =
            values(layout, profile, Child::Node(0), seat, &ones, Own::Follow).iter().sum();
        let best: f64 =
            values(layout, profile, Child::Node(0), seat, &ones, Own::Best).iter().sum();
        (best - follow) / layout.weights.total
    })
}

/// `table` normalized per class over the actions; a class with an all-zero column gets
/// the uniform strategy.
pub(super) fn normalized(table: &[f64], actions: usize) -> Vec<f64> {
    let mut out = vec![0.0; table.len()];
    for class in 0..CLASSES {
        let total: f64 = (0..actions).map(|action| table[action * CLASSES + class]).sum();
        for action in 0..actions {
            let at = action * CLASSES + class;
            #[allow(clippy::cast_precision_loss, reason = "an action count is tiny")]
            let uniform = 1.0 / actions as f64;
            out[at] = if total > 0.0 { table[at] / total } else { uniform };
        }
    }
    out
}

/// CFR+ state: regrets floored at zero and the linearly weighted strategy sums.
pub(super) struct Cfr {
    regrets: Profile,
    sums: Profile,
    iterations: u32,
}

impl Cfr {
    /// Zero regrets and sums.
    pub(super) fn new(layout: &Layout) -> Self {
        let zeros: Profile =
            layout.nodes.iter().map(|node| vec![0.0; node.children.len() * CLASSES]).collect();
        Cfr { regrets: zeros.clone(), sums: zeros, iterations: 0 }
    }

    /// Iterations run so far.
    pub(super) fn iterations(&self) -> u32 {
        self.iterations
    }

    /// The current strategy: regret matching on the floored regrets.
    pub(super) fn current(&self, layout: &Layout) -> Profile {
        self.regrets
            .iter()
            .zip(&layout.nodes)
            .map(|(regrets, node)| normalized(regrets, node.children.len()))
            .collect()
    }

    /// The average strategy.
    pub(super) fn average(&self, layout: &Layout) -> Profile {
        self.sums
            .iter()
            .zip(&layout.nodes)
            .map(|(sums, node)| normalized(sums, node.children.len()))
            .collect()
    }

    /// One iteration: seat 0 updates, then seat 1 against seat 0's new strategy.
    pub(super) fn iterate(&mut self, layout: &Layout) {
        self.iterations += 1;
        let weight = f64::from(self.iterations);
        let ones = vec![1.0; CLASSES];
        for seat in 0..2 {
            let profile = self.current(layout);
            let pass = Pass { layout, profile: &profile, seat, weight };
            self.update(&pass, Child::Node(0), &ones, &ones);
        }
    }

    /// The CFR+ pass below `child`; returns the seat's counterfactual values there.
    fn update(&mut self, pass: &Pass<'_>, child: Child, own: &[f64], opp: &[f64]) -> Vec<f64> {
        let index = match child {
            Child::Terminal(index) => return terminal_values(pass.layout, index, pass.seat, opp),
            Child::Node(index) => index,
        };
        let node = &pass.layout.nodes[index];
        let strategy = &pass.profile[index];
        if node.seat != pass.seat {
            let mut total = vec![0.0; CLASSES];
            for (action, next) in node.children.iter().enumerate() {
                let reach = times(opp, action_row(strategy, action));
                let value = self.update(pass, *next, own, &reach);
                total.iter_mut().zip(&value).for_each(|(sum, v)| *sum += v);
            }
            return total;
        }
        let children: Vec<Vec<f64>> = node
            .children
            .iter()
            .enumerate()
            .map(|(action, next)| {
                let reach = times(own, action_row(strategy, action));
                self.update(pass, *next, &reach, opp)
            })
            .collect();
        let value = combine(&children, strategy, Own::Follow);
        self.record(index, pass, &children, &value, own);
        value
    }

    /// The regret and average updates at own node `index`.
    fn record(
        &mut self,
        index: usize,
        pass: &Pass<'_>,
        children: &[Vec<f64>],
        value: &[f64],
        own: &[f64],
    ) {
        let strategy = &pass.profile[index];
        let (regrets, sums) = (&mut self.regrets[index], &mut self.sums[index]);
        for (action, child) in children.iter().enumerate() {
            for class in 0..CLASSES {
                let at = action * CLASSES + class;
                regrets[at] = (regrets[at] + child[class] - value[class]).max(0.0);
                sums[at] += pass.weight * own[class] * strategy[at];
            }
        }
    }
}

/// What one CFR+ pass reads.
struct Pass<'a> {
    layout: &'a Layout,
    profile: &'a Profile,
    seat: usize,
    weight: f64,
}
