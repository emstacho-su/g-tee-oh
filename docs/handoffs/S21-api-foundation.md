---
id: 'g-tee-oh-handoff-s21-api-foundation'
title: 'S21 api foundation'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 3
session: 'S21'
branch: 'p3/api-foundation'
tags: [g-tee-oh, handoff, phase-3]
---
# S21 api foundation (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-3-preflop-trainer|Phase 3 Preflop trainer]]. This session produces the `api` service foundation: the Fastify application with authentication and the security middleware, the catalog endpoints, drill CRUD (create, read, update, delete), and the committed `api` OpenAPI contract as the first commit so the web client can be generated a day early (O-38). Branch `p3/api-foundation`, parallel group D, earliest day 4, paced for week 2 (days 8 to 14, 2026-10-27 to 2026-11-02; 09 sections 4 and 5). It runs as a dynamic workflow after the contract commit. Public. Usage: high. R IDs are requirement identifiers; O-IDs are the answered questions in [[projects/g-tee-oh/planning/00-open-questions-and-risks|00 Open questions and risks]].

## Before pasting

- [ ] S01 and S02 merged into `sprint/1-v1`: the workspace, the migrations with the roles `app`, `builder`, `capture` and `query` (O-28), the catalog seed (R0.6) and the Kysely types.
- [ ] S06 merged: the contracts pipeline, the Fastify skeleton serving `/api/v1/openapi.json`, the generated clients (R0.7).
- [ ] The Zenbook clone at `C:\Users\stack\projects\g-tee-oh`, Docker in Windows Subsystem for Linux 2 (WSL2) running for the Postgres test container (O-23).
- [ ] No owner input is needed; the 2/5 cap row may still be flagged unverified (O-66).

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull
git switch -c p3/api-foundation
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault and append O-IDs to planning/00.
2. Stay in the default permission mode, so you approve the workflow when it launches.
3. Paste the prompt below.

## The prompt

