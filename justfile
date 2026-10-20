# g-tee-oh task surface. Every CI job calls these recipes; "just --list" shows them.
# Each recipe line runs in its own shell, so there is no && chaining.

set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

# Crates this repo owns. The vendored engine is excluded from fmt and clippy.
OWN_CRATES := "-p gto-model -p gto-tree -p gto-solve -p gto-library -p gto-planner -p solver-query -p library-builder -p validate -p library-pack"
COMPOSE_FILE := "infra/compose/compose.yaml"
# The project directory is the repo root so .env and relative paths resolve from there
COMPOSE := "docker compose --project-directory . -f infra/compose/compose.yaml"

# List the recipes (the task surface)
default:
    @just --list

# Formatting check on the crates this repo owns
rust-fmt:
    cargo fmt {{OWN_CRATES}} -- --check

# Clippy on the workspace minus the vendored engine; warnings are errors.
# --no-deps is required: --exclude only drops engine from the primary set, clippy still lints it as a dependency.
rust-clippy:
    cargo clippy --workspace --exclude engine --all-targets --no-deps -- -D warnings

# Workspace tests; the vendored engine runs in release mode only (upstream debug assertion in src/br.rs)
rust-test:
    cargo test --workspace --exclude engine
    cargo test -p engine --release

# Compile-time boundary: solver-query never depends on gto-solve (ADR 0018)
rust-boundary:
    node scripts/check-boundary.mjs

# ESLint across the pnpm workspace, then the root scripts (guard/, scripts/) that pnpm -r does not reach
ts-lint:
    pnpm -r --if-present lint
    pnpm run lint:root

# TypeScript type check across the pnpm workspace
ts-typecheck:
    pnpm -r --if-present typecheck

# Vitest across the pnpm workspace, then the node:test suites under scripts/ (the root is outside pnpm -r)
ts-test:
    pnpm -r --if-present test
    pnpm run test:scripts

# The contracts job runs this and then git diff. The steps, in order, stopping at the first failure: the
# solver-query OpenAPI document (utoipa), the api OpenAPI document (Fastify), the openapi-typescript clients,
# the Kysely types (R0.6; needs a migrated database through DATABASE_URL, so dev-up and db-migrate first) and
# the schema copies under crates/gto-library/schemas (O-119). just --list shows the last comment line only.
# Contracts (R0.7): regenerate every committed contract artifact (OpenAPI documents, clients, Kysely types, schema copies)
contracts:
    node scripts/contracts.mjs

# Fail when any committed contract artifact differs from what the generators produce, naming each stale path
contracts-check:
    node scripts/contracts.mjs --check

# Skips until the compose file exists; the chain lives in infra/compose/e2e.mjs so dev-down always runs.
# End-to-end: dev stack up (builds solver-query, api, web), migrate, database tests, smoke, Playwright flow, down (R0.3, R0.5, R0.6)
e2e:
    {{ if path_exists(COMPOSE_FILE) == "true" { "just e2e-stack" } else { "echo 'e2e: skipped, " + COMPOSE_FILE + " does not exist yet (S02/S06)'" } }}

# The e2e chain once the compose file exists: up, migrate, database tests, smoke, e2e-web, and always down
e2e-stack:
    node infra/compose/e2e.mjs

# .env at the repo root supplies credentials (R0.5). --build rebuilds the solver-query, api and web images
# from the working tree every time (O-122: built images, no hot reload yet). The one-shot bucket-init is
# started after the long-running services are healthy and "compose wait" returns its exit code, because
# "up --wait" treats a container that exited, even with 0, as a failure.
# Compose dev stack: build the three images, wait for every service's health, then run bucket-init once (R0.5)
dev-up:
    {{COMPOSE}} --profile dev up -d --build --wait postgres seaweedfs solver-query api web caddy
    {{COMPOSE}} --profile dev up -d bucket-init
    {{COMPOSE}} --profile dev wait bucket-init

# Compose dev stack down, volumes removed
dev-down:
    {{COMPOSE}} --profile dev down -v

