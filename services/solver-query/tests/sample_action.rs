//! `POST /v1/sample-action` over the packed synthetic fixture (R2.13, plan D.3, O-151).
//! Written red in S16 step 2: the handler is a stub answering 501 until lane C lands the
//! draw of plan C.5. The expected frequencies come from an independent reader, so they
//! carry the same 1/255 quantization the service reads.

mod common;

use axum::Router;
use axum::http::{HeaderMap, StatusCode};
use gto_library::{FsStore, NodeView, Reader, ReaderOptions};
use serde_json::{Value, json};

use common::packed_fixture;
use common::plant::class_name;

/// Draws per test and the width of the acceptance band in standard deviations.
const DRAWS: usize = 10_000;
const SIGMAS: f64 = 4.0;
/// A hand counts as mixed when two actions reach this frequency.
const MIXED_AT: f32 = 0.1;
/// The starting generator state.
const STATE: &str = "0000000000000001";
/// Slack for a roll on a band edge after f32 rounding.
const EDGE_SLACK: f64 = 1e-6;

/// A node index and hand of the fixture where two actions are played at `MIXED_AT` or more.
fn mixed_decision(fixture: &common::Fixture) -> (usize, u16, Vec<f32>) {
    let store = FsStore::new(&fixture.root).expect("the root exists");
    let reader = Reader::new(store, ReaderOptions::default());
    let handle = reader.open(&fixture.prefix).expect("the solution opens");
    for (index, node) in fixture.nodes.iter().enumerate() {
        let view: NodeView = reader.node(handle, &node.key).expect("the node reads");
        for hand in view.hands() {
            let frequencies = view.frequencies(hand).expect("the hand is held");
            if frequencies.iter().filter(|f| **f >= MIXED_AT).count() >= 2 {
                return (index, hand, frequencies);
            }
        }
    }
    panic!("the synthetic fixture holds a mixed hand");
}

async fn sample(
    router: Router,
    id: &str,
    key: &str,
    hand: &str,
    state: &str,
) -> (StatusCode, HeaderMap, Value) {
    let body = json!({ "solution_id": id, "node_key": key, "hand": hand, "rng_state": state });
    common::post(router, "/v1/sample-action", &body).await
}

#[tokio::test]
async fn r2_13_sample_action_follows_the_frequencies() {
    let fixture = packed_fixture();
    let (index, hand, frequencies) = mixed_decision(&fixture);
    let key = fixture.key(index);
    let label = class_name(hand);
    let router = fixture.router();
    let mut counts = vec![0_usize; frequencies.len()];
    let mut state = STATE.to_owned();

    for draw in 0..DRAWS {
        let (status, _, json) =
            sample(router.clone(), &fixture.solution_id, &key, &label, &state).await;
        assert_eq!(status, StatusCode::OK, "draw {draw}: {json}");
        let action =
            usize::try_from(json["action_index"].as_u64().expect("an index")).expect("fits");
        assert!(action < frequencies.len(), "draw {draw}: {json}");
        assert_eq!(json["token"], fixture.nodes[index].actions[action].0.to_string(), "{json}");
        let roll = json["roll"].as_f64().expect("a roll");
        let before: f64 = frequencies[..action].iter().map(|f| f64::from(*f)).sum();
        let after = before + f64::from(frequencies[action]);
        assert!(roll >= before - EDGE_SLACK && roll < after + EDGE_SLACK, "draw {draw}: {json}");
        counts[action] += 1;
        state = json["rng_state"].as_str().expect("the next state").to_owned();
    }

    #[expect(clippy::cast_precision_loss, reason = "ten thousand draws")]
    let n = DRAWS as f64;
    for (action, count) in counts.iter().enumerate() {
        let p = f64::from(frequencies[action]);
        let expected = n * p;
        let sigma = (n * p * (1.0 - p)).sqrt();
        #[expect(clippy::cast_precision_loss, reason = "a count of at most ten thousand")]
        let observed = *count as f64;
        assert!(
            (observed - expected).abs() <= SIGMAS * sigma + 1.0,
            "action {action}: {count} of {DRAWS} at p {p}"
        );
    }
}

#[tokio::test]
async fn r2_13_sample_action_is_deterministic() {
    let fixture = packed_fixture();
    let (index, hand, _) = mixed_decision(&fixture);
    let key = fixture.key(index);
    let label = class_name(hand);

    let (status, _, first) =
        sample(fixture.router(), &fixture.solution_id, &key, &label, STATE).await;
    assert_eq!(status, StatusCode::OK, "body was {first}");
    let (_, _, second) = sample(fixture.router(), &fixture.solution_id, &key, &label, STATE).await;
    assert_eq!(first, second, "equal states give equal action, roll and next state");
    assert_ne!(first["rng_state"], STATE, "the generator advanced: {first}");
    assert_eq!(first["rng_state"].as_str().map(str::len), Some(16), "{first}");
}
