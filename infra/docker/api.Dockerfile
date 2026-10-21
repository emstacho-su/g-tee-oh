# syntax=docker/dockerfile:1
# api image (R0.3 Dockerfile part, R0.5, R0.7). The TypeScript Fastify product application
# programming interface (API) from A1 section 1 and A5 section 1, internal port 8080,
# exposed through Caddy at /api/*. Multi-arch for
# linux/amd64 and linux/arm64 through buildx: node:24-slim publishes both platforms and the
# install step has no native build, so the same stages run under either platform.
#
# Mechanism: the build stage enables pnpm through corepack (Node 24 ships corepack; the
# version comes from the packageManager field in package.json), copies every workspace
# manifest so pnpm can resolve the whole workspace graph, installs only the api package and
# its workspace dependencies with --frozen-lockfile, then copies the sources and runs the
# api build script (esbuild, services/api/build.mjs, O-114), which bundles the workspace
# packages and whatever they import into services/api/dist/index.js and leaves only Node's
# built-ins and the api's own dependencies external, since those are what services/api/node_modules
# holds. The runtime stage copies the installed tree to a fresh node:24-slim and runs as the
# image's unprivileged node user.
#
# The HEALTHCHECK probes GET /healthz, the root alias of /api/v1/healthz (A5 section 3; the
# api serves both), with Node's own fetch so the image carries no curl. It assumes the default
# API_PORT of 8080, which compose also sets.
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

# ---- build: install the api workspace slice and run its build script --------------------
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
# The root package's devDependencies are not selected, which is why esbuild is a direct
# devDependency of services/api.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@g-tee-oh/api..."

COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY packages/learning packages/learning
COPY services/api services/api
# Writes services/api/dist/index.js and services/api/dist/openapi-export.js.
RUN pnpm --filter @g-tee-oh/api run build

# ---- runtime ----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
LABEL org.opencontainers.image.source="https://github.com/emstacho-su/g-tee-oh" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.title="g-tee-oh api" \
      org.opencontainers.image.description="Fastify product API in front of solver-query and Postgres (app role)"
ENV NODE_ENV=production
WORKDIR /app
# The installed tree keeps pnpm's node_modules symlinks, so it is copied whole: the bundle
# still imports fastify and its dependencies from node_modules at runtime. S21 may switch
# this to `pnpm deploy` once the api has runtime dependencies worth pruning.
COPY --from=build --chown=node:node /app /app
USER node
# A5 section 1: the api listens on 8080 inside the compose network; Caddy publishes it.
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "services/api/dist/index.js"]
