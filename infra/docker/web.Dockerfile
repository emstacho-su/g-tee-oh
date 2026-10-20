# syntax=docker/dockerfile:1
# web image (R0.3 Dockerfile part, R0.5). The React and Vite single-page app from A1 section
# 1 (ADR 0006), built to static files and served by Caddy inside the image on port 8080.
# Multi-arch for linux/amd64 and linux/arm64 through buildx: node:24-slim and caddy:2-alpine
# publish both platforms and nothing here compiles native code.
#
# Mechanism: the build stage enables pnpm through corepack, copies every workspace manifest
# so pnpm can resolve the workspace graph, installs only the web package and its workspace
# dependencies with --frozen-lockfile, copies the sources and runs the build script if one
# exists. Until S06 lands the Vite skeleton (R0.7) there is no build script, so the stage
# writes a placeholder web/dist/index.html instead; that branch disappears on its own once a
# real build produces web/dist/index.html. The runtime stage is caddy:2-alpine with a
# Caddyfile written inline: it serves /srv and falls back to index.html for client-side
# routes, listens on the unprivileged port 8080 and runs as a non-root user. The edge Caddy
# from infra/compose publishes the local area network (LAN) port and terminates Transport
# Layer Security (TLS) (A5 section 1, 02 section 6.4); this container never does.
#
# Build one platform locally (infra/docker/README.md):
#   docker buildx build --load --platform linux/amd64 \
#     -f infra/docker/web.Dockerfile -t g-tee-oh/web:dev .

ARG NODE_IMAGE=node:24-slim
ARG CADDY_IMAGE=caddy:2-alpine

# ---- build: install the web workspace slice and produce web/dist -------------------------
FROM ${NODE_IMAGE} AS build
# PNPM_HOME also sets pnpm's store directory to /pnpm/store, which the cache mount below
# targets. COREPACK_ENABLE_DOWNLOAD_PROMPT=0 lets corepack fetch pnpm without a prompt.
ENV PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# Manifests first, so the install layer is reused until a manifest or the lockfile changes.
# Every workspace manifest is needed: pnpm resolves the whole workspace before it filters,
# and --frozen-lockfile fails when an importer in the lockfile has no manifest on disk.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY services/api/package.json services/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/learning/package.json packages/learning/
COPY web/package.json web/
# "@g-tee-oh/web..." selects the web package and everything it depends on in the workspace.
# The root package's devDependencies (vite, typescript) are not selected; S06 adds
# --filter . here or moves vite into web/package.json when the real build lands.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@g-tee-oh/web..."

COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY web web
# No build script exists before S06; --if-present keeps the image buildable until then.
RUN pnpm --filter @g-tee-oh/web run build --if-present

# Placeholder until S06's Vite build writes web/dist/index.html. The check is on the file,
# so a real build wins without any edit here.
RUN <<'SH'
set -eu
if [ ! -f web/dist/index.html ]; then
  mkdir -p web/dist
  cat > web/dist/index.html <<'HTML'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>g-tee-oh</title>
  </head>
  <body>
    <main>
      <h1>g-tee-oh</h1>
      <p>web image placeholder, S06 adds the Vite build (R0.7).</p>
    </main>
  </body>
</html>
HTML
fi
SH

# ---- runtime: Caddy serving the static build ---------------------------------------------
FROM ${CADDY_IMAGE} AS runtime
LABEL org.opencontainers.image.source="https://github.com/emstacho-su/g-tee-oh" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.title="g-tee-oh web" \
      org.opencontainers.image.description="Static single-page app served by Caddy; the edge Caddy in compose publishes it"

# admin off: no admin endpoint and no autosave, so the container needs no writable config.
# auto_https off: TLS belongs to the edge Caddy (02 section 6.4); this one speaks plain HTTP
# on the compose network. try_files sends unknown paths to index.html for client routes.
COPY <<'CADDYFILE' /etc/caddy/Caddyfile
{
	admin off
	auto_https off
}

:8080 {
	root * /srv
	encode gzip
	try_files {path} /index.html
	file_server
}
CADDYFILE

COPY --from=build /app/web/dist /srv

# Non-root with a fixed user id. /config and /data are the image's XDG_CONFIG_HOME and
# XDG_DATA_HOME directories; they are owned by the user so Caddy can still write there if a
# later Caddyfile needs it.
RUN set -eu; \
    addgroup -S -g 10001 gto; \
    adduser -S -D -H -u 10001 -G gto -s /sbin/nologin gto; \
    chown -R gto:gto /config /data /srv
USER gto
EXPOSE 8080

# busybox wget ships with the alpine base, so the probe needs no extra package.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
