---
id: 'g-tee-oh-handoff-s49-eight-handed-config'
title: 'S49 Eight-handed v1 configuration'
collection: 'g-tee-oh'
type: handoff
status: 'ready 2026-11-09'
created: 2026-11-09
public: true
phase: 1
session: 'S49'
branch: 'p1/eight-handed-config'
tags: [g-tee-oh, handoff, phase-1]
---
# S49 Eight-handed v1 configuration (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-1-data-acquisition|Phase 1 Data acquisition and aggregation]]. This session adds 8-handed (8-max) as a v1 configuration in the public repo: catalog rows in gto-model, a new seed migration, and the tests and docs that count the catalog (O-539). It gates S10's pack row insert and S20b's first real build. Public single session, no workflow, low usage (about 1 unit). Branch `p1/eight-handed-config` off `sprint/1-v1` in `C:\Users\stack\projects\g-tee-oh`. Raised 2026-11-09 when the owner moved 8-max ahead of 6-max (O-537 to O-539, O-544, O-545).

## Before pasting

- [ ] planning/00 has the section "Owner directive: 8-max first (2026-11-09)" with O-537 to O-549.
- [ ] Docker Desktop is running (the database and api tests use containers).
- [ ] No other session is editing `crates/gto-model` or `db/migrations` in this clone.

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull
git switch -c p1/eight-handed-config
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh`.
2. Stay in the default permission mode.
3. Paste the prompt.

## The prompt

```text
Role and context
You are running session S49 of sprint 1 of g-tee-oh, a personal self-hosted no-limit hold'em cash trainer and solver. Public repo, branch p1/eight-handed-config off sprint/1-v1. Goal: add 8-handed as a v1 configuration at 100, 150 and 200bb so S10 can insert the first pack's rows and S20b can build its line (O-539, O-545).

Reading order (vault root V = C:\Users\stack\vault\projects\g-tee-oh)
1. V\planning\00-open-questions-and-risks.md: the section "Owner directive: 8-max first (2026-11-09)" (O-537 to O-549), plus O-7, O-18, O-52, O-112, O-132
2. V\decisions\0018 (library-first) and 0025 (Phase 1 replan)
3. V\planning\09-v1-sprint-roadmap.md sections 11.5 and 11.9
4. The repo's CLAUDE.md; crates/gto-model/src/config.rs and types.rs; db/migrations/20261020000400_catalog.sql and 20261020001100_seed_catalog.sql; db/README.md

What a read-only survey found on 2026-11-09 (verify, do not trust blindly)
- The grammar, TableSize (2 to 9), SQL CHECKs, JSON schemas, OpenAPI patterns and every seat table already accept 8. Position::seated(8) is UTG, UTG1, LJ, HJ, CO, BTN, SB, BB (types.rs about line 396). "UTG+1" is a display label only; parsing it is rejected on purpose.
- The work: v1_configs() in config.rs plus a NEW seed migration (do not edit the applied seed; Deploy 1 is live on the Mac), and the tests that count or parse the catalog: crates/gto-model/tests/catalog_seed.rs (CONFIG_ROWS 11), crates/gto-tree/tests/r2_9_spec.rs, packages/contracts/test/sizing-convention.test.ts, crates/gto-model/tests/rake_and_buckets.rs (11 total, 3 online, 8 live; exactly one online stake), db/test/seed.test.mjs, db/test/migrations.test.mjs, services/api/test/catalog.test.ts (ids, paging, stake lists), services/api/test/session-harness.test.ts; docs in config.rs, types.rs, lib.rs, db/README.md.
- The seed's base sizing rows are keyed by format (live open 4.0bb, online 2.5bb). An 8-handed live row with a 2.5bb open needs its own base row; the format-keyed join breaks otherwise.
- Risk: crates/gto-library/src/synthetic.rs picks a config with random_range over v1_configs().len(), so a longer list moves every seeded synthetic fixture (solver-query tests, library-pack round trip, validation/reports/library-size-estimate.md; services/solver-query/tests/coverage.rs assumes a specific config).
- Risk: spot classes key on format, depth band and pair, not table size, so 8-handed and 9-handed live share learning classes, and web/src/progress/drill-family.ts matchingConfigs picks the first id (cfg_8 sorts before cfg_9).
- Estimate: 12 to 14 files, 200 to 250 lines, no contract regeneration, no web code change.

