//! R2.19 unit tests of the preflop solver's checks and its general CFR+ run. R2.19 is a
//! requirement identifier (R ID).

use std::path::Path;

use gto_model::{Cbb, GameConfig};
use gto_tree::PreflopTree;

use super::{
    CfrOptions, PreflopError, PreflopGame, best_response_gains, push_fold_config, solve,
    solve_push_fold,
};
use crate::equity::EquityTable;

fn equity_table() -> EquityTable {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../validation/fixtures/equity/preflop-169.json");
    let text = std::fs::read_to_string(path).expect("the committed equity table");
    let value: serde_json::Value = serde_json::from_str(&text).expect("equity JSON");
    EquityTable {
        classes: serde_json::from_value(value["classes"].clone()).expect("classes"),
        equity: serde_json::from_value(value["equity"].clone()).expect("equity"),
        pairs: serde_json::from_value(value["pairs"].clone()).expect("pairs"),
    }
}

fn game(config: &GameConfig) -> PreflopGame {
    let tree = PreflopTree::push_fold(config).expect("a tree");
    PreflopGame::new(&tree, config, &equity_table(), None).expect("a game")
}

#[test]
fn r2_19_push_fold_config_refuses_a_depth_past_the_cbb_range() {
    assert!(matches!(push_fold_config(u32::MAX), Err(PreflopError::Model(_))));
    assert!(matches!(push_fold_config(0), Err(PreflopError::Game(_))));
}

#[test]
fn r2_19_equity_tables_of_the_wrong_shape_are_refused() {
    let config = push_fold_config(10).expect("a config");
    let tree = PreflopTree::push_fold(&config).expect("a tree");
    let full = equity_table();
    let short = EquityTable { classes: full.classes[1..].to_vec(), ..full.clone() };
    let relabeled = EquityTable {
        classes: [vec!["KK".to_owned()], full.classes[1..].to_vec()].concat(),
        ..full.clone()
    };
    let mut out_of_range = full.clone();
    out_of_range.equity[3][4] = 1.5;
    let mut ragged = full.clone();
    ragged.pairs[7].pop();
    for table in [short, relabeled, out_of_range, ragged] {
        let refused = PreflopGame::new(&tree, &config, &table, None);
        assert!(matches!(refused, Err(PreflopError::Equity(_))), "{refused:?}");
    }
}

#[test]
fn r2_19_a_tree_whose_pots_the_config_does_not_give_is_refused() {
    let tree = PreflopTree::push_fold(&push_fold_config(10).expect("a config")).expect("a tree");
    let deeper = push_fold_config(12).expect("a config");
    let refused = PreflopGame::new(&tree, &deeper, &equity_table(), None);
    assert!(matches!(refused, Err(PreflopError::Game(_))), "the 10 bb pots at 12 bb");
    let straddled = GameConfig { straddle: true, ..push_fold_config(10).expect("a config") };
    assert!(PreflopGame::new(&tree, &straddled, &equity_table(), None).is_err());
}

#[test]
fn r2_19_solve_refuses_degenerate_options() {
    let game = game(&push_fold_config(10).expect("a config"));
    let bad = [
        CfrOptions { max_iterations: 0, target_gain_pct_pot: 0.1, check_every: 10 },
        CfrOptions { max_iterations: 10, target_gain_pct_pot: 0.1, check_every: 0 },
        CfrOptions { max_iterations: 10, target_gain_pct_pot: -1.0, check_every: 10 },
        CfrOptions { max_iterations: 10, target_gain_pct_pot: f64::NAN, check_every: 10 },
    ];
    for options in bad {
        assert!(matches!(solve(&game, &options), Err(PreflopError::Game(_))), "{options:?}");
    }
}

#[test]
fn r2_19_general_cfr_stops_at_its_target_on_push_fold() {
    let config = push_fold_config(8).expect("a config");
    let game = game(&config);
    let options = CfrOptions { max_iterations: 2_000, target_gain_pct_pot: 1.0, check_every: 25 };
    let solution = solve(&game, &options).expect("a CFR+ run");
    let target_bb = 0.01 * 1.5;
    assert!(solution.iterations < 2_000, "stopped at the target");
    assert_eq!(solution.iterations % 25, 0, "stopped at a check");
    for gain in solution.gains_bb {
        assert!(gain <= target_bb, "gain {gain} bb");
    }
    let gains = best_response_gains(&game, &solution).expect("gains");
    assert_eq!(gains, solution.gains_bb, "the reported gains are the best-response gains");
    assert_eq!(solution.starting_pot, Cbb::new(150));
}

#[test]
fn r2_19_best_response_gains_refuse_a_solution_of_another_shape() {
    let config = push_fold_config(5).expect("a config");
    let game = game(&config);
    let solution = solve_push_fold(&config, &equity_table()).expect("a solve");
    let mut one_node = solution.clone();
    one_node.nodes.truncate(1);
    let mut short_hands = solution.clone();
    short_hands.nodes[1].hands.pop();
    let mut swapped = solution.clone();
    swapped.nodes[0].hands.swap(0, 1);
    let mut wide = solution;
    wide.nodes[0].hands[3].frequencies.push(0.0);
    for foreign in [one_node, short_hands, swapped, wide] {
        let refused = best_response_gains(&game, &foreign);
        assert!(matches!(refused, Err(PreflopError::Game(_))), "{refused:?}");
    }
}
