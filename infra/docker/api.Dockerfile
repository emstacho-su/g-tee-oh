# syntax=docker/dockerfile:1
# api image (R0.3 Dockerfile part, R0.5). The TypeScript Fastify product application
# programming interface (API) from A1 section 1 and A5 section 1, internal port 8080,
# exposed through Caddy at /api/*. Multi-arch for
# linux/amd64 and linux/arm64 through buildx: node:24-slim publishes both platforms and the
# install step has no native build, so the same stages run under either platform.
#
# Mechanism: the build stage enables pnpm through corepack (Node 24 ships corepack; the
# version comes from the packageManager field in package.json), copies every workspace
# manifest so pnpm can resolve the whole workspace graph, installs only the api package and
# its workspace dependencies with --frozen-lockfile, then copies the sources and runs the
# build script if one exists. The runtime stage copies the installed tree to a fresh
# node:24-slim and runs as the image's unprivileged node user.
#
# Until S06 lands the server (R0.7) there is no build script and no services/api/dist, so
# this file must still build and the container must still start:
#   - the build stage runs `pnpm --filter @g-tee-oh/api run build --if-present`, which
#     exits 0 when the script is absent;
#   - the runtime CMD checks for services/api/dist/index.js and, when it is absent, prints
#     "api image placeholder, S06 adds the server" and exits 0 instead of failing.
# S06 replaces the placeholder branch with the real entrypoint and adds a HEALTHCHECK against
# GET /api/v1/healthz (A5 section 3).
#
# Build one platform locally (infra/docker/README.md):
#   docker buildx build --load --platform linux/amd64 \
#     -f infra/docker/api.Dockerfile -t g-tee-oh/api:dev .

ARG NODE_IMAGE=node:24-slim

# ---- base: Node with pnpm through corepack ----------------------------------------------
FROM ${NODE_IMAGE} AS base
# PNPM_HOME also sets pnpm's store directory to /pnpm/store, which the cache mount below
# targets. COREPACK_ENABLE_DOWNLOAD_PROMPT=0 lets corepack fetch pnpm without a prompt.
ENV PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ---- build: install the api workspace slice and run its build script if present ---------
FROM base AS build
# Manifests first, so the install layer is reused until a manifest or the lockfile changes.
# Every workspace manifest is needed: pnpm resolves the whole workspace before it filters,
# and --frozen-lockfile fails when an importer in the lockfile has no manifest on disk.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY services/api/package.json services/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/learning/package.json packages/learning/
COPY web/package.json web/
# "@g-tee-oh/api..." selects the api package and everything it depends on in the workspace.
# The root package's devDependencies are not selected; if S06's build needs them (tsc from
# the root), add --filter . or move the compiler into services/api.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@g-tee-oh/api..."

COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY packages/learning packages/learning
COPY services/api services/api
# No build script exists before S06; --if-present keeps the image buildable until then.
RUN pnpm --filter @g-tee-oh/api run build --if-present

# ---- runtime ----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
LABEL org.opencontainers.image.source="https://github.com/emstacho-su/g-tee-oh" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.title="g-tee-oh api" \
      org.opencontainers.image.description="Fastify product API in front of solver-query and Postgres (app role)"
ENV NODE_ENV=production
WORKDIR /app
# The installed tree keeps pnpm's node_modules symlinks, so it is copied whole. The node
# user (uid 1000) ships with the official image. S06 may switch this to `pnpm deploy` once
# the api has runtime dependencies worth pruning.
COPY --from=build --chown=node:node /app /app
USER node
# A5 section 1: the api listens on 8080 inside the compose network; Caddy publishes it.
EXPOSE 8080

# Placeholder rule (see the header): run the built server when services/api/dist/index.js
# exists, otherwise print the placeholder line and exit 0. S06 removes the else branch.
CMD ["sh", "-c", "if [ -f services/api/dist/index.js ]; then exec node services/api/dist/index.js; else node -e \"console.log('api image placeholder, S06 adds the server')\"; fi"]
