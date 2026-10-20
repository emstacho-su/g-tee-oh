//! The two R0.11 vectors that S12 writes red first inside its own session (09 section 3):
//! the bucket-edge table for R2.3 and the node-key round trip for R2.1. Each test carries
//! both tags in its name.

use gto_model::buckets::{BUCKET_EDGES_PCT, Bucket, bucket_for};
use gto_model::keys::NodeKey;
use gto_model::tokens::ActionToken;
use gto_model::types::Cbb;

/// R0.11: 25, 50, 75, 110 and 150 percent of pot, upper edge inclusive, all-in separate:
/// every edge, one tick above, and all-in.
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

/// R0.11: a node key parses and displays back to the same text, and the parsed value
/// displays and parses back to itself, for the A3 section 1 example and a key on every
/// street, including empty action segments.
#[test]
fn r2_1_r0_11_node_key_round_trip() {
    let keys = [
        "cfg_9_live_13_150/BB-BTN/r300.c|Ah7d2c|x.b250.c|Kh|x",
        "cfg_9_live_13_150/BB-BTN/",
        "cfg_6_online_nl25_100/SB-BB/r250",
        "cfg_6_online_nl25_100/BB-BTN/r250.r800.c|Kc7h2s|",
        "cfg_6_online_nl25_100/BB-BTN/r250.c|Kc7h2s|x.b150.r450.c|9d|",
        "cfg_9_live_25_300_straddle/UTG-CO/s200.r600.c|As9s2c|b250.c|Qs|x.x|3h|b1000.a",
        "cfg_6_online_nl25_200/HJ-BTN/l.r500.f|TdTh4c|x|Ac|x|2c|",
    ];
    for text in keys {
        let parsed: NodeKey = text.parse().unwrap_or_else(|err| panic!("{text}: {err}"));
        assert_eq!(parsed.to_string(), text);
        let again: NodeKey = parsed.to_string().parse().unwrap();
        assert_eq!(again, parsed);
    }
}
