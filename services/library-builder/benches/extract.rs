//! Criterion bench `extract/runout_line` (O-190): extraction of one line's runout nodes.
//! Placeholder until S18 lane X measures the real call.

use criterion::{Criterion, criterion_group, criterion_main};

fn bench(c: &mut Criterion) {
    c.bench_function("extract/runout_line", |b| b.iter(|| std::hint::black_box(0_u64)));
}

criterion_group!(benches, bench);
criterion_main!(benches);
