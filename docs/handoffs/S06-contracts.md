---
id: 'g-tee-oh-handoff-s06-contracts'
title: 'S06 Contracts'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 0
session: 'S06'
branch: 'p0/contracts'
tags: [g-tee-oh, handoff, phase-0]
---
# S06 Contracts (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-0-foundations|Phase 0 Foundations and test scaffolding]]. This session produces the contracts pipeline, the service and web skeletons, the end-to-end (`e2e`) skeleton with the fixture library path, and it closes the repo part of the Phase 0 gate (R0.7, the `e2e` part of R0.3, and `validation/reports/phase-0-gate.md`). Branch `p0/contracts` off `sprint/1-v1`. Parallel group C, earliest day 3 (2026-10-22), paced week 1 as the last Phase 0 session before S07 (09 sections 4 and 5). Single session, no workflow. Public. Usage medium (2 units).

## Before pasting

- [ ] S01, S02 and S05 merged into `sprint/1-v1` (09 section 3: S01 and S02 block S06; S06 confirms every `p0` branch is merged for the gate). S04 merged if it has landed; otherwise its status is recorded as pending with the S20 deadline (O-67).
- [ ] S03 complete in the private repo; its continuous integration (CI) run link is at hand, since the gate file notes R0.8's result (09 section 7).
- [ ] Docker Desktop running; `docker compose --profile dev up` from S02 comes up healthy; Playwright browsers installed with `pnpm exec playwright install chromium`.
- [ ] The vault is readable through `/add-dir`.

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull
git switch -c p0/contracts
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault and append open-question identifiers (O-IDs) to `planning/00-open-questions-and-risks.md`.
2. Stay in the default permission mode.
3. Paste the prompt.

## The prompt

