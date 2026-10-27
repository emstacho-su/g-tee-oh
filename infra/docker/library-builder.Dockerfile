# syntax=docker/dockerfile:1
# library-builder image (R0.3 Dockerfile part, R0.5). The background build worker from A1
# section 1 and A5 section 1, internal port 7071 for health and metrics only. Multi-arch for
# linux/amd64 and linux/arm64 through buildx (.github/workflows/images.yml).
#
# Mechanism: identical to solver-query.Dockerfile. The builder stage runs on the build host
# (BUILDPLATFORM) and cross-compiles for TARGETARCH, since every crate in Cargo.lock is pure
# Rust and only the target's gcc is needed as the linker. The runtime stage is the target
# platform's debian:bookworm-slim with the binary at /usr/local/bin/library-builder, a
# non-root user and no writable state in the image, so compose can run it read-only with
# dropped capabilities (A9 section 3) and the 5 GB memory cap from 02 section 6.2 (O-48).
#
# This binary is allowed to solve: cargo build --release -p library-builder links gto-solve
# and the vendored engine through gto-library's default `solve` feature (O-101, architecture
# decision record (ADR) 0018).
# It is still built with -p, not --workspace, so the target cache holds only what this
# service needs.
#
# Build one platform locally (infra/docker/README.md):
#   docker buildx build --load --platform linux/amd64 \
#     -f infra/docker/library-builder.Dockerfile -t g-tee-oh/library-builder:dev .

ARG RUST_IMAGE=rust:1-slim-bookworm
ARG RUNTIME_IMAGE=debian:bookworm-slim

# ---- builder (runs on the build host, targets TARGETARCH) --------------------------------
FROM --platform=$BUILDPLATFORM ${RUST_IMAGE} AS builder
ARG BUILDPLATFORM
ARG TARGETPLATFORM
ARG TARGETARCH
ARG SERVICE=library-builder
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
RUN --mount=type=cache,id=cargo-registry,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,id=cargo-git,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,id=cargo-target-${SERVICE}-${TARGETARCH},target=/app/target,sharing=locked \
    set -eu; \
    triple="$(cat /rust-target)"; \
    cargo build --release --locked -p "$SERVICE" --target "$triple"; \
    mkdir -p /out; \
    cp "target/$triple/release/$SERVICE" /out/

# ---- runtime (target platform) ----------------------------------------------------------
FROM ${RUNTIME_IMAGE} AS runtime
ARG SERVICE=library-builder
LABEL org.opencontainers.image.source="https://github.com/emstacho-su/g-tee-oh" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.title="g-tee-oh library-builder" \
      org.opencontainers.image.description="Background worker that solves the planner's build list into the solutions library"

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

# The O-148 pattern: one directory of validation/ enters the image. The hand-made builder
# fixtures (O-83, O-181, O-201) are what a smoke build and the Zenbook benchmark read
# before a preflop solution is packed: BUILDER_RANGES_FIXTURE points at a ranges file here,
# and `library-builder --once --job-spec /fixtures/builder/bench-bb-btn-srp.json` finds its
# ranges beside the spec. Read-only data owned by root; .dockerignore keeps the reports out.
COPY validation/fixtures/builder /fixtures/builder

USER 10001:10001
WORKDIR /
# A5 section 1: 7071 serves health and metrics only, inside the compose network (O-207).
EXPOSE 7071

# Health probe (A5 section 2, the solver-query pattern): the binary's own `healthz`
# subcommand opens a loopback TCP connection to the BUILDER_BIND port, sends GET /healthz
# and exits 0 on a 200 status line, so curl and wget stay out of the image. /healthz answers
# 503 while a configured database or bucket does not answer (O-207). start-period covers
# process start; six retries at 10s give a minute.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 CMD ["/usr/local/bin/library-builder", "healthz"]

# Environment (names from .env.example): the builder role (O-28) through the BUILDER_DB_*
# parts (O-146), the library bucket through S3_ENDPOINT and S3_LIBRARY_*, or LIBRARY_ROOT
# for a directory target (the benchmark), and BUILDER_BIND, BUILDER_THREADS,
# BUILDER_SCRATCH_DIR, BUILDER_WORKER_ID and BUILDER_RANGES_FIXTURE, each with a default.
# Scratch space for a build in progress is the compose-provided tmpfs at /tmp, not the
# image. Nothing secret is baked in.
ENTRYPOINT ["/usr/local/bin/library-builder"]