```text
Role and context
You are running session S21 of sprint 1 of g-tee-oh, Phase 3 (Preflop trainer), on branch p3/api-foundation off the sprint branch sprint/1-v1. Goal: the api foundation (Fastify, auth, security middleware), the catalog endpoints and drill CRUD (create, read, update, delete), with the api OpenAPI contract committed first so S24 can generate the web client (O-38). You close R3.1, R3.2 and the CRUD part of R3.14.

Reading order (vault at C:\Users\stack\vault\projects\g-tee-oh, added with /add-dir)
1. planning/phases/phase-3-preflop-trainer.md
2. planning/09-v1-sprint-roadmap.md sections 3, 5 (the S21 row), 6 (Phase 3) and 7
3. planning/00-open-questions-and-risks.md, answered questions O-17 to O-67; this session leans on O-23, O-25, O-26, O-28, O-29, O-33, O-38, O-56 and O-66
4. planning/01-product-spec.md section 3; planning/05-training-and-grading.md section 4 (use the g-tee-oh field names only)
5. planning/architecture/A1-repo-and-conventions.md sections 2 to 4; A4-data-model.md; A5-services-and-interfaces.md section 3; A9-quality-security-ops.md sections 1 to 3
6. decisions/_README.md, then ADRs 0001, 0004, 0005, 0014, 0017 and 0018
7. In the repo: CLAUDE.md, docs/ (mirrored files), packages/contracts/, services/api/ (the S06 skeleton), db/migrations/ and the seed (S02)

Rules
- Clone C:\Users\stack\projects\g-tee-oh, Claude Code in PowerShell, native Windows Rust toolchain; WSL2 (Windows Subsystem for Linux 2) only for Linux container builds and benchmarks (O-23). The private capture repo C:\Users\stack\projects\g-tee-oh-capture is not touched by this session (O-28).
- Branch p3/api-foundation off sprint/1-v1; merge by pull request into sprint/1-v1; sprint/1-v1 merges into main only in S35 (R4.18).
- Gates in order: plan first (enter plan mode, write the plan, wait for my approval; trivial one-liners exempt); break down into a concrete task list; implement the smallest working increment; tests pass (never advance on red; write the suite if none exists); run /code-review and fix CRITICAL and HIGH findings; run /security-review for anything touching auth, user input, secrets or endpoints; commit with conventional commits (feat:, fix:, chore:, refactor:, docs:, test:, perf:, ci:) and end every commit message with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Test-driven: red test first, tagged with its R ID, then green, then refactor; 80 percent coverage or better on new code.
- Visual testing happens on local ports with my screenshots. Nothing deploys to the Mac without my explicit yes at that moment (O-20).
- A step runs as a dynamic workflow only where this prompt says so in my words; keep every workflow under 10 agents and name what its verifier runs.
- Accepted ADRs are fixed (0004 and 0013 count as Accepted, O-25); if a step would contradict one, stop and raise it. Cite O-IDs and ADR numbers in code comments, commit bodies and docs wherever an answer is used. A new question goes to planning/00 as a proposed O-ID with a default under a new dated subsection.
- Privacy (O-26, ADR 0017, ADR 0021): the public repo never receives anything GTO Wizard-specific (routes, payload shapes, game type codes, drill parameter names, capture methods, tier definitions, volumes, screenshots). Naming GTO Wizard as the product being emulated is allowed.
- Report honestly at every gate: if tests fail, say so and show the output; if a step was skipped, say which.
- Docs you write: no em dashes, no bold, acronyms expanded on first use, the mechanism before the conclusion.

Inputs
- db/migrations/ with the A4 schema, the four roles (O-28), game_config.ante_cbb (O-33) and the R0.6 catalog seed (live 1/3 cap $5, live 2/5 cap $5 flagged unverified per O-66, one online profile, every v1 configuration with a placeholder sizing convention)
- Kysely types from kysely-codegen (S02); the contracts pipeline (S06): Fastify Zod to packages/contracts/api.openapi.json and the openapi-typescript client
- services/api skeleton serving /api/v1/openapi.json (R0.7); .env.example
- The endpoint list in A5 section 3 and its conventions (RFC 9457 problem responses, Idempotency-Key, cursor pagination, state_version), where RFC is Request for Comments

Requirements this session closes
- R3.1 api foundation: Fastify, Zod on every input, argon2id, HTTP-only Secure SameSite cookies, login rate limit, CSRF (cross-site request forgery) protection, RFC 9457 errors, Idempotency-Key, cursor pagination, Kysely, OpenAPI committed first and the generated client. Proof: the contracts job produces no diff; auth and security integration tests in a Postgres test container (rate limit trips, CSRF rejected, cookie flags); a double-submitted mutating request is handled once (the decision endpoint lands in S23 and repeats this test there).
- R3.2 catalog endpoints /stakes, /configs, /configs/{id}/pairs over the seeded catalog, stake keying by config_id. Proof: integration tests against the R0.6 seed; contract tests against the OpenAPI schema; a 1/3 and a 2/5 configuration with the same table size and depth have different config_id values (criterion 11 data, R2.2).
- R3.14, CRUD part: GET, POST, PATCH and DELETE /drills over a Zod drill schema with the 05 section 4 field names (spot_filter, trainer settings, tags). Proof: schema tests and CRUD integration tests. Import, export, duplicate, the screens and flow 2 stay with S26.

Steps
1. (single) Plan: enter plan mode, read the files above, write the plan with its task list, wait for my approval.
2. (single) Contract first (O-38): register every A5 section 3 route in the Fastify skeleton with its Zod request and response schemas, so the regenerated api.openapi.json covers the whole v1 surface; routes this session does not build return a 501 problem response. Regenerate the contract and the client, run the contracts job locally, and make this the first commit on the branch. S24 generates the web client from this commit.
3. Use a dynamic workflow for this step, under 5 agents: one for auth and users (app_user, auth_session, argon2id, login, logout, me, cookie flags, session expiry, login rate limit); one for the catalog endpoints over Kysely with config_id keying; one for drill CRUD with the Zod drill schema; one for the cross-cutting conventions (RFC 9457 problem responses, Idempotency-Key handling, cursor pagination, CSRF protection on mutating routes, request size limits, CORS (cross-origin resource sharing) locked to the app origin, pino logs carrying the request id). Every agent writes its red tests tagged with the R ID before its implementation. The verifier agent runs the security integration tests in the Postgres test container and the contracts job, and reports any red test verbatim.
4. (single) Run /code-review and fix CRITICAL and HIGH findings; run /security-review (auth, cookies, user input, secrets) and fix its findings; confirm coverage on services/api is 80 percent or better.
5. (single) Open the pull request into sprint/1-v1 listing R3.1, R3.2 and R3.14 in the template.

Definition of done
- [ ] api.openapi.json and the client committed first; the contracts job clean
- [ ] Auth and security integration tests green in the Postgres test container; catalog and drill CRUD tests green; every test tagged with its R ID
- [ ] Coverage 80 percent or better on new code; /code-review done; /security-review done
- [ ] Pull request opened into sprint/1-v1 with the R IDs listed; the private-data guard passes
- [ ] Nothing GTO Wizard-specific in the repo (O-26)

Report back
Your final message lists: each R ID (R3.1, R3.2, R3.14 CRUD part) with its test command and result; the branch and the pull request link; the files written; usage notes (units used against the planned high level); any new question as a proposed O-ID with a default, appended to planning/00 under a new dated subsection.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| `packages/contracts/api.openapi.json` and the generated TypeScript client, first commit | Repo, branch `p3/api-foundation` |
| `services/api/` auth, catalog, drill CRUD, problem responses, idempotency, pagination, CSRF | Repo |
| Integration tests in the Postgres test container, tagged R3.1, R3.2, R3.14 | Repo, `services/api/` tests |
| Pull request into `sprint/1-v1` | GitHub |
| New O-IDs, if any | `planning/00-open-questions-and-risks.md` in the vault |
