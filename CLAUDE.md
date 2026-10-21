# CLAUDE.md

Operating model for Claude Code sessions in g-tee-oh.

## What this is

g-tee-oh is a personal, self-hosted no-limit hold'em cash trainer and solver. It is library-first (architecture decision record (ADR) 0018): every spot a user studies or trains on is served from a solutions library built in the background, so no request path ever starts a solve.

## Machine and toolchain (O-23)

- Clone: C:\Users\stack\projects\g-tee-oh. Claude Code runs in PowerShell.
- Rust uses the native Windows toolchain (rustup stable, cargo, cargo-deny, cargo-audit). Windows Subsystem for Linux 2 (WSL2) is used only for Linux container builds and benchmarks.
- Node 24 with pnpm for TypeScript, just for tasks, Docker Desktop with the WSL2 backend for containers.
- The vault at C:\Users\stack\vault\projects\g-tee-oh is added with /add-dir and holds the plan, the phase docs and the session handoffs. The files flagged public: true there are mirrored into docs/ by just docs-mirror.

## Branches and commits (O-28, O-29, A1 section 4)

- Phase work happens on p<phase>/<slug> branched off sprint/1-v1, for example p0/foundations.
- Pull requests go into sprint/1-v1. main is touched only by the release session.
- Conventional commits: feat:, fix:, chore:, refactor:, docs:, test:, perf:, ci:, with an optional scope such as feat(gto-library): ....
- Every commit made by Claude ends with this trailer line; the commit-msg hook enforces it whenever CLAUDECODE is set:
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
- Requirement identifiers (R IDs, written R<phase>.<n>) tag tests by name or description and pull requests through the template's "R IDs closed:" list.

## Task surface

just is the single command surface and continuous integration (CI) calls the same recipes. just --list shows them:

- rust-fmt, rust-clippy, rust-test, rust-boundary
- ts-lint, ts-typecheck, ts-test
- gates, gates-check, equity-table, report-check
- contracts, contracts-check, e2e, e2e-web, licenses, security, images, bench
- library-size-estimate, coverage-library
- guard, guard-ci, guard-history, guard-paths DIR, guard-test, test-tags
- docs-mirror, hooks, ci

Run just hooks once per clone so git uses .githooks (pre-commit guard, commit-msg trailer check).

## Development gates

1. Plan first in plan mode and wait for approval; trivial one-liners are exempt.
2. Write a concrete task list before touching code.
3. Implement the smallest working increment.
4. Tests green before advancing; write the suite if none exists; tag tests with R IDs.
5. /code-review, with CRITICAL and HIGH findings fixed.
6. /security-review when the change touches auth, user input, secrets, endpoints or CI.
7. Conventional commit with the trailer.

Report honestly at each gate: show failing output and name any skipped step.

## Privacy boundary (O-26, O-58, ADR 0017, ADR 0021)

Nothing specific to GTO Wizard (GTO stands for game theory optimal) enters this repo: no routes, payload shapes, game type codes, drill parameter names, capture methods, tier codes, volumes, screenshots or capture tool names. Naming GTO Wizard as the product being emulated, and comparing features, is allowed.

- .guard-private/ holds the plain denylist and the salt. Never read, print, copy or quote anything under it; .claude/settings.json denies the Read tool there and .gitignore keeps it out of git.
- guard/denylist.sha256 holds salted sha256 hashes and is safe to read. The guard (guard/README.md) blocks private file patterns and hashed identifiers at pre-commit and in CI; just guard-history scans the whole history.
- When the guard reports a finding, fix the content. Never weaken the patterns or the denylist to get past it.

## Dependency rules

- solver-query never depends on gto-solve (A1 section 2, ADR 0018). just rust-boundary checks cargo tree and CI fails on a violation. That is how "no request path starts a solve" is enforced at compile time.
- Lower layers never import higher ones: gto-model has no dependency on solving; packages/learning is pure TypeScript with no input/output, no clock and no randomness beyond an injected random number generator (RNG).
- License policy (ADR 0002): the repo is MIT (Massachusetts Institute of Technology license); cargo-deny and the pnpm license check block the GNU General Public License (GPL) and the GNU Affero General Public License (AGPL).

## Vendored engine

- crates/vendor/postflop-engine is a git subtree of the upstream engine named in ADR 0002, with its MIT notice kept and the pinned commit recorded in crates/vendor/UPSTREAM-postflop-engine.md, outside the subtree prefix.
- Never edit files under crates/vendor. Changes the engine needs go into gto-solve adapters; .claude/settings.json denies Edit and Write there.
- Its tests run in release mode only (cargo test -p engine --release, part of just rust-test) because an upstream debug-only assertion in src/br.rs misfires on zero-sum games with a negative game value.

## Report-back format

The final message of a session lists each R ID with its test command and result, then the branch and pull request link, the files written, and any new question as a proposed open question identifier (O-ID) with a default, for example:

- R0.4: node --test "guard/test/*.test.mjs": 79 passed, 0 failed
- R0.1: just --list: every contract recipe listed
