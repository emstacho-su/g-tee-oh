# Synthetic preflop fixture sets

This directory holds the definitions of the synthetic preflop sets in the fixture library (requirement R2.20). The code that builds them is the fixture-gen tool in tools/fixture-gen; the packed sets live under validation/fixtures/library/preflop/, next to the gate G6a push/fold solutions (O-225).

## How a set is built

sets.json lists each set with its name, its seed, its configuration ids and a fixed created_at timestamp. Each configuration id is a row of the v1 catalog (gto_model::v1_configs()), and a configuration belongs to one set only. When a set lists no pairs, every pair of seats at the table is built.

For each configuration and pair the generator does five things:

1. It builds the real preflop pair tree with gto-tree from the seed sizing convention of the format (seed-online.json or seed-live.json, O-136), so the node keys and action tokens are the ones the trainer navigates.
2. It seeds a ChaCha8 random number generator with the sha256 of the set seed, the configuration id and the pair, so every solution is independent of the others and of build order.
3. It fills every node with a seeded synthetic strategy (O-226). Each class gets a score, its equity percentile against a random hand from validation/fixtures/equity/preflop-169.json plus seeded noise. The actions at a node, passive to aggressive, take contiguous score bands of the actor's range, wide for an open and narrower for each later raise, and a smooth step at each band edge makes the classes near the edge mix. Reach per seat is the product of that seat's own frequencies along the line.
4. It gives each action an expected value (EV) in big blinds, read as the actor's expected final stack minus its stack behind (O-224): a fold is 0, the most frequent action has the best EV, and every other action loses a seeded positive amount scaled by the pot.
5. It writes a preflop_169 node dump (source reference, engine label synthetic) to a temporary directory outside the repository and packs it with library-pack, flagged synthetic and carrying the set seed. The pack applies the criterion 2 invariants, so a set that breaks them fails the generator.

The solution id is the sha256 of the dump (O-131). Nothing reads the clock, and only arithmetic is used (no platform math library), so two runs on any machine write the same bytes. After a configuration is packed, any synthetic solution an earlier seed left under its directory is removed; a solution without the synthetic flag is never touched.

## The sets

| Set | Seed | Configurations | Solutions |
|---|---|---|---|
| synthetic-6max | 6006 | cfg_6_online_100, cfg_6_online_150, cfg_6_online_200, all 15 pairs each | 45 |
| synthetic-live-13 | 1313 | cfg_9_live_13_100, all 36 pairs | 36 |
| synthetic-live-25 | 2525 | cfg_9_live_25_100, all 36 pairs | 36 |

The 6-max set includes BB-BTN at 100 big blinds, the line session S20 smoke-builds from (O-52, O-61). The two live sets hold the same lines at 1/3 and 2/5 under different configuration ids, so the same action resolves to different solutions with the stake's own rake cap, 167 and 100 centi-big-blinds (R3.21). Every manifest carries its set's seed at top level and created_at 2026-10-27T00:00:00Z. The 117 solutions take about 0.4 MB.

## What the sets are not

These are synthetic test data: every manifest says synthetic true and the trainer renders that flag as a banner (O-57). The strategies come from a seeded score model and were never solved, so they are never reference solutions and say nothing about how to play. They exist so that solver-query, the integration tests and the end-to-end flows have a library of real tree shapes to run against (O-30).

## Regenerating

From the repository root:

    cargo run --release -p fixture-gen

The tool reads sets.json and writes into validation/fixtures/library. It takes `--sets PATH` and `--out DIR` to read or write elsewhere. The tests in tools/fixture-gen/tests check that two runs are byte-identical, that a fresh run equals the committed library, and that every node of every committed tree reads back by its gto-tree key.

Open question identifiers (O-IDs): O-30, O-57, O-225, O-226.
