#![allow(unused_variables, dead_code, reason = "S16 stub: lane A fills this file")]
//! The grade math (R2.13, ADR 0004, ADR 0020, O-22, plan C.2): the expected value (EV)
//! loss in big blinds and percent of the pot, the floor through
//! `gto_model::grading::floor_pct_pot` (O-150) with its source, the pack-time bucket
//! (never recomputed), the noise flags of 05 section 9 (`close_ev_mix`, `rare_line`,
//! `suit_mixing`) and the difficulty features. Lane A fills this file, exposes
//! `grade::noise_flags(&NodeView, hand, floor) -> Vec<NoiseFlag>` for lane B, and
//! removes the allowance at the top of this file.
