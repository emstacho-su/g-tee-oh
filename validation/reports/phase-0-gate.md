# Phase 0 gate report (repo part)

Started by S01 on 2026-10-20 and completed by S06. Every row names the requirement identifier (R ID), the evidence and where it lives. The Mac part of the gate (R0.9) is recorded separately in `validation/reports/mac-bootstrap.md` when S04 lands.

## Evidence recorded by S01

| R ID | Condition | Evidence | Result |
|---|---|---|---|
| R0.2 | A throwaway branch adding an AGPL (GNU Affero General Public License) crate fails the `licenses` job | Branch `p0/foundations-throwaway-agpl` added `libmcaptcha` (AGPL-3.0) to `gto-planner`; pull request #2; run https://github.com/emstacho-su/g-tee-oh/actions/runs/39443022437 | `cargo deny check licenses` rejected AGPL-3.0 ("license is not explicitly allowed"), recipe exit code 4, job failed as required |
| R0.4 | A throwaway branch with a planted private-pattern file and a planted hashed identifier is rejected locally and in CI | Branch `p0/foundations-throwaway-guard` added `data/planted.har` and a note carrying a synthetic identifier whose salted hash was appended to `guard/denylist.sha256`; pull request #3; run https://github.com/emstacho-su/g-tee-oh/actions/runs/39443035473 | Local pre-commit hook rejected the commit with two findings (path pattern `**/*.har`, identifier hash prefix 9046eaa9); the commit was pushed with `--no-verify` and the `security` job failed with the same two findings, exit code 1 |
| R0.4 | `just guard-history` is clean on the full history | Run on 2026-10-20 at commit 82cbe63 | 55 files and 13,501 added lines scanned, 0 findings |
| R0.4 | Guard unit tests with synthetic planted strings | `just guard-test` | 81 tests, 0 failures |
| R0.1 | `just --list` shows the task surface; the commit-msg hook rejects a Claude commit without the trailer; the template carries the R ID field | `guard/test/justfile.test.mjs`, `guard/test/commit-msg.test.mjs`, `guard/test/pr-template.test.mjs` (part of `just guard-test`) | Pass |
| R0.12 | The guard passes on `docs/`; every file under `docs/` carries `public: true` | `just guard-paths docs` (37 files, 0 findings); `guard/test/docs-provenance.test.mjs` | Pass |
| R0.3 | Every job runs on a pull request; `e2e` and `images` skip cleanly while their targets do not exist | Pull request #1 at commit 34230b3: rust https://github.com/emstacho-su/g-tee-oh/actions/runs/39443705482, ts 39443705847, contracts 39443705770, e2e 39443705733, licenses 39443705521, security 39443705940, images 39443705556 | All seven green; `e2e` and `images` printed their skip notices |
| R0.1, R0.2 | `rust` and `ts` jobs green on the workspaces; the vendored crate builds and its tests pass in CI | The rust run above (fmt, clippy with `--no-deps`, own-crate tests, engine tests in release mode, boundary check) and the ts run (eslint, typecheck, Vitest, node:test policy suite) | Pass |
| R0.1, R0.3, R0.4 | All seven jobs green again on the review-fix commits (guard coverage of paths and commit messages, the gto-library edge removed) | Pull request #1 at commit 4b251ee: rust https://github.com/emstacho-su/g-tee-oh/actions/runs/39447077608, security 39447077524, ts 39447077267, contracts 39447077438, licenses 39447077754, e2e 39447077328, images 39447077625 | Pass; the guard suite is 87 tests |

Both throwaway branches were closed and deleted after the runs above were recorded; the runs stay readable on GitHub.

## Evidence recorded by S02

| R ID | Condition | Evidence | Result |
|---|---|---|---|
| R0.6 | Migrations apply to an empty database; `query` cannot write, `app` cannot see a schema named `capture`, `capture` inserts only its allowed rows; one `game_config` per v1 configuration | `just db-migrate` (11 applied), `just db-status`, `just db-test` (27 tests) on a native Postgres 18 because Docker was unavailable on 2026-10-20 evening; `dbmate rollback` then `up` for the seed migration | Pass |
| R0.6 | Kysely codegen and sqlx checks | `just codegen` wrote `packages/contracts/src/db.generated.ts`; `just codegen-check` up to date; `just sqlx-check` reports no crate carries a query yet | Pass |
| R0.10 | `just bench` writes `validation/reports/bench-zenbook.json` | File present with `solve_iteration/simple_tree_flop` (mean 42.3 ms) and the two stubs | Pass |
| R0.5 | `docker compose --profile dev up` reaches healthy; `just smoke` passes | Proven by the `e2e` job on pull request #4, run https://github.com/emstacho-su/g-tee-oh/actions/runs/39453172958: compose up with health checks, 11 migrations, 27 database tests, the smoke checks, then down. The Zenbook run is still owed: its Docker Desktop VM was out of memory from another project's container from 15:11Z on 2026-10-20 | Pass in CI and on the Zenbook (2026-10-20 after the Docker restart: every service healthy in 30 seconds, 11 migrations, 27 tests, 8 of 8 smoke checks) |
| R0.3 | Dockerfiles build for one service | On the Zenbook after the Docker restart: `solver-query` (127 MB) built in 47 seconds and prints its version line; `web` (93 MB) and `api` (500 MB placeholder) build and start | Pass locally; the `images` job builds in CI once S06 lists a service in the matrix |
## Evidence recorded by S06

