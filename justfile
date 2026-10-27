# g-tee-oh task surface. Every CI job calls these recipes; "just --list" shows them.
# Each recipe line runs in its own shell, so there is no && chaining.

set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

# Crates this repo owns. The vendored engine is excluded from fmt and clippy.
OWN_CRATES := "-p gto-model -p gto-tree -p gto-solve -p gto-library -p gto-planner -p solver-query -p library-builder -p validate -p library-pack"
COMPOSE_FILE := "infra/compose/compose.yaml"
# The project directory is the repo root so .env and relative paths resolve from there
COMPOSE := "docker compose --project-directory . -f infra/compose/compose.yaml"
# The hot reload override on top (O-265); only dev-hot and dev-hot-down use it, never CI
COMPOSE_HOT := COMPOSE + " -f infra/compose/compose.hot.yaml"

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

# TypeScript boundary: api never resolves, names or spawns the builder (R2.15, O-157)
ts-boundary:
    node scripts/check-api-boundary.mjs

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
# End-to-end: dev stack up (builds solver-query, api, web), migrate, database tests, owner, smoke, Playwright flow, down (R0.3, R0.5, R0.6, R3.13)
e2e:
    {{ if path_exists(COMPOSE_FILE) == "true" { "just e2e-stack" } else { "echo 'e2e: skipped, " + COMPOSE_FILE + " does not exist yet (S02/S06)'" } }}

# The e2e chain once the compose file exists: up, migrate, database tests, create-owner (O-263), smoke, e2e-web, and always down
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
    node infra/compose/wait-one-shot.mjs bucket-init

# Compose dev stack down, volumes removed
dev-down:
    {{COMPOSE}} --profile dev down -v

# infra/compose/compose.hot.yaml runs api under tsx watch and web under the Vite dev server, from the
# working tree, behind the same edge Caddy (HMR over wss on 443). The first start installs the workspace
# into named volumes inside the containers (a few minutes); later starts take seconds. --build rebuilds
# solver-query only; --wait covers the first install through the override's health checks. Ports are the
# dev profile's, so dev-hot and dev-up (and e2e) never run at the same time.
# Compose dev stack with hot reload for api and web (O-237, O-265); just dev-hot-down stops it
dev-hot:
    {{COMPOSE_HOT}} --profile dev up -d --build --wait --wait-timeout 900 postgres seaweedfs solver-query api web caddy
    {{COMPOSE_HOT}} --profile dev up -d bucket-init
    node infra/compose/wait-one-shot.mjs bucket-init
    @echo "dev-hot: up at https://localhost (https://<CADDY_SITE> when .env sets one); edits under web/ and services/api/ reload"

# Keeps every volume: the database and the node_modules volumes survive, so the next dev-hot is quick.
# just dev-down removes the database and storage volumes (not the node_modules ones); run it before just
# e2e, whose create-owner step expects a fresh database.
# Hot reload stack down, volumes kept (O-265)
dev-hot-down:
    {{COMPOSE_HOT}} --profile dev down

# Health smoke over Postgres, the S3 gateway, the three built services and Caddy; what the e2e job calls (R0.3, R0.5)
smoke:
    node infra/compose/smoke.mjs

# Base URL: E2E_BASE_URL, else https://<CADDY_SITE> (environment or .env), else https://localhost. The e2e
# script is the stack project only (playwright --project=stack), which never starts the preview server. The
# sign-in test reads E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD, which e2e sets for this step only (O-263);
# run by hand without them, it is skipped with that reason.
# Playwright stack project against the running dev stack through Caddy: smoke and sign-in (R0.3, R0.7, R3.13)
e2e-web:
    pnpm --filter @g-tee-oh/web run e2e

# No Docker: Playwright builds the harness (build:harness), serves it with vite preview on 4173 and answers
# /api/v1 from e2e/support/mock-api.ts through page.route. Needs the Chromium browser once per machine:
#   pnpm --filter @g-tee-oh/web exec playwright install chromium
# Playwright mock project: the sign-in flow against the mocked api, no Docker (R3.13, O-264)
e2e-mock:
    pnpm --filter @g-tee-oh/web run e2e:mock

