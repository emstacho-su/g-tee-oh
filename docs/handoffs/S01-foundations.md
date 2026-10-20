---
id: 'g-tee-oh-handoff-s01-foundations'
title: 'S01 Foundations'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 0
session: 'S01'
branch: 'p0/foundations'
tags: [g-tee-oh, handoff, phase-0]
---
# S01 Foundations (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-0-foundations|Phase 0 Foundations and test scaffolding]]. This session produces the public monorepo scaffold: the Cargo and pnpm workspaces, the vendored engine, the seven continuous integration (CI) jobs, the private-data guard with its hashed denylist, the conventions in CLAUDE.md and the `docs/` mirror seed (R0.1 to R0.4, R0.12). Branch `p0/foundations` off `sprint/1-v1`. Parallel group A, earliest day 1 (2026-10-20), paced week 1 and first in the queue (09 sections 4 and 5). Its scaffold step runs as a dynamic workflow. Public. Usage high (3 units).

## Before pasting

- [ ] No session must be merged first: S01 is the first session of the sprint (09 section 3).
- [ ] The public repo exists at https://github.com/emstacho-su/g-tee-oh with at least one commit on `main`, is cloned at `C:\Users\stack\projects\g-tee-oh`, and `gh auth status` succeeds in PowerShell.
- [ ] Zenbook toolchains: rustup stable (native Windows), just, cargo-deny, Node 24, pnpm, Docker Desktop with the Windows Subsystem for Linux 2 (WSL2) backend (O-23).
- [ ] The vault is readable through `/add-dir`; the files flagged `public: true` there are the `docs/` mirror set (O-45).
- [ ] The owner has the identifiers for the plain denylist at hand (planning/00 O-7 names one) and can add a repository secret with `gh secret set` (O-58).

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
if (-not $?) { git switch -c sprint/1-v1 origin/main; git push -u origin sprint/1-v1 }
git pull
git switch -c p0/foundations
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault and append open-question identifiers (O-IDs) to `planning/00-open-questions-and-risks.md`.
2. Stay in the default permission mode.
3. Paste the prompt.

## The prompt

