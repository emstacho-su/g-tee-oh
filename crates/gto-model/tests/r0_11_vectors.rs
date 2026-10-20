//! The two requirement R0.11 vectors that session S12 writes red first inside its own
//! session and then turns green (09 section 3): the bucket-edge table for R2.3 and the
//! node-key round trip for R2.1. Each test name carries both requirement identifiers
//! (R IDs). Chips are integer centi-big-blinds (cbb), so the 10,000 cbb pot below is 100
//! big blinds (bb) and a 2,500 cbb size is 25 percent of it.

use gto_model::buckets::{BUCKET_EDGES_PCT, Bucket, bucket_for};
use gto_model::keys::NodeKey;
use gto_model::tokens::ActionToken;
use gto_model::types::Cbb;

/// R2.3 and R0.11: the bucket edges are 25, 50, 75, 110 and 150 percent of pot, each
/// bucket includes its upper edge, and an all-in is its own bucket whatever its size
/// (architecture decision record (ADR) 0008, 05 section 6.4). The mapping compares
/// integers exactly, so at a 10,000 cbb pot one cbb under an edge and the edge itself stay
/// in the lower bucket while one cbb over it moves to the next. The bet token at each edge
/// must agree with `bucket_for`, and an all-in must stay `AllIn` beside every edge and at
/// pots of 1 and 1,000,000 cbb: the solver's tree decides which buckets have a button, so
/// the mapping never snaps a size to a neighbouring bucket (ADR 0020).
#[test]
fn r2_3_r0_11_bucket_edge_table() {
    let pot = Cbb(10_000);
    let at_or_below =
        [Bucket::Tiny, Bucket::Small, Bucket::Medium, Bucket::Pot, Bucket::OverbetSmall];
    let above =
        [Bucket::Small, Bucket::Medium, Bucket::Pot, Bucket::OverbetSmall, Bucket::OverbetLarge];
    for (i, edge) in BUCKET_EDGES_PCT.iter().enumerate() {
        let at_edge = Cbb(u32::from(*edge) * 100);
        let one_tick_below = Cbb(at_edge.get() - 1);
        let one_tick_above = Cbb(at_edge.get() + 1);
        assert_eq!(
            bucket_for(one_tick_below, pot).unwrap(),
            at_or_below[i],
            "under {edge} percent"
        );
        assert_eq!(bucket_for(at_edge, pot).unwrap(), at_or_below[i], "exactly {edge} percent");
        assert_eq!(bucket_for(one_tick_above, pot).unwrap(), above[i], "over {edge} percent");
        let bet = Bucket::of_action(ActionToken::Bet(at_edge), pot).unwrap();
        assert_eq!(bet, Some(at_or_below[i]), "bet of {edge} percent");
        let all_in = Bucket::of_action(ActionToken::AllIn, pot).unwrap();
        assert_eq!(all_in, Some(Bucket::AllIn), "all-in beside the {edge} percent edge");
    }
    assert_eq!(bucket_for(Cbb(0), pot).unwrap(), Bucket::Tiny);
    assert_eq!(bucket_for(Cbb(15_001), pot).unwrap(), Bucket::OverbetLarge);
    assert_eq!(Bucket::of_action(ActionToken::AllIn, Cbb(1)).unwrap(), Some(Bucket::AllIn));
    assert_eq!(Bucket::of_action(ActionToken::AllIn, Cbb(1_000_000)).unwrap(), Some(Bucket::AllIn));
}

/// R2.1 and R0.11: a node key parses and displays back to the same text, and the parsed
/// value displays and parses back to itself, under the A3 section 1 grammar. The keys cover
/// the A3 example, the preflop root with an empty line, a preflop SB-BB key, a first flop
/// decision with an empty action segment, a turn key with an empty action segment, a
/// straddled UTG-CO river key ending in a bet and an all-in, an HJ-BTN river key with an
/// empty action segment on every postflop street, and a preflop key that ends in a fold, so
/// every one of the eight action tokens appears in at least one key.
#[test]
fn r2_1_r0_11_node_key_round_trip() {
    let keys = [
        "cfg_9_live_13_150/BB-BTN/r300.c|Ah7d2c|x.b250.c|Kh|x",
        "cfg_9_live_13_150/BB-BTN/",
        "cfg_6_online_nl25_100/SB-BB/r250",
        "cfg_6_online_nl25_100/BB-BTN/r250.r800.c|Kc7h2s|",
        "cfg_6_online_nl25_100/BB-BTN/r250.c|Kc7h2s|x.b150.r450.c|9d|",
        "cfg_9_live_25_300_straddle/UTG-CO/s200.r600.c|As9s2c|b250.c|Qs|x.x|3h|b1000.a",
        "cfg_6_online_nl25_200/HJ-BTN/l.r500.c|TdTh4c||Ac||2c|",
        "cfg_6_online_nl25_100/SB-BB/l.r300.f",
    ];
    for text in keys {
        let parsed: NodeKey = text.parse().unwrap_or_else(|err| panic!("{text}: {err}"));
        assert_eq!(parsed.to_string(), text);
        let again: NodeKey = parsed.to_string().parse().unwrap();
        assert_eq!(again, parsed);
    }
}
