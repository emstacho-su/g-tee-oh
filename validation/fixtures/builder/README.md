# Builder fixtures

Hand-made inputs of the library builder (S18; requirement identifiers (R IDs) R2.12 and R2.16 to R2.18). Before the first preflop configuration is packed, the builder has no published preflop solution to read flop ranges from, so its tests and the Zenbook flop-line benchmark use the ranges in this directory (open question identifiers (O-IDs) O-83, O-181 and O-201). Every range is hand-made from the rules of hold'em and common public opening and defending widths; nothing here comes from a reference tool or from captured data (O-26, architecture decision records (ADRs) 0017 and 0021).

| File | What it is | Read by |
|---|---|---|
| `tiny-bb-btn-srp.json` | A ranges fixture: five specific combos a side for the button (BTN) versus big blind (BB) single-raised pot of `cfg_6_online_100`, none on the flop `Ah7d2c` | `BUILDER_RANGES_FIXTURE` in the integration tests; `tiny-bb-btn-srp.spec.json` |
| `tiny-bb-btn-srp.spec.json` | A job spec (O-205): the tiny ranges on `Ah7d2c`, K = 2, the S02 placeholder sizing convention of `cfg_6_online_100` | the real-solve tests; `library-builder --once --job-spec` |
| `bench-bb-btn-srp.ranges.json` | A ranges fixture: a BTN opening range and a BB flatting range for the O-52 line | `bench-bb-btn-srp.json` |
| `bench-bb-btn-srp.json` | The judged benchmark job (O-50, O-200): flop `Kh7d2c`, K = 20, 32-bit storage, target 0.3 percent of the pot, 1,800 seconds per line | the benchmark run behind `validation/reports/bench-flop-line-zenbook.md` |
| `bench-bb-btn-srp.16bit.json` | The informational twin: 16-bit storage at 0.5 percent of the pot, the O-194 floor | the same report, as an informational row |

## Ranges fixture, `schema_version` 1

`id` (the file stem), `sources` (citations), `config_id`, `lines` (each with `position_pair`, `line` as dotted text such as `r250.c`, and `oop` and `ip` in the engine's range notation, weights written `:0.5`) and `notes`. The loader (`library_builder::ranges::FixtureRanges`) rejects an unknown field, a repeated pair and line, and a range that does not parse.

## Job spec, `schema_version` 1

`id`, `config_id` (in `gto_model::v1_configs`), `position_pair`, `flop` (raw), `lines`, `k_runouts`, `seed` (the runout draw), `convention` (a sizing convention spec), `ranges_fixture` (relative to the spec), `settings` (`builder_setting` keys and values, O-188) and `synthetic`. The `convention` of every spec here is the S02 placeholder of `cfg_6_online_100` from `db/migrations/20261020001100_seed_catalog.sql`, and a test in `services/library-builder/tests/spec_bench.rs` pins it to the seed.