Decisions to apply (proposed defaults in planning/00; confirm or change them with me in plan mode)
- O-546: format live; ids cfg_8_live_13_100, _150, _200 and cfg_8_live_25_100, _150, _200 (six rows, reusing the 1/3 and 2/5 live stakes and their rake); a separate 8-handed base sizing row with the 2.5bb open, replaced by the derived convention when S10 inserts it (R1.6).
- O-547: the pack's lack of rake is S10's concern, not this session's; add nothing no-rake-specific here (O-544).
- O-548: accept shared live learning classes for 8 and 9 handed in v1; note it in db/README.md.
- O-549: freeze the synthetic draw to the original eleven configurations so no seeded fixture moves; a test pins it.

Rules
- Gates in order: plan first (plan mode, wait for my approval); task list; red tests first, tagged R0.6 and R2.2 (R3.2 for api catalog tests); smallest increment; tests green, never advance on red; /code-review with CRITICAL and HIGH fixed; /security-review because the change touches a migration; conventional commits.
- Commits end with "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (the commit-msg hook requires it, O-513); add the trailer for the model actually running as a second line.
- Privacy boundary (O-26, ADR 0017, ADR 0021): no reference-tool game type code, label, tier or capture detail in ids, stake labels, comments, tests or the pull request.
- Do not edit crates/vendor. Do not apply migrations to the Mac; Deploy 2 or S20b applies them with my explicit yes (O-20).
- Never push without my say-so in this session; open the pull request into sprint/1-v1 only when I say.

Steps
1. (single) Plan mode: confirm the survey's touchpoints, list the tests that go red first, confirm O-546 to O-549 with me. Wait for approval.
2. (single) Red tests: the catalog counts (17 rows, 3 online, 14 live), an id assertion for cfg_8_live_13_150, the seed equals v1_configs() across both migrations, the 8-handed base sizing row, the frozen synthetic draw.
3. (single) Implement: v1_configs() rows appended in seed order with a depth constant [100, 150, 200]; optional TableSize::EIGHT_HANDED; the new migration with its down; the synthetic freeze; doc updates.
4. (single) Green: just rust-fmt, rust-clippy, rust-test, rust-boundary, ts-lint, ts-typecheck, ts-test, db-test, contracts-check, codegen-check, fixtures-check, guard. Watch the api R4.10 catalog deadline (about +168 solver calls).
5. (single) /code-review, /security-review, fixes, commit; report.

Definition of done
- [ ] Six cfg_8_live_* rows in v1_configs() and the new seed migration, the seed test reading both files
- [ ] Every count test updated and green; no synthetic fixture moved
- [ ] All listed just recipes green; guard clean
- [ ] /code-review and /security-review done
- [ ] Branch committed; pull request only on my word

Report back
R0.6, R2.2 and R3.2 with the test commands and results; the branch and commit list; the files written; any recipe that failed and why; any new question as a proposed O-ID with a default appended to V\planning\00-open-questions-and-risks.md under a new dated subsection.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| Six 8-handed rows in `v1_configs()` | `crates/gto-model/src/config.rs` |
| New seed migration with its down | `db/migrations/` |
| Updated catalog, seed, sizing and api tests | Rust, `db/test`, `packages/contracts/test`, `services/api/test` |
| Frozen synthetic draw and its test | `crates/gto-library/src/synthetic.rs` |
| Pull request into `sprint/1-v1` | GitHub, on the owner's word |