# Take the bench lock first (PM rules): nothing heavy may run beside it. BENCH_MACHINE and
# BENCH_CONCURRENT_WORK pass through the environment to the spec, which writes
# validation/reports/matrix-frame-<machine>.json; the harness preview server starts on its own.
# Matrix frame bench on the harness build, Playwright bench project (R3.12, O-260); take the bench lock first
bench-web:
    pnpm --filter @g-tee-oh/web run bench

# SCREENSHOT_DIR passes through the environment to the spec; the harness preview server starts on its own.
# Screenshots of the login, home shell and gallery sections, light and dark, Playwright shots project (O-67)
shots:
    pnpm --filter @g-tee-oh/web run shots

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

# Benchmark harness: solve iteration, chunk decode, node read, grade; writes validation/reports/bench-zenbook.json (R0.10, R2.13)
bench:
    cargo bench -p gto-solve -p gto-library -p solver-query --features gto-library/synthetic
    node scripts/bench-report.mjs

# Release build: the three scenarios pack in seconds there and in minutes in debug (O-134).
# Synthetic library size estimate written by library-pack, seed and parameters printed (R2.7, R-19)
library-size-estimate:
    cargo run --release -p library-pack -- estimate --seed 7 \
        --out validation/reports/library-size-estimate.md

FIXTURE_DUMP := "target/fixtures/synthetic-dump.json"
FIXTURE_LIBRARY := "target/fixtures/library"

# A seeded synthetic dump packed into target/fixtures/library for the dev profile (O-149);
# set FIXTURE_LIBRARY_PATH=target/fixtures/library in .env to serve it. Nothing binary is
# committed; S19 fills validation/fixtures/library. Release, as pack is slow in debug (O-134).
# Synthetic fixture library: library-pack synthetic, then pack into target/fixtures (R2.13, O-149)
fixture-synthetic:
    cargo run --release -p library-pack -- synthetic --seed 7 --nodes 256 --out {{FIXTURE_DUMP}}
    cargo run --release -p library-pack -- pack --dump {{FIXTURE_DUMP}} \
        --out {{FIXTURE_LIBRARY}} --synthetic

# Line coverage of gto-library and library-pack at the 80% gate (O-134); needs cargo-llvm-cov
coverage-library:
    cargo llvm-cov -p gto-library -p library-pack --features gto-library/synthetic \
        --ignore-filename-regex "(gto-model|vendor|gto-solve)" --fail-under-lines 80

# Statement, branch, function and line coverage of packages/learning at the 80% gate (S22, A9 section 1)
coverage-learning:
    pnpm --filter @g-tee-oh/learning coverage

# Statement, branch, function and line coverage of web/src at the 80% gate (S24, A9 section 1)
coverage-web:
    pnpm --filter @g-tee-oh/web coverage

# Line coverage of solver-query at the 80% gate (O-134, plan D.9); needs cargo-llvm-cov
coverage-solver-query:
    cargo llvm-cov -p solver-query --features gto-library/synthetic \
        --ignore-filename-regex "(gto-model|gto-library|library-pack|vendor|gto-solve)" --fail-under-lines 80

# The validate tool solves the toy games and writes g1-kuhn, g2-akq and g3-leduc as JSON
# (JavaScript Object Notation) with Markdown twins; --machine, else VALIDATE_MACHINE, else
# the host name names the machine (O-125). It refuses a dirty working tree, so the commit
# a committed report names is the code that ran. No database needed.
# Validation gates G1 to G3 (R2.4 to R2.6); writes the six reports to validation/reports
gates:
    cargo run --release -p validate -- gates --out validation/reports

GATE_CHECK_DIR := "target/gate-reports"