# Health smoke over Postgres, the S3 gateway, the three built services and Caddy; what the e2e job calls (R0.3, R0.5)
smoke:
    node infra/compose/smoke.mjs

# Playwright smoke flow against the running dev stack through Caddy (R0.3, R0.7); e2e runs it after smoke
e2e-web:
    pnpm --filter @g-tee-oh/web run e2e

# Apply migrations; dbmate reads DATABASE_URL from the environment or .env (R0.6)
db-migrate:
    dbmate --wait --no-dump-schema up

# Migration status
db-status:
    dbmate status

# Migration, role and seed tests against the migrated database (R0.6)
db-test:
    node --test "db/test/*.test.mjs"

# Regenerate the Kysely types from the migrated database (R0.6)
codegen:
    node scripts/codegen.mjs

# Fail when the generated Kysely types differ from the committed file
codegen-check:
    node scripts/codegen.mjs --check

# sqlx offline metadata check; reports that no crate carries a query yet until one does (R0.6)
sqlx-check:
    node scripts/sqlx-check.mjs

# License policy (ADR 0002): cargo-deny for crates, scripts/check-licenses.mjs for packages
licenses:
    cargo deny check licenses
    node scripts/check-licenses.mjs

# Ignored advisories live in the auditConfig block of pnpm-workspace.yaml, each with its reason; pnpm 12
# reads that block on every audit, so no --ignore flag here (a flag would rewrite the file on every run).
# pnpm advisories at high severity, with the ignores documented in pnpm-workspace.yaml
audit-ts:
    pnpm audit --audit-level high

# Advisories, then the private-data guard on the commit range
security:
    cargo audit
    just audit-ts
    just guard-ci

# Private-data guard on the staged diff (what the pre-commit hook runs)
guard:
    node guard/src/cli.mjs staged

# Private-data guard on the commit range (CI; set GUARD_BASE or it falls back to HEAD~1)
guard-ci:
    node guard/src/cli.mjs ci

# Private-data guard over every commit in the history
guard-history:
    node guard/src/cli.mjs history

# Private-data guard over a directory on disk
guard-paths DIR:
    node guard/src/cli.mjs paths {{DIR}}

# Guard unit tests (node:test, synthetic data only)
guard-test:
    node --test "guard/test/*.test.mjs"

# Pending-test tag check (R0.11): every it.todo, skipped or #[ignore] test carries its R ID; lists the untagged ones and fails
test-tags:
    node scripts/check-test-tags.mjs

# Container images; skips until infra/docker/*.Dockerfile exists (S02)
[unix]
images:
    if ls infra/docker/*.Dockerfile >/dev/null 2>&1; then echo "images: Dockerfiles present, the build runs in the images workflow (S06)"; else echo "images: skipped, no infra/docker/*.Dockerfile yet (S02)"; fi

# Container images; skips until infra/docker/*.Dockerfile exists (S02)
[windows]
images:
    if (Test-Path infra/docker/*.Dockerfile) { echo "images: Dockerfiles present, the build runs in the images workflow (S06)" } else { echo "images: skipped, no infra/docker/*.Dockerfile yet (S02)" }

# Copy vault files flagged public: true from $VAULT_DIR into docs/, then guard the result
docs-mirror:
    node guard/src/docs-mirror.mjs
    node guard/src/cli.mjs paths docs

# Point git at the versioned hooks (pre-commit guard, commit-msg trailer check)
hooks:
    git config core.hooksPath .githooks

# Benchmark harness: solve iteration, chunk decode, node read; writes validation/reports/bench-zenbook.json (R0.10)
bench:
    cargo bench -p gto-solve -p gto-library
    node scripts/bench-report.mjs

# contracts and contracts-check need a migrated database for the Kysely step, e2e the compose stack, images buildx.
# Everything the hosted jobs run that needs neither Docker nor a database, in order
ci: rust-fmt rust-clippy rust-test rust-boundary ts-lint ts-typecheck ts-test licenses security guard-test test-tags
