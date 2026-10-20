//! Red tests for the 169 by 169 preflop equity fixture (R2.20, O-32, O-126):
//! `validation/fixtures/equity/preflop-169.json` as `validate equity-table` writes it
//! from `gto_solve::equity::table()`. The file does not exist yet, so every test fails
//! at the load; once committed they check the table's symmetry, its agreement with the
//! generator, and three ranges a poker player knows by heart.

use std::path::{Path, PathBuf};

use gto_model::{Card, ComboId, HandClass};
use gto_solve::equity::{PairEquity, class_pair_equity, combo_pair_equity};
use validate::equity_fixture::{BOARDS_PER_PAIR, CLASS_COUNT, DEFAULT_PATH, EquityFixture, load};

/// Two entries that must sum to 1 may differ from it by rounding only.
const SYMMETRY_TOLERANCE: f64 = 1e-12;

/// The three class spot checks: hero, villain, the band the equity must fall in.
const SPOT_CHECKS: [(&str, &str, f64, f64); 3] =
    [("AA", "KK", 0.81, 0.83), ("22", "AKs", 0.49, 0.52), ("QQ", "AKo", 0.56, 0.58)];

/// The class pairs the deterministic test regenerates.
const REGENERATED: [(&str, &str); 3] = [("AA", "KK"), ("22", "AKs"), ("QQ", "AKo")];

fn fixture_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").join(DEFAULT_PATH)
}

fn load_fixture() -> EquityFixture {
    load(&fixture_path()).unwrap_or_else(|error| panic!("{error}"))
}

fn class(label: &str) -> HandClass {
    label.parse().unwrap_or_else(|error| panic!("{label}: {error}"))
}

fn card(label: &str) -> Card {
    label.parse().unwrap_or_else(|error| panic!("{label}: {error}"))
}

fn combo(a: &str, b: &str) -> ComboId {
    ComboId::from_cards(card(a), card(b)).unwrap_or_else(|error| panic!("{a}{b}: {error}"))
}

fn index(hand_class: HandClass) -> usize {
    usize::from(hand_class.index())
}

/// Disjoint ordered combo pairs of two classes, counted by a plain loop over the combos.
fn disjoint_pairs(hero: HandClass, villain: HandClass) -> u32 {
    let count = hero
        .combos()
        .iter()
        .flat_map(|h| villain.combos().into_iter().map(move |v| (*h, v)))
        .filter(|(h, v)| {
            let (a, b) = h.cards();
            !v.conflicts_with(&[a, b])
        })
        .count();
    u32::try_from(count).expect("at most 144 pairs")
}

/// R2.20: the labels are the 169 classes in `HandClass` order, `equity[i][j]` and
/// `equity[j][i]` sum to 1, the diagonal is 1/2, and `pairs` is symmetric and equal to
/// the disjoint ordered combo pairs the 6, 4 and 12 combos per class allow.
#[test]
fn r2_20_equity_table_is_symmetric() {
    let fixture = load_fixture();
    let labels: Vec<String> = HandClass::all().map(|c| c.to_string()).collect();
    assert_eq!(fixture.classes, labels, "classes in HandClass index order");
    assert_eq!(fixture.boards_per_pair, BOARDS_PER_PAIR);
    for i in 0..CLASS_COUNT {
        assert_eq!(fixture.equity[i][i], 0.5, "{}: diagonal", labels[i]);
        for j in 0..CLASS_COUNT {
            let sum = fixture.equity[i][j] + fixture.equity[j][i];
            assert!(
                (sum - 1.0).abs() <= SYMMETRY_TOLERANCE,
                "{} vs {}: {} + {} = {sum}",
                labels[i],
                labels[j],
                fixture.equity[i][j],
                fixture.equity[j][i]
            );
            assert_eq!(fixture.pairs[i][j], fixture.pairs[j][i], "{} vs {}", labels[i], labels[j]);
            let expected = disjoint_pairs(class(&labels[i]), class(&labels[j]));
            assert_eq!(fixture.pairs[i][j], expected, "{} vs {}: pairs", labels[i], labels[j]);
        }
    }
}

/// R2.20: three ranges a player knows (AA over KK about 82 percent, 22 against `AKs` a
/// coin flip, QQ against `AKo` about 57 percent) fall in their bands, and one explicit
/// combo pair, `AsAh` against `KdKc`, scores every board once; a plain loop over the 36
/// ordered AA versus KK combo pairs sums to the class entry exactly.
#[test]
fn r2_20_equity_table_spot_checks() {
    let fixture = load_fixture();
    for (hero, villain, low, high) in SPOT_CHECKS {
        let equity = fixture.equity[index(class(hero))][index(class(villain))];
        assert!(
            (low..=high).contains(&equity),
            "{hero} vs {villain}: {equity} outside [{low}, {high}]"
        );
    }

    let aces = combo("As", "Ah");
    let kings = combo("Kd", "Kc");
    let pair = combo_pair_equity(aces, kings);
    assert_eq!(pair.pairs, 1, "one disjoint ordered combo pair");
    assert_eq!(pair.total, BOARDS_PER_PAIR, "every board once");
    assert!(pair.wins + pair.ties <= pair.total, "{pair:?}");
    assert!((0.81..=0.83).contains(&pair.equity()), "AsAh vs KdKc: {}", pair.equity());
    let reverse = combo_pair_equity(kings, aces);
    assert_eq!(reverse.ties, pair.ties, "ties are shared");
    assert_eq!(reverse.wins + pair.wins + pair.ties, pair.total, "wins, losses and ties");
    assert_eq!(combo_pair_equity(aces, combo("As", "Kd")).pairs, 0, "a shared card scores nothing");

    let (hero, villain) = (class("AA"), class("KK"));
    let summed = hero
        .combos()
        .iter()
        .flat_map(|h| villain.combos().into_iter().map(move |v| combo_pair_equity(*h, v)))
        .fold(PairEquity { wins: 0, ties: 0, total: 0, pairs: 0 }, |acc, each| PairEquity {
            wins: acc.wins + each.wins,
            ties: acc.ties + each.ties,
            total: acc.total + each.total,
            pairs: acc.pairs + each.pairs,
        });
    assert_eq!(summed.pairs, 36, "every AA combo is disjoint from every KK combo");
    assert_eq!(summed, class_pair_equity(hero, villain), "the class entry is the combo sum");
}

/// R2.20: regenerating three class pairs through the library gives the committed
/// entries exactly, equity and pairs, so the file is what the generator writes and not a
/// hand edit.
#[test]
fn r2_20_equity_table_is_deterministic() {
    let fixture = load_fixture();
    for (hero, villain) in REGENERATED {
        let (i, j) = (index(class(hero)), index(class(villain)));
        let pair = class_pair_equity(class(hero), class(villain));
        assert_eq!(pair.total, u64::from(pair.pairs) * BOARDS_PER_PAIR, "{hero} vs {villain}");
        assert_eq!(fixture.pairs[i][j], pair.pairs, "{hero} vs {villain}: pairs");
        assert_eq!(fixture.equity[i][j], pair.equity(), "{hero} vs {villain}: equity");
    }
}
