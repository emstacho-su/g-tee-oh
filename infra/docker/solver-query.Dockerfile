# syntax=docker/dockerfile:1
# solver-query image (R0.3 Dockerfile part, R0.5). The read-only query service from A1
# section 1 and A5 section 1, internal port 7070. Multi-arch for linux/amd64 and linux/arm64
# through buildx (docker/setup-buildx-action in .github/workflows/images.yml).
#
# Mechanism: the builder stage runs on the build host's own platform (BUILDPLATFORM) and
# cross-compiles for the requested target (TARGETARCH), so an arm64 image does not compile
# Rust under QEMU emulation. Every crate in Cargo.lock is pure Rust, so the only cross
# toolchain needed is the target's gcc as the linker. The runtime stage is the target
# platform's debian:bookworm-slim with the binary at /usr/local/bin/solver-query, a
# non-root user and no writable state, so compose can run it with a read-only root
# filesystem and dropped capabilities (A9 section 3; the compose file carries those flags).
#
# The build is cargo build --release -p solver-query, never --workspace. Cargo unifies
# features across a whole-workspace build, which would turn on gto-library's default
# `solve` feature and link gto-solve into this binary (O-101, architecture decision record
# (ADR) 0018). `just rust-boundary` checks the declared graph; this file keeps the built
# artifact honest.
#
# Build one platform locally (infra/docker/README.md):
#   docker buildx build --load --platform linux/amd64 \
#     -f infra/docker/solver-query.Dockerfile -t g-tee-oh/solver-query:dev .

ARG RUST_IMAGE=rust:1-slim-bookworm
ARG RUNTIME_IMAGE=debian:bookworm-slim

# ---- builder (runs on the build host, targets TARGETARCH) --------------------------------
FROM --platform=$BUILDPLATFORM ${RUST_IMAGE} AS builder
ARG BUILDPLATFORM
ARG TARGETPLATFORM
ARG TARGETARCH
ARG SERVICE=solver-query
WORKDIR /app

# Pick the Rust target triple from TARGETARCH and install the cross linker only when the
# host and target platforms differ. rust:1-slim-bookworm already carries the native gcc and
# libc6-dev, and Debian's gcc package installs the triplet-prefixed name the ENV below uses.
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) triple=x86_64-unknown-linux-gnu; cross="gcc-x86-64-linux-gnu libc6-dev-amd64-cross" ;; \
      arm64) triple=aarch64-unknown-linux-gnu; cross="gcc-aarch64-linux-gnu libc6-dev-arm64-cross" ;; \
      *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    if [ "$BUILDPLATFORM" != "$TARGETPLATFORM" ]; then \
      apt-get update; \
      apt-get install -y --no-install-recommends $cross; \
      rm -rf /var/lib/apt/lists/*; \
    fi; \
    rustup target add "$triple"; \
    echo "$triple" > /rust-target
ENV CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=x86_64-linux-gnu-gcc \
    CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc

# The Cargo workspace needs every member manifest present (Cargo.toml lists them all), so
# the whole Rust side is copied. .dockerignore keeps target/, node_modules/ and secrets out.
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY services/solver-query ./services/solver-query
COPY services/library-builder ./services/library-builder
COPY tools ./tools

# BuildKit cache mounts keep the crate registry and the target directory between builds.
# The target cache is keyed by service and architecture so parallel platform builds never
# share one. Cache mounts are not part of the image, so the binary is copied to /out.
RUN --mount=type=cache,id=cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=cargo-git,target=/usr/local/cargo/git \
    --mount=type=cache,id=cargo-target-${SERVICE}-${TARGETARCH},target=/app/target,sharing=locked \
    set -eu; \
    triple="$(cat /rust-target)"; \
    cargo build --release --locked -p "$SERVICE" --target "$triple"; \
    mkdir -p /out; \
    cp "target/$triple/release/$SERVICE" /out/

# ---- runtime (target platform) ----------------------------------------------------------
FROM ${RUNTIME_IMAGE} AS runtime
ARG SERVICE=solver-query
LABEL org.opencontainers.image.source="https://github.com/emstacho-su/g-tee-oh" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.title="g-tee-oh solver-query" \
      org.opencontainers.image.description="Read-only query service over the solutions library; it never solves (ADR 0018)"

# ca-certificates so a later Transport Layer Security (TLS) endpoint (the Simple Storage
# Service (S3) gateway over HTTPS on the Mac profile) works without a rebuild. Fixed user id
# 10001 so compose user: directives and volume ownership stay stable.
RUN set -eu; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates; \
    rm -rf /var/lib/apt/lists/*; \
    groupadd --system --gid 10001 gto; \
    useradd --system --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin gto

COPY --from=builder /out/${SERVICE} /usr/local/bin/${SERVICE}

USER 10001:10001
WORKDIR /
# A5 section 1: solver-query listens on 7070 inside the compose network only.
EXPOSE 7070

# No HEALTHCHECK yet. The S01 stub ignores its arguments, prints its version line and exits,
# so a `--version` probe would prove nothing. S06 adds GET /healthz (A5 section 2) and with it
# a probe such as: HEALTHCHECK CMD ["/usr/local/bin/solver-query", "healthz"] implemented as
# a self-check subcommand, which keeps curl and wget out of the image.

# Environment (names from .env.example): DATABASE_URL is not used here; the service reads
# under the query role (O-28) through QUERY_DB_PASSWORD, the library bucket through
# S3_ENDPOINT and S3_LIBRARY_*, the fixture library through FIXTURE_LIBRARY_PATH (O-62) and
# its chunk cache budget through QUERY_CACHE_BYTES. Compose supplies them; nothing is baked in.
ENTRYPOINT ["/usr/local/bin/solver-query"]