| R ID | Condition | Evidence | Result |
|---|---|---|---|
| R0.7 | The contracts pipeline regenerates every artifact with no diff | Pull request #8 at commit 40110ad, contracts run https://github.com/emstacho-su/g-tee-oh/actions/runs/39518792843: migrations, `just contracts` (both OpenAPI documents, the openapi-typescript clients, the Kysely types, the schema copies), `just sqlx-check`, `git diff --exit-code` and the untracked-file check | Pass |
| R0.7 | The contracts job fails on an uncommitted diff | Throwaway branch `p0/contracts-throwaway-diff` changed the api health schema without regenerating; pull request #9; contracts run https://github.com/emstacho-su/g-tee-oh/actions/runs/39511466269 failed at "Fail on an uncommitted diff" naming `packages/contracts/api.openapi.json` and `src/api.generated.ts`; the ts run https://github.com/emstacho-su/g-tee-oh/actions/runs/39511466579 failed on "R0.7 the committed packages/contracts/api.openapi.json equals the served document" | Failed as required; the branch and pull request were closed and deleted |
| R0.7 | Skeleton and schema tests | `cargo test -p solver-query` (22 tests), `pnpm --filter @g-tee-oh/contracts test` (25), `pnpm --filter @g-tee-oh/api test` (12), `pnpm --filter @g-tee-oh/web test` (7), `node --test "scripts/**/*.test.mjs"` (58) | Pass |
| R0.3 | The e2e job brings up the dev profile with FIXTURE_LIBRARY_PATH set, runs the smoke checks and the Playwright flow | e2e run https://github.com/emstacho-su/g-tee-oh/actions/runs/39518792688: six services healthy, 11 migrations, 27 database tests, 10 smoke checks including the fixture library mount seen from inside solver-query, the Playwright smoke flow | Pass |
| R0.3 | The images job builds solver-query for amd64 and arm64 | Images run https://github.com/emstacho-su/g-tee-oh/actions/runs/39518792821 | Pass after the shared cargo cache mounts were locked (the first multi-arch run raced on the registry) |
| R0.5 | `just e2e` on the Zenbook | 2026-10-20 evening at the review-fix commit: postgres, seaweedfs, solver-query, api, web and caddy healthy with api and web read only and without capabilities, 27 database tests, 10 of 10 smoke checks, Playwright 1 passed, in 28 seconds with built images | Pass |

## Definition of Done, repo part

| Condition | Evidence | Holds |
|---|---|---|
| All seven jobs green on `sprint/1-v1` | All seven green on pull request #8 at 40110ad (runs above); the `sprint/1-v1` run after the merge is appended by a one-line `p0/gate-link` docs commit | Not yet: pending the merge |
| `docker compose --profile dev up` reaches healthy on the Zenbook | The S02 row and the S06 `just e2e` row | Holds |
| The guard rejects the planted path and the planted identifier locally and in CI | The S01 R0.4 rows | Holds |
| Every vector is a pending test tagged with its R ID; zero untagged pending tests | `just test-tags` on `sprint/1-v1` after pull request #6 (S05): 83 pending tests, all tagged | Holds |
| The contracts job fails on an uncommitted diff | The throwaway row above | Holds |
| This file records R0.2, R0.8 and the Mac part status | This file | Holds |

## Requirement artifacts R0.1 to R0.12

| R ID | Where the evidence is | Holds |
|---|---|---|
| R0.1 | S01 rows (workspaces, task surface, hooks, template) | Holds |
| R0.2 | S01 rows (AGPL throwaway, vendored engine builds and tests) | Holds |
| R0.3 | S01 rows (seven jobs), S02 row (Dockerfiles), S06 rows (e2e with the fixture path, multi-arch images) | Holds |
| R0.4 | S01 rows (planted inputs, history scan, guard tests) | Holds |
| R0.5 | S02 row and the S06 Zenbook row | Holds |
| R0.6 | S02 rows (migrations, roles, seed, codegen) | Holds |
| R0.7 | S06 rows | Holds |
| R0.8 | Private capture repository CI on its sprint branch after its pull request #1 merged: https://github.com/emstacho-su/g-tee-oh-capture/actions/runs/39463601602 (private). Result only: guard, lint, typecheck, unit tests, migrations and database tests green | Holds |
| R0.9 | Mac bootstrap (S04) | Not yet: pending, deadline S20 (O-67) |
| R0.10 | S02 row (`bench-zenbook.json`) | Holds |
| R0.11 | S05 pull request #6: pending vectors tagged, toy-game fixtures, OpenSpiel curve, report schema, `just test-tags` | Holds |
| R0.12 | S01 row (docs mirror) | Holds |

## Merges

| Session | Pull request | State |
|---|---|---|
| S01 foundations | #1 | Merged into `sprint/1-v1` |
| S02 infra | #5 | Merged |
| S03 capture repository | private #1 | Merged into the private sprint branch |
| S05 test vectors | #6 | Merged |
| S06 contracts | #8 | Open when this file was written; merges after review |
| S04 Mac bootstrap | none yet | Pending (needs the owner at the Mac) |

## Mac part

Pending as of 2026-10-20. Deadline: S20, the first deploy (O-67). Its report will be `validation/reports/mac-bootstrap.md`.

## Partial success criteria

- Criterion 11 (keying data): seeded. Three stakes and eleven `game_config` rows, pinned by the R0.6 seed test and by the gto-model catalog test (O-112).
- Criterion 10 (performance): the Zenbook baseline is in `bench-zenbook.json`; the Mac precondition waits on R0.9.
- Criteria 1, 4, 6 and 7: scaffolded as pending tests tagged with their R IDs (R0.11).
- No criterion closes in Phase 0, and nothing is deployed (O-20).

## sprint/1-v1 run

Appended by the `p0/gate-link` commit after pull request #8 merges.