```text
You are running session S01 of sprint 1 of g-tee-oh, Phase 0 (Foundations and test scaffolding), on branch p0/foundations off the sprint branch sprint/1-v1. Goal: the monorepo scaffold, the vendored engine, the seven CI jobs, the private-data guard with the hashed denylist, the conventions and the docs mirror seed (R0.1 to R0.4, R0.12).

## Reading order
The vault is C:\Users\stack\vault\projects\g-tee-oh (added with /add-dir). Read in order:
1. planning/phases/phase-0-foundations.md
2. planning/09-v1-sprint-roadmap.md: sections 1, 3, 5 (row S01), 6 (Phase 0), 7 (gate rows), 8 (risk R-11)
3. planning/00-open-questions-and-risks.md: O-17 to O-67, especially O-23, O-25, O-26, O-28, O-29, O-45, O-56, O-58, O-62
4. planning/architecture/A1-repo-and-conventions.md (all); planning/architecture/A9-quality-security-ops.md sections 1 to 3
5. planning/02-architecture.md sections 6 and 7 (the guard's file patterns are in section 7)
6. decisions/_README.md, then architecture decision records (ADRs) 0001, 0002, 0004, 0005, 0017, 0019
7. The repo's CLAUDE.md does not exist yet; this session writes it.

## Rules
- Clone C:\Users\stack\projects\g-tee-oh, Claude Code in PowerShell, native Windows Rust toolchain; WSL2 only for Linux container builds and benchmarks (O-23).
- Branch p0/foundations; merge by pull request into sprint/1-v1; sprint/1-v1 merges into main only in S35 (R4.18).
- Gates in order: plan first (plan mode, write the plan, wait for approval), concrete task list, smallest working increment, tests green (never advance on red; write the suite if none exists), /code-review with CRITICAL and HIGH fixed, /security-review (this session touches CI secrets and hooks, so it applies), conventional commits (feat:, fix:, chore:, refactor:, docs:, test:, perf:, ci:) ending with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Test-driven: red test tagged with its requirement identifier (R ID) first, then green, then refactor; 80 percent coverage or better on new code.
- Accepted ADRs are fixed. ADR 0004 and 0013 count as accepted (O-25); ADR 0005's dbmate, Kysely and sqlx parts are accepted (O-56). Cite O-IDs and ADR numbers in CLAUDE.md, commit bodies and the report.
- Privacy boundary (O-26, ADR 0017, ADR 0021): nothing GTO Wizard-specific (GTO stands for game theory optimal) enters this repo: no routes, payload shapes, game type codes, drill parameter names, capture methods, tier codes, volumes, screenshots, browser session mechanics or capture tool names. Naming GTO Wizard as the product being emulated is allowed. The plain denylist and the salt go to the gitignored folder .guard-private/ on this machine and move to the private repo in S03 (O-58); never echo them in the repo, the report or the pull request.
- Documentation you write: no em dashes or en dashes, no bold, acronyms expanded on first use, mechanism before conclusion.
- A step runs as a dynamic workflow only where this prompt says so, under 10 agents, with the verifier's checks named.
- Report honestly at every gate: show failing output, name any skipped step.

## Inputs
- The upstream engine repository named in ADR 0002, at the commit you pin and record in crates/vendor/postflop-engine/UPSTREAM.md.
- The vault files flagged public: true at session time (grep the vault for "^public: true"): planning/09, the public phase docs and the public handoffs.
- From the owner: the plain identifiers for the denylist and a GUARD_SALT repository secret.

## Requirements this session closes
- R0.1 Monorepo per A1: Cargo and pnpm workspaces, justfile, CLAUDE.md with the branch rules (O-28), the trailer rule (O-29), the clone path, the shell and the toolchain split (O-23), .claude deny rules, a pull request template listing R IDs. Proof: CI rust and ts jobs green on the empty workspaces; just --list shows the task surface; a commit-msg hook rejects a Claude commit without the trailer; a test asserts the template carries the R ID field.
- R0.2 Engine vendored by git subtree into crates/vendor/postflop-engine, Massachusetts Institute of Technology (MIT) license notice kept, UPSTREAM.md records the commit; cargo-deny and the pnpm license check block the GNU General Public License (GPL) and the GNU Affero General Public License (AGPL) (ADR 0002). Proof: the vendored crate builds in CI; licenses job passes; a throwaway branch adding an AGPL crate fails the licenses job, recorded in validation/reports/phase-0-gate.md.
- R0.3 (job definitions only; S02 adds the Dockerfiles and S06 closes the end-to-end (e2e) smoke and the one-service build): the seven jobs rust, ts, contracts, e2e, licenses, security, images per A9 section 2. Proof: every job runs on a pull request; e2e and images skip cleanly while their targets do not exist yet.
- R0.4 Private-data guard as a pre-commit hook and a CI check: file patterns (02 section 7) plus an identifier denylist stored as salted sha256 hashes (O-58); just guard-history scans the full history. Proof: unit tests with synthetic planted strings; a throwaway branch with a planted private-pattern file and a planted hashed identifier is rejected locally and in CI.
- R0.12 docs/ mirror of the flagged files with a docs/security.md threat-model stub (A9 section 3). Proof: the guard passes on docs/; a test that every file under docs/ carries public: true.

## Steps
1. (single) Read, then plan in plan mode and wait for approval. The plan lists the crate stubs (gto-model, gto-tree, gto-solve, gto-library, gto-planner, services/solver-query, services/library-builder, tools/validate, tools/library-pack) with the A1 section 2 dependency edges, the package stubs (web, services/api, packages/contracts, packages/learning), the justfile targets, the seven workflow files, the guard design and the mirror set.
2. (single) git subtree add the engine at the pinned commit, keep its MIT notice, write UPSTREAM.md, confirm cargo build -p postflop-engine on the native toolchain. Commit.
3. (dynamic workflow, under 5 agents: a Cargo agent for the workspace and crate stubs with their dependency edges and a first cargo test per crate; a pnpm agent for the workspace, package stubs, eslint, typecheck and Vitest; a CI agent for the seven workflow files, the guard with its unit tests, the pre-commit and commit-msg hooks, CLAUDE.md, .claude settings and the pull request template; the verifier agent runs the planted-file and planted-identifier tests and the licenses job on a throwaway AGPL dependency). Use a dynamic workflow for this step, under 5 agents. Guard design: the pattern check needs no secret; the identifier check hashes each diff token as sha256(salt + token) and compares with guard/denylist.sha256; the salt comes from the GUARD_SALT environment variable (locally from .guard-private/, in CI from the repository secret) and the check fails closed with a clear message when the salt is missing on a non-fork run. The commit-msg hook treats a commit as a Claude commit when the CLAUDECODE environment variable is set, or an equivalent you verify.
4. (single) Generate the salt and the hashed list from the owner's plain identifiers, set the GUARD_SALT secret with gh secret set, and keep the plain inputs only under .guard-private/, which the guard patterns and .gitignore both cover.
5. (single) Docs mirror seed (R0.12): a just docs-mirror target that copies the files flagged public: true from the vault path in VAULT_DIR into docs/ keeping their relative paths, docs/security.md as a stub with public: true, and the provenance test.
6. (single) Throwaway proofs: push p0/foundations-throwaway-agpl with an AGPL crate and p0/foundations-throwaway-guard with a planted pattern file and a planted hashed identifier; confirm the licenses and security jobs fail and the local hook rejects the guard commit; start validation/reports/phase-0-gate.md with the run links and results for R0.2 and R0.4 (S06 completes the file); delete both throwaway branches.
7. (single) /code-review, /security-review, then open the pull request into sprint/1-v1 with the R IDs in the template.

## Definition of done
- [ ] rust, ts, licenses, security, contracts jobs green on the pull request; e2e and images run and skip cleanly
- [ ] Guard unit tests green; both throwaway branches rejected and recorded in validation/reports/phase-0-gate.md; branches deleted
- [ ] Commit-msg hook test and pull request template test green; just --list shows the task surface
- [ ] docs/ mirror present with docs/security.md; provenance test green; guard clean on docs/
- [ ] No plain identifier or salt anywhere in the repo or its history; .guard-private/ gitignored
- [ ] /code-review and /security-review done; pull request opened into sprint/1-v1

## Report back
The final message lists each R ID (R0.1, R0.2, R0.3 job part, R0.4, R0.12) with its test command and result; the branch and pull request link; the files written; the gate artifact validation/reports/phase-0-gate.md (draft); usage notes (units used against the planned high level); and any new question as a proposed O-ID with a default, appended to planning/00-open-questions-and-risks.md under a new dated subsection.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| `Cargo.toml`, `pnpm-workspace.yaml`, `justfile`, crate and package stubs | repo root, `crates/`, `services/`, `tools/`, `packages/`, `web/` |
| `crates/vendor/postflop-engine/` with its MIT notice and `UPSTREAM.md` | repo, by git subtree |
| CLAUDE.md, `.claude/settings.json` deny rules, hooks, `.github/PULL_REQUEST_TEMPLATE.md` | repo |
| `.github/workflows/` with the seven jobs | repo |
| Guard tool, `guard/denylist.sha256`, unit tests, `just guard-history` | repo; plain list and salt only in `.guard-private/` until S03 |
| `docs/` mirror and `docs/security.md` stub | repo |
| `validation/reports/phase-0-gate.md` (draft with the R0.2 and R0.4 runs) | repo, completed by S06 |
| Pull request `p0/foundations` into `sprint/1-v1` | GitHub |
| New O-IDs, if any | vault `planning/00-open-questions-and-risks.md` |
