//! Live builder settings (R2.18, A1 section 6, O-13, O-188, O-194): every key has a
//! default, a malformed or unknown key is named and falls back alone, and the derived
//! values (threads by the boost window, the stop rule per attempt, the storage) follow.

use gto_solve::postflop::StorageBits;
use library_builder::settings::{BuilderSettings, KEYS, MINUTES_PER_DAY, Overnight};
use serde_json::{Value, json};

fn rows(pairs: &[(&str, Value)]) -> Vec<(String, Value)> {
    pairs.iter().map(|(key, value)| ((*key).to_owned(), value.clone())).collect()
}

#[test]
fn r2_18_no_rows_is_every_default() {
    let (settings, errors) = BuilderSettings::from_rows(&[]);
    assert_eq!(settings, BuilderSettings::default());
    assert_eq!(errors, Vec::new());
    assert_eq!(settings.target_pct_pot, 0.3);
    assert_eq!(settings.storage_bits, 32, "O-194");
    assert_eq!(settings.max_attempts, 3);
    assert_eq!(settings.planner.k_runouts, 20);
    assert_eq!(settings.planner.k_runouts_rare, 10);
    assert_eq!(settings.planner.budget_bytes, 650_000_000_000);
}

#[test]
fn r2_18_every_key_is_read() {
    let (settings, errors) = BuilderSettings::from_rows(&rows(&[
        ("paused", json!(true)),
        ("cpu_share", json!(0.25)),
        (
            "overnight",
            json!({"start_hour": 22, "end_hour": 6, "utc_offset_minutes": -240, "cpu_share": 0.9}),
        ),
        ("budget_bytes", json!(1_000_000)),
        ("bytes_per_runout", json!(3_000_000)),
        ("bytes_per_flop_tree", json!(500_000)),
        ("k_runouts", json!(12)),
        ("k_runouts_rare", json!(4)),
        ("k_frequent_pairs", json!(2)),
        ("plan_configs", json!(["cfg_6_online_150"])),
        ("target_pct_pot", json!(0.5)),
        ("max_iterations", json!(900)),
        ("max_seconds_per_line", json!(60)),
        ("storage_bits", json!(16)),
        ("memory_cap_bytes", json!(1_073_741_824_u64)),
        ("max_attempts", json!(5)),
        ("stale_hours", json!(2)),
        ("verify_interval_hours", json!(12)),
        ("plan_interval_minutes", json!(15)),
        ("poll_seconds", json!(5)),
    ]));
    assert!(errors.is_empty(), "{errors:?}");
    assert!(settings.paused);
    assert_eq!(settings.cpu_share, 0.25);
    assert_eq!(
        settings.overnight,
        Overnight { start_hour: 22, end_hour: 6, utc_offset_minutes: -240, cpu_share: 0.9 }
    );
    assert_eq!(settings.planner.budget_bytes, 1_000_000);
    assert_eq!(settings.planner.bytes_per_runout, 3_000_000);
    assert_eq!(settings.planner.bytes_per_flop_tree, 500_000);
    assert_eq!(settings.planner.k_runouts, 12);
    assert_eq!(settings.planner.k_runouts_rare, 4);
    assert_eq!(settings.planner.k_frequent_pairs, 2);
    assert_eq!(settings.plan_configs, vec!["cfg_6_online_150".to_owned()]);
    assert_eq!(settings.target_pct_pot, 0.5);
    assert_eq!(settings.max_iterations, 900);
    assert_eq!(settings.max_seconds_per_line, 60);
    assert_eq!(settings.storage_bits, 16);
    assert_eq!(settings.memory_cap_bytes, 1_073_741_824);
    assert_eq!(settings.max_attempts, 5);
    assert_eq!(settings.stale_hours, 2);
    assert_eq!(settings.verify_interval_hours, 12);
    assert_eq!(settings.plan_interval_minutes, 15);
    assert_eq!(settings.poll_seconds, 5);
    assert_eq!(KEYS.len(), 20, "the table in the module docs");
}

#[test]
fn r2_18_a_malformed_key_falls_back_alone_and_is_named() {
    let (settings, errors) = BuilderSettings::from_rows(&rows(&[
        ("cpu_share", json!("lots")),
        ("k_runouts", json!(7)),
        ("budget_bytes", json!(-5)),
        ("max_attempts", json!(0)),
    ]));
    assert_eq!(settings.cpu_share, 0.5, "the default");
    assert_eq!(settings.planner.k_runouts, 7, "a good key next to a bad one is kept");
    assert_eq!(settings.planner.budget_bytes, 650_000_000_000);
    assert_eq!(settings.max_attempts, 3);
    let keys: Vec<&str> = errors.iter().map(|error| error.key.as_str()).collect();
    assert_eq!(keys, ["cpu_share", "budget_bytes", "max_attempts"]);
    assert!(errors.iter().all(|error| error.reason.contains("default")), "{errors:?}");
}