# What ci runs instead of gates: the committed reports stay untouched, and --allow-dirty
# lets a development tree run (the reports' notes then say the tree was dirty).
# Gates G1 to G3 into target/gate-reports, check-reports, then g4-check (R2.4 to R2.6, R2.11)
gates-check:
    cargo run --release -p validate -- gates --out {{GATE_CHECK_DIR}} --allow-dirty
    node scripts/check-reports.mjs {{GATE_CHECK_DIR}}
    just g4-check

G4_CHECK_DIR := "target/gate-reports/g4"
G4_TINY := "validation/fixtures/g4"

# The Zenbook run of gate G4 (R2.11, O-168, O-170): solves validation/fixtures/g4-spots.json
# with the engine, compares against the oracle dump ORACLE the private program wrote, and
# writes g4-oracle.json, g4-oracle.md and engine-dump.json into OUT, the private repository's
# validation/reports/g4 (09 section 7). Clean tree, VALIDATE_MACHINE=zenbook.
# Gate G4 oracle compare: validate g4 --oracle ORACLE --out OUT --write-engine OUT/engine-dump.json
g4 ORACLE OUT:
    cargo run --release -p validate -- g4 --oracle {{ORACLE}} --out {{OUT}} \
        --write-engine {{OUT}}/engine-dump.json

G4_SPOTS_RAKED := "validation/fixtures/g4-spots-raked.json"

# The informational rake comparison (O-161): the two raked twins of g4-spots-raked.json
# against the oracle dump ORACLE the private program wrote for that list, written into OUT
# as g4-oracle-raked.json, g4-oracle-raked.md and engine-dump-raked.json beside the G4
# report. A list and a report of its own because a node dump holds each key once; nothing
# in it is gated, so the rows are read, not judged. Clean tree, VALIDATE_MACHINE=zenbook.
# Rake comparison: validate g4 --spots g4-spots-raked.json --report-id g4-oracle-raked ...
g4-raked ORACLE OUT:
    cargo run --release -p validate -- g4 --spots {{G4_SPOTS_RAKED}} --oracle {{ORACLE}} \
        --out {{OUT}} --report-id g4-oracle-raked --write-engine {{OUT}}/engine-dump-raked.json

# The compare half of the G4 smoke: the committed synthetic tiny pair, no solve, into target
# (O-168); the committed reports stay untouched. The rust job runs this one, because it has
# cargo but no node_modules (check-reports needs ajv, which the ts job installs).
# Gate G4 compare smoke on the tiny pair into target/gate-reports/g4 (R2.11)
g4-smoke:
    cargo run --release -p validate -- g4 --spots {{G4_TINY}}/tiny-spots.json \
        --engine {{G4_TINY}}/engine-tiny.json --oracle {{G4_TINY}}/oracle-tiny.json \
        --out {{G4_CHECK_DIR}} --allow-dirty

# What gates-check and so just ci run for G4: the smoke, then check-reports on its report
# Gate G4 smoke, then check-reports on target/gate-reports/g4 (R2.11)
g4-check: g4-smoke
    node scripts/check-reports.mjs {{G4_CHECK_DIR}}

EQUITY_TABLE := "validation/fixtures/equity/preflop-169.json"

# Exact enumeration in gto_solve::equity, run once on the Zenbook from a clean tree and
# committed, never in CI (O-126).
# 169 by 169 preflop equity table (R2.20); writes validation/fixtures/equity/preflop-169.json
equity-table:
    cargo run --release -p validate -- equity-table --out {{EQUITY_TABLE}}

# Report schema check (R0.11): validation/reports/*.json against the schema, gate reports pass
report-check:
    node scripts/check-reports.mjs

# contracts and contracts-check need a migrated database for the Kysely step, e2e the compose stack, images buildx.
# Everything the hosted jobs run that needs neither Docker nor a database, in order
ci: rust-fmt rust-clippy rust-test rust-boundary gates-check ts-lint ts-typecheck ts-test coverage-learning coverage-web ts-boundary report-check licenses security guard-test test-tags
