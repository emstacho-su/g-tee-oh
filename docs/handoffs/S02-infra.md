---
id: 'g-tee-oh-handoff-s02-infra'
title: 'S02 Infra'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 0
session: 'S02'
branch: 'p0/infra'
tags: [g-tee-oh, handoff, phase-0]
---
# S02 Infra (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-0-foundations|Phase 0 Foundations and test scaffolding]]. This session produces the Compose `dev` profile, the Dockerfiles, the dbmate migrations with the four roles and the seeded catalog, the codegen wiring and the Zenbook benchmark baseline (R0.5, R0.6, R0.10, and the Dockerfile part of R0.3). Branch `p0/infra` off `sprint/1-v1`. Parallel group B, earliest day 2 (2026-10-21), paced week 1 after S12 (09 sections 4 and 5). Its build step runs as a dynamic workflow. Public. Usage medium (2 units).

## Before pasting

- [ ] S01 merged into `sprint/1-v1` (workspace, continuous integration (CI) jobs, guard; 09 section 3).
- [ ] Docker Desktop with the Windows Subsystem for Linux 2 (WSL2) backend is running on the Zenbook; ports 5432, 8333, 80 and 443 are free.
- [ ] The 2/5 live rake cap is not yet verified (O-2, O-66): the seed uses the $5 default flagged unverified, so nothing is needed from the owner now.
- [ ] The vault is readable through `/add-dir`.

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull
git switch -c p0/infra
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault and append open-question identifiers (O-IDs) to `planning/00-open-questions-and-risks.md`.
2. Stay in the default permission mode.
3. Paste the prompt.

## The prompt