```text
You are running session S06 of sprint 1 of g-tee-oh, Phase 0 (Foundations and test scaffolding), on branch p0/contracts off the sprint branch sprint/1-v1. Goal: the contracts pipeline, the service and web skeletons, the e2e skeleton with the fixture path, and the repo part of the Phase 0 gate (R0.7, R0.3 e2e part, validation/reports/phase-0-gate.md).

## Reading order
The vault is C:\Users\stack\vault\projects\g-tee-oh (added with /add-dir). Read in order:
1. planning/phases/phase-0-foundations.md (Instruments and Definition of Done are the gate checklist)
2. planning/09-v1-sprint-roadmap.md: sections 3 (S06 edges), 5 (row S06), 6 (R0.7, R0.3), 7 (Phase 0 gate rows)
3. planning/00-open-questions-and-risks.md: O-26, O-28, O-38, O-45, O-53, O-62, O-67
4. planning/architecture/A1-repo-and-conventions.md section 3; A5-services-and-interfaces.md (service map and endpoint lists); A3-library-format.md (manifest and node record for the JSON (JavaScript Object Notation) schemas); A4-data-model.md section 2 (solution and game_config fields the node dump carries); A7-web-app.md sections 1, 2, 5; A9-quality-security-ops.md sections 1 and 2
5. decisions/_README.md, then architecture decision records (ADRs) 0004, 0006, 0018
6. The repo: CLAUDE.md, justfile, .github/workflows/, infra/, db/, packages/contracts/, validation/reports/README.md, docs/
Do not read A8; the node-dump schema is generic by design (09 section 3: the private exporter writes to the schema S06 defines).

## Rules
- Clone C:\Users\stack\projects\g-tee-oh, Claude Code in PowerShell, native Windows Rust toolchain; Windows Subsystem for Linux 2 (WSL2) only for Linux container builds and benchmarks (O-23).
- Branch p0/contracts; merge by pull request into sprint/1-v1; sprint/1-v1 merges into main only in S35 (R4.18).
- Gates in order: plan first (plan mode, wait for approval), concrete task list, smallest working increment, tests green (never advance on red), /code-review with CRITICAL and HIGH fixed, /security-review (the hello endpoints and the served OpenAPI document make it apply), conventional commits ending with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Test-driven: red test tagged with its requirement identifier (R ID) first, then green, then refactor; 80 percent coverage or better on new code.
- Accepted ADRs are fixed; ADR 0004 counts as accepted (O-25): the solver-query skeleton is Rust (axum, utoipa) and the api skeleton is TypeScript (Fastify, Zod). solver-query never depends on gto-solve (A1 section 2, ADR 0018). Cite O-IDs and ADR numbers in commits and the report.
- Privacy boundary (O-26, ADR 0017): the node-dump schema names no external product, route, payload shape, game type code or tier; it describes nodes, actions, frequencies, expected values (EV) and configuration metadata in this project's own vocabulary.
- Documentation you write: no em dashes or en dashes, no bold, acronyms expanded on first use, mechanism before conclusion.
- No dynamic workflow in this session: one pipeline end to end, then the gate.
- Report honestly at every gate: show failing output, name any skipped step; a gate condition that does not hold is written as not holding.

## Inputs
- sprint/1-v1 with S01, S02 and S05 merged: workspaces, CI, guard, Compose dev, migrations, codegen wiring, the report format.
- A3's manifest and node record; A5's endpoint lists; A7's smoke-flow targets.
- From the owner: the private repo CI run link from S03; S04's status.

## Requirements this session closes
- R0.7 Contracts pipeline and skeletons (A1 section 3): utoipa to solver-query.openapi.json, Fastify Zod to api.openapi.json, openapi-typescript clients, manifest and node-dump JSON schemas carrying a schema version, kysely-codegen; axum hello with /healthz, Fastify hello serving /api/v1/openapi.json, Vite skeleton with router and a Playwright smoke flow. Proof: the contracts job regenerates and fails on diff; the smoke flow passes in the e2e skeleton.
- R0.3 (closing part): the e2e skeleton passes the Playwright smoke flow over Compose dev with FIXTURE_LIBRARY_PATH on the dev profile (O-62); the images job builds amd64 and arm64 for solver-query.
- Phase 0 gate, repo part: validation/reports/phase-0-gate.md with every condition from the phase doc's Definition of Done, after confirming the p0 branches are merged into sprint/1-v1.

## Steps
1. (single) Read, then plan in plan mode and wait for approval. The plan lists the schema files and their fields, the three skeletons and their endpoints, the just contracts pipeline, the e2e job wiring and the gate file sections.
2. (single) Schemas in packages/contracts/schemas/: manifest.schema.json from A3 with schema_version; node-dump.schema.json, generic, with schema_version, configuration metadata (format, table size, stake label, depth, straddle, ante), position pair, node key, actions with tokens and sizes, per-hand action frequencies and one EV per action, so that the criterion 2 invariants (frequencies sum to 1 within 0.001, an EV per action, complete metadata) are checkable by tools/library-pack in S14. Validate both with a test against a hand-written example.
3. (single) Skeletons: services/solver-query as an axum hello with /healthz and utoipa annotations that export the OpenAPI document; services/api as a Fastify hello with Zod, /healthz and /api/v1/openapi.json; web as the Vite skeleton with the router from A7 and a /login placeholder route; the Playwright smoke flow loads the shell through Caddy and asserts the api health JSON.
4. (single) Pipeline: just contracts exports both OpenAPI documents, generates the openapi-typescript clients, runs kysely-codegen from S02's wiring and copies the schemas; commit the generated files; the contracts job runs just contracts and fails on any diff.
5. (single) e2e job: Compose dev up with FIXTURE_LIBRARY_PATH on the dev profile pointing at validation/fixtures/library (an empty placeholder directory with a README until S19 fills it), wait for healthy, run S02's just smoke and the Playwright smoke flow. Add solver-query to the images matrix and confirm the amd64 and arm64 builds (R0.3).
6. (single) Throwaway proof: on p0/contracts-throwaway-diff change a Zod schema without regenerating, confirm the contracts job fails, record the run link, delete the branch.
7. (single) Gate: confirm S01, S02 and S05 are merged into sprint/1-v1 and merge sprint/1-v1 into p0/contracts; run every job locally where possible (just ci); complete validation/reports/phase-0-gate.md, which S01 started, with one line per condition in the phase doc's Definition of Done and its evidence link, the R0.2, R0.4 and contracts throwaway runs, R0.8's private CI result from the owner's link (result only, no private detail), the Mac part status (S04 landed with its report path, or pending with the S20 deadline, O-67) and the partial success criteria lines.
8. (single) /code-review, /security-review, then open the pull request into sprint/1-v1 with the R IDs in the template. When it merges and the sprint/1-v1 run is green on all seven jobs, append that run link to the gate file with a docs: commit on a one-line branch p0/gate-link; if this session has ended by then, the next public session on sprint/1-v1 does it as its first task.

## Definition of done
- [ ] contracts job green on the branch and failed on the throwaway diff; generated files committed with no diff
- [ ] e2e job green: Compose dev healthy, just smoke and the Playwright smoke flow pass with FIXTURE_LIBRARY_PATH set (O-62)
- [ ] images job builds solver-query for amd64 and arm64
- [ ] All seven jobs green on the pull request; rust and ts jobs include the three skeletons' tests
- [ ] validation/reports/phase-0-gate.md complete: every repo-part condition with evidence, R0.8 noted, Mac part status, partial criteria lines
- [ ] /code-review and /security-review done; pull request opened into sprint/1-v1

## Report back
The final message lists each R ID (R0.7, R0.3 closing part) with its test command and result, and the gate conditions with hold or not hold; the branch and pull request link; the files written; the gate artifact validation/reports/phase-0-gate.md and, when known, the sprint/1-v1 run link; usage notes (units used against the planned medium level); and any new question as a proposed O-ID with a default, appended to planning/00-open-questions-and-risks.md under a new dated subsection.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| `packages/contracts/schemas/manifest.schema.json`, `node-dump.schema.json` with schema versions and tests | repo |
| `packages/contracts/solver-query.openapi.json`, `api.openapi.json`, generated TypeScript clients, Kysely types | repo, regenerated by `just contracts` |
| `services/solver-query` axum hello, `services/api` Fastify hello, `web` Vite skeleton with router | repo |
| Playwright smoke flow; `e2e` job wiring with `FIXTURE_LIBRARY_PATH`; `validation/fixtures/library/` placeholder | repo |
| `solver-query` entry in the images matrix (amd64 and arm64 build) | repo |
| `validation/reports/phase-0-gate.md` completed (repo part of the Phase 0 gate) | repo |
| Pull request `p0/contracts` into `sprint/1-v1`; later the `sprint/1-v1` run link | GitHub |
| New O-IDs, if any | vault `planning/00-open-questions-and-risks.md` |
