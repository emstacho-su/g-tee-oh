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

Both throwaway branches were closed and deleted after the runs above were recorded; the runs stay readable on GitHub.

## Conditions completed by S06

| Condition | Evidence | Result |
|---|---|---|
| CI green on `sprint/1-v1` on all seven jobs | pending S06 | |
| `docker compose --profile dev up` reaches healthy on the Zenbook | pending S02 and S06 | |
| Every vector is a pending test tagged with its R ID; zero untagged pending tests | pending S05 | |
| The `contracts` job fails on an uncommitted diff | pending S06 | |
| Private repo CI result for R0.8 | pending S03 | |
| Mac part status (R0.9) | pending S04 | |