#[test]
fn r2_18_out_of_range_shares_and_unknown_keys_are_errors() {
    let (settings, errors) = BuilderSettings::from_rows(&rows(&[
        ("cpu_share", json!(1.5)),
        (
            "overnight",
            json!({"start_hour": 25, "end_hour": 6, "utc_offset_minutes": 0, "cpu_share": 1.0}),
        ),
        ("k_runoutz", json!(20)),
    ]));
    assert_eq!(settings.cpu_share, 0.5);
    assert_eq!(settings.overnight, Overnight::default());
    let keys: Vec<&str> = errors.iter().map(|error| error.key.as_str()).collect();
    assert_eq!(keys, ["cpu_share", "overnight", "k_runoutz"]);
}

#[test]
fn r2_18_sixteen_bit_storage_needs_a_target_of_at_least_half_a_percent() {
    let (settings, errors) = BuilderSettings::from_rows(&rows(&[
        ("storage_bits", json!(16)),
        ("target_pct_pot", json!(0.3)),
    ]));
    assert_eq!(settings.storage_bits, 32, "O-194: 16-bit is refused below 0.5 percent");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].key, "storage_bits");
    let (allowed, errors) = BuilderSettings::from_rows(&rows(&[
        ("storage_bits", json!(16)),
        ("target_pct_pot", json!(0.5)),
    ]));
    assert_eq!(errors, Vec::new());
    assert_eq!(allowed.solve_options().storage, StorageBits::Sixteen);
    assert_eq!(BuilderSettings::default().solve_options().storage, StorageBits::ThirtyTwo);
    let (odd, errors) = BuilderSettings::from_rows(&rows(&[("storage_bits", json!(8))]));
    assert_eq!(odd.storage_bits, 32);
    assert_eq!(errors[0].key, "storage_bits");
}

#[test]
fn r2_18_the_boost_window_sets_the_share_and_the_threads() {
    let settings = BuilderSettings::default();
    assert_eq!(settings.share_at(60), 1.0, "01:00 UTC is in the default 0 to 7 window");
    assert_eq!(settings.share_at(12 * 60), 0.5, "noon is outside it");
    assert_eq!(settings.share_at(7 * 60), 0.5, "the end hour is outside the window");
    assert_eq!(settings.threads(18, 60), 18);
    assert_eq!(settings.threads(18, 12 * 60), 9);
    assert_eq!(settings.threads(1, 12 * 60), 1, "never below one thread");

    let (wrapped, errors) = BuilderSettings::from_rows(&rows(&[(
        "overnight",
        json!({"start_hour": 22, "end_hour": 6, "utc_offset_minutes": -240, "cpu_share": 0.75}),
    )]));
    assert_eq!(errors, Vec::new());
    // 03:00 UTC is 23:00 at UTC-4, inside a window that wraps midnight.
    assert_eq!(wrapped.share_at(3 * 60), 0.75);
    // 12:00 UTC is 08:00 local, outside it.
    assert_eq!(wrapped.share_at(12 * 60), 0.5);
    // 23:59 UTC is 19:59 local, outside; 02:00 UTC is 22:00 local, the inclusive start;
    // 10:00 UTC is 06:00 local, the exclusive end.
    assert_eq!(wrapped.share_at(MINUTES_PER_DAY - 1), 0.5);
    assert_eq!(wrapped.share_at(2 * 60), 0.75);
    assert_eq!(wrapped.share_at(10 * 60), 0.5);
}

#[test]
fn r2_18_each_attempt_runs_longer() {
    let settings = BuilderSettings::default();
    assert_eq!(settings.stop_rule(1).max_iterations, 20_000);
    assert_eq!(settings.stop_rule(3).max_iterations, 60_000);
    assert_eq!(settings.stop_rule(2).max_seconds, 1_800);
    assert_eq!(settings.stop_rule(2).target_exploitability_pct_pot, 0.3);
    assert_eq!(settings.solve_options().memory_cap_bytes, 5 * 1024 * 1024 * 1024);
}
