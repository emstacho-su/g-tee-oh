//! Criterion bench `plan/enumerate_pair` (O-190): the planner's enumeration of one
//! configuration. Placeholder until S18 lane P measures the real call.

use criterion::{Criterion, criterion_group, criterion_main};

fn bench(c: &mut Criterion) {
    c.bench_function("plan/enumerate_pair", |b| b.iter(|| std::hint::black_box(0_u64)));
}

criterion_group!(benches, bench);
criterion_main!(benches);