```text
You are running session S02 of sprint 1 of g-tee-oh, Phase 0 (Foundations and test scaffolding), on branch p0/infra off the sprint branch sprint/1-v1. Goal: the Compose dev profile, Dockerfiles, migrations with roles and the seeded catalog, codegen wiring and the Zenbook benchmark baseline (R0.5, R0.6, R0.10).

## Reading order
The vault is C:\Users\stack\vault\projects\g-tee-oh (added with /add-dir). Read in order:
1. planning/phases/phase-0-foundations.md
2. planning/09-v1-sprint-roadmap.md: sections 3 (S02 edges), 5 (row S02), 6 (R0.5, R0.6, R0.10), 7
3. planning/00-open-questions-and-risks.md: O-2, O-17, O-21, O-23, O-28, O-33, O-40, O-48, O-56, O-62, O-66
4. planning/01-product-spec.md section 3 (the v1 configurations and stakes)
5. planning/architecture/A4-data-model.md (all); A1-repo-and-conventions.md sections 1, 5, 6; A5-services-and-interfaces.md section 1; A9-quality-security-ops.md sections 1, 2, 3, 5, 6
6. planning/02-architecture.md sections 6 and 7
7. decisions/_README.md, then architecture decision records (ADRs) 0001, 0005, 0014, 0019
8. The repo: CLAUDE.md, justfile, .github/workflows/, docs/

## Rules
- Clone C:\Users\stack\projects\g-tee-oh, Claude Code in PowerShell, native Windows Rust toolchain; WSL2 only for Linux container builds and benchmarks (O-23).
- Branch p0/infra; merge by pull request into sprint/1-v1; sprint/1-v1 merges into main only in S35 (R4.18).
- Gates in order: plan first (plan mode, wait for approval), concrete task list, smallest working increment, tests green (never advance on red), /code-review with CRITICAL and HIGH fixed, /security-review (roles, credentials and .env handling make it apply), conventional commits ending with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Test-driven: red test tagged with its requirement identifier (R ID) first, then green, then refactor; 80 percent coverage or better on new code.
- Accepted ADRs are fixed; ADR 0005's dbmate, Kysely and sqlx parts are accepted (O-56). The schema follows A4 and the roles follow O-28 where 02 section 6.4 differs (O-27). Cite O-IDs and ADR numbers in migration comments, commits and the report.
- Privacy boundary (O-26, ADR 0017): this repo receives nothing GTO Wizard-specific (GTO stands for game theory optimal). The reference-private bucket and the capture role exist here as generic names; what fills them is private (O-19). Credentials live only in .env (gitignored); .env.example carries placeholders.
- Documentation you write: no em dashes or en dashes, no bold, acronyms expanded on first use, mechanism before conclusion.
- A step runs as a dynamic workflow only where this prompt says so, under 10 agents, with the verifier's checks named.
- Report honestly at every gate: show failing output, name any skipped step.

## Inputs
- S01's workspace, justfile, CI jobs and guard on sprint/1-v1.
- The v1 configuration list from 01 section 3: online 6-max at 100, 150 and 200 big blinds (bb) on the one online rake profile; live 9-handed at 100, 150, 200 and 300bb at the 1/3 and 2/5 stakes; straddle off. Whether straddle-on rows are seeded now is not decided (O-72, answered in 00); seed straddle-off only.
- The A4 schema sketch and role table; the crates/vendor/postflop-engine crate for the solve-iteration benchmark.

## Requirements this session closes
- R0.5 Compose dev profile with Postgres, SeaweedFS single-server mode and Caddy; one multi-arch Dockerfile per service; .wslconfig template (O-23); .env.example. Proof: docker compose --profile dev up reaches healthy on the Zenbook; a health-check smoke script that S06's end-to-end (e2e) skeleton calls.
- R0.6 dbmate migrations for the A4 schema with scenario in v1 (O-17), game_config.ante_cbb default 0 (O-33), roles app, builder, capture and the read-only query role (O-28); the catalog seed: stakes (live 1/3 cap $5; live 2/5 cap $5 flagged unverified per O-2 and O-66; one online profile with placeholder rake values pending O-7) and every v1 configuration with a placeholder sizing convention (source manual). Proof: migration test on an empty database; role tests (query cannot write; app has no usage on a schema named capture; capture inserts only solution rows with source reference, stake, sizing_convention and game_config rows); Kysely codegen and sqlx checks pass; a seed test counts one game_config per v1 configuration.
- R0.10 Benchmark harness with the criterion crate: solve iteration, chunk decode, node read; Zenbook baseline recorded. Proof: just bench writes validation/reports/bench-zenbook.json.
- R0.3 (Dockerfile part): infra/docker holds one multi-arch Dockerfile per service plus an images matrix file the images job reads, left empty until S06 adds solver-query.

## Steps
1. (single) Read, then plan in plan mode and wait for approval. The plan names every migration file, every role grant, the seed rows, the Compose services with their health checks, the Dockerfiles, the .env.example variables and the three benchmark targets.
2. (dynamic workflow, under 6 agents: a compose agent for infra/compose/compose.yaml with the dev and mac profiles, Postgres, SeaweedFS with its S3 (Simple Storage Service) gateway and two buckets with separate credentials, library and reference-private (02 section 6.4), Caddy, health checks, infra/wsl/.wslconfig per 02 section 6.1 and .env.example with every variable commented, including the per-role database connection strings, per-bucket credentials, FIXTURE_LIBRARY_PATH (O-62), QUERY_CACHE_BYTES and GUARD_SALT; a Dockerfile agent for infra/docker with one multi-arch Dockerfile per service (api, solver-query, library-builder, web) against the A1 paths and the images matrix file; a migrations agent for db/migrations, the four roles, the seed, the migration test, the role tests and the seed test; a codegen agent wiring just codegen (kysely-codegen types and sqlx offline metadata) with their checks; a bench agent for the criterion harness with solve iteration measured on the vendored engine over a small simple-tree flop and chunk decode and node read registered as stubs tagged R0.10 and R2.7 until S14 lands, plus just bench writing validation/reports/bench-zenbook.json in the S05 report format when it exists, otherwise a minimal JSON with commit, machine, date and measurements; the verifier agent runs the role tests and the seed test against the Compose Postgres and runs the compose-up smoke). Use a dynamic workflow for this step, under 6 agents. How the unverified flag on the 2/5 stake row is stored is not in A4 (O-71, answered in 00); use a nullable note text column on stake carrying the O-66 note unless the owner says otherwise.
3. (single) Compose-up smoke: docker compose --profile dev up -d --wait; every service healthy; just smoke checks Postgres, the S3 gateway and Caddy and is what the e2e skeleton will call.
4. (single) Record the Zenbook baseline with just bench and commit validation/reports/bench-zenbook.json.
5. (single) /code-review, /security-review, then open the pull request into sprint/1-v1 with the R IDs in the template.

## Definition of done
- [ ] rust, ts, licenses, security jobs green on the pull request; migration, role, seed, codegen and sqlx checks green in CI
- [ ] docker compose --profile dev up healthy on the Zenbook; just smoke passes
- [ ] validation/reports/bench-zenbook.json committed with the three targets (two as stubs)
- [ ] .env not committed; .env.example complete; guard clean
- [ ] /code-review and /security-review done; pull request opened into sprint/1-v1

## Report back
The final message lists each R ID (R0.5, R0.6, R0.10, R0.3 Dockerfile part) with its test command and result; the branch and pull request link; the files written; the baseline JSON path under validation/reports/; usage notes (units used against the planned medium level); and any new question as a proposed O-ID with a default, appended to planning/00-open-questions-and-risks.md under a new dated subsection.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| `infra/compose/compose.yaml` (profiles `dev` and `mac`), Caddyfile, `.env.example` | repo |
| `infra/docker/*.Dockerfile` and the images matrix file | repo |
| `infra/wsl/.wslconfig` template | repo |
| `db/migrations/*.sql` with roles and the catalog seed; migration, role and seed tests | repo |
| `just codegen`, `just smoke`, `just bench` targets; generated Kysely types and sqlx metadata | repo |
| `validation/reports/bench-zenbook.json` | repo |
| Pull request `p0/infra` into `sprint/1-v1` | GitHub |
| New O-IDs, if any | vault `planning/00-open-questions-and-risks.md` |
