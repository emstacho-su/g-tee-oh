//! R2.9 and R2.19 unit tests of the shared blind and chip replay helpers. R2.9 and R2.19
//! are requirement identifiers (R IDs).

use gto_model::{
    ActionToken, Cbb, GameConfig, GameFormat, Position, PositionPair, RakeModel, Stake, TableSize,
};

use super::{ChipState, PreflopChips, blind_of, small_blind_seat, total_after};
use crate::error::TreeError;

const NO_RAKE: RakeModel = RakeModel { percent_bp: 0, cap_cents: 0, no_flop_no_drop: true };

fn config(table_size: TableSize, blinds_cents: (u32, u32), depth_bb: u32) -> GameConfig {
    let format =
        if table_size == TableSize::NINE_HANDED { GameFormat::Live } else { GameFormat::Online };
    let stake = Stake::new("test", blinds_cents.0, blinds_cents.1, NO_RAKE).expect("a stake");
    GameConfig::new(format, table_size, stake, Cbb::from_bb(depth_bb))
}

fn pair(oop: Position, ip: Position) -> PositionPair {
    PositionPair::new(oop, ip).expect("a pair")
}

#[test]
fn r2_9_blinds_round_half_up_and_only_the_blind_seats_post() {
    let live = config(TableSize::NINE_HANDED, (100, 300), 100);
    assert_eq!(blind_of(Position::Sb, &live), Ok(Cbb::new(33)), "1/3 rounds to 33 cbb");
    assert_eq!(blind_of(Position::Bb, &live), Ok(Cbb::new(100)));
    assert_eq!(blind_of(Position::Btn, &live), Ok(Cbb::ZERO));
    let online = config(TableSize::SIX_MAX, (50, 100), 100);
    assert_eq!(blind_of(Position::Sb, &online), Ok(Cbb::new(50)));
    assert_eq!(blind_of(Position::Co, &online), Ok(Cbb::ZERO));
    let heads_up = config(TableSize::HEADS_UP, (50, 100), 10);
    assert_eq!(small_blind_seat(TableSize::HEADS_UP), Position::Btn);
    assert_eq!(small_blind_seat(TableSize::SIX_MAX), Position::Sb);
    assert_eq!(blind_of(Position::Btn, &heads_up), Ok(Cbb::new(50)), "the button posts the SB");
    let mut no_big_blind = heads_up;
    no_big_blind.stake.bb_cents = 0;
    assert!(matches!(blind_of(Position::Btn, &no_big_blind), Err(TreeError::Preflop(_))));
}

#[test]
fn r2_9_live_dead_money_is_the_folded_small_blind() {
    let live = config(TableSize::NINE_HANDED, (100, 300), 100);
    let chips = PreflopChips::new(&live, pair(Position::Bb, Position::Btn)).expect("chips");
    assert_eq!(chips.dead(), Cbb::new(33));
    assert_eq!(chips.blinds(), [Cbb::new(100), Cbb::ZERO]);
    assert_eq!(chips.stack(), Cbb::from_bb(100));
    let start = chips.start().expect("a start");
    assert_eq!(start, ChipState { to_act: 1, invested: [Cbb::new(100), Cbb::ZERO], pot: Cbb(133) });
}

#[test]
fn r2_9_replay_of_an_open_a_three_bet_and_a_call() {
    let online = config(TableSize::SIX_MAX, (50, 100), 100);
    let chips = PreflopChips::new(&online, pair(Position::Bb, Position::Btn)).expect("chips");
    let line = [ActionToken::Raise(Cbb(250)), ActionToken::Raise(Cbb(1_000)), ActionToken::Call];
    let states = chips.replay(&line).expect("a replay");
    let invested: Vec<[u32; 2]> = states.iter().map(|s| s.invested.map(Cbb::get)).collect();
    assert_eq!(invested, vec![[100, 0], [100, 250], [1_000, 250], [1_000, 1_000]]);
    let pots: Vec<u32> = states.iter().map(|s| s.pot.get()).collect();
    assert_eq!(pots, vec![150, 400, 1_300, 2_050], "50 cbb of dead small blind");
    let to_act: Vec<usize> = states.iter().map(|s| s.to_act).collect();
    assert_eq!(to_act, vec![1, 0, 1, 0], "the button opens, the BB 3-bets");
    assert_eq!(chips.after(&line), Ok(states[3]));
}

#[test]
fn r2_19_replay_of_a_called_all_in_heads_up() {
    let heads_up = config(TableSize::HEADS_UP, (50, 100), 10);
    let chips = PreflopChips::new(&heads_up, pair(Position::Bb, Position::Btn)).expect("chips");
    let states = chips.replay(&[ActionToken::AllIn, ActionToken::Call]).expect("a replay");
    let pots: Vec<u32> = states.iter().map(|s| s.pot.get()).collect();
    assert_eq!(pots, vec![150, 1_100, 2_000]);
    assert_eq!(states[2].invested, [Cbb::from_bb(10), Cbb::from_bb(10)]);
    let raise_past_stack =
        total_after(ActionToken::Raise(Cbb(5_000)), Cbb(50), Cbb(100), Cbb(1_000));
    assert_eq!(raise_past_stack, Ok(Cbb(1_000)), "every total stops at the stack");
}

#[test]
fn r2_9_a_bet_adds_its_size_and_a_raise_goes_to_its_total() {
    let stack = Cbb(10_000);
    let bet = total_after(ActionToken::Bet(Cbb(300)), Cbb(100), Cbb(100), stack);
    assert_eq!(bet, Ok(Cbb(400)), "b300 puts 300 more in");
    let raise = total_after(ActionToken::Raise(Cbb(300)), Cbb(100), Cbb(100), stack);
    assert_eq!(raise, Ok(Cbb(300)), "r300 is a raise to 300");
    let limp = total_after(ActionToken::Limp, Cbb(50), Cbb(100), stack);
    assert_eq!(limp, Ok(Cbb(100)));
    let check = total_after(ActionToken::Check, Cbb(100), Cbb(100), stack);
    assert_eq!(check, Ok(Cbb(100)));
    let fold = total_after(ActionToken::Fold, Cbb(50), Cbb(250), stack);
    assert_eq!(fold, Ok(Cbb(50)));
    let straddle = total_after(ActionToken::Straddle(Cbb(200)), Cbb(0), Cbb(100), stack);
    assert!(matches!(straddle, Err(TreeError::Preflop(_))));
}

#[test]
fn r2_9_chips_refuse_a_straddle_and_an_unseated_seat() {
    let straddled = GameConfig { straddle: true, ..config(TableSize::HEADS_UP, (50, 100), 10) };
    let heads_up_pair = pair(Position::Bb, Position::Btn);
    assert!(matches!(PreflopChips::new(&straddled, heads_up_pair), Err(TreeError::Preflop(_))));
    let heads_up = config(TableSize::HEADS_UP, (50, 100), 10);
    let unseated = PreflopChips::new(&heads_up, pair(Position::Bb, Position::Co));
    assert!(matches!(unseated, Err(TreeError::Preflop(_))));
    let anted = GameConfig { ante_cbb: Cbb(10), ..config(TableSize::SIX_MAX, (50, 100), 100) };
    let chips = PreflopChips::new(&anted, pair(Position::Bb, Position::Btn)).expect("chips");
    assert_eq!(chips.dead(), Cbb(110), "six antes and the folded small blind");
    assert_eq!(chips.stack(), Cbb(9_990));
    assert_eq!(chips.seats(), [Position::Bb, Position::Btn]);
    assert_eq!(chips.pair(), heads_up_pair);
}
