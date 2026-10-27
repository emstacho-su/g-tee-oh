# syntax=docker/dockerfile:1
# spike-preflop image (R2.21, O-48, O-80, O-228). Runs `validate spike-preflop`, the preflop
# spike: the 15 push/fold solves of gate G6a and the minimal heads-up 100bb P2 run (O-227),
# measured for seconds and peak bytes under the 5 GB container cap and written as the
# spike-preflop-<machine> report (JSON and Markdown) to /out. Multi-arch for linux/amd64 (the
# Zenbook, through WSL2) and linux/arm64 (S20 reruns it on the Mac).
#
# Mechanism: the library-builder.Dockerfile pattern. The builder stage runs on the build host
# (BUILDPLATFORM) and cross-compiles `validate` in release for TARGETARCH with the cargo
# features in FEATURES, by default `peak-alloc`: the accounting allocator behind the spike's
# accounted peak, which the plain build leaves out so the gates run on the system
# allocator (O-228). Every crate in Cargo.lock is pure Rust and only the target's gcc is
# needed as the linker. The runtime
# stage is the target platform's debian:bookworm-slim with the binary at
# /usr/local/bin/validate, a non-root user, and the spike's two inputs at the same relative
# paths they have in the repository, under /opt/g-tee-oh:
#   validation/fixtures/equity/preflop-169.json (the equity table, O-126)
#   packages/contracts/schemas/examples/sizing-convention/valid/seed-online.json (O-136)
# The binary's compiled repository root (validate::repo_root, from CARGO_MANIFEST_DIR) is a
# builder path that does not exist here, so VALIDATE_REPO_ROOT points the spike at
# /opt/g-tee-oh instead (validate::spike::repo_root). The image has no git and no checkout,
# so the run line passes --commit <sha>; the spike then skips `git status` and records the
# tree as dirty when --allow-dirty is given, since the image may hold uncommitted changes.
#
# Build one platform (infra/docker/README.md); arm64 on the Mac swaps the platform:
#   docker buildx build --load --platform linux/amd64 \
#     -f infra/docker/spike-preflop.Dockerfile -t g-tee-oh/spike-preflop:dev .
#
# Run the measurement (the session lead only, under the benchmark lock). SPIKE_CONTAINER
# records this run line in the report notes and SPIKE_CONCURRENT what other heavy work ran:
#   docker run --rm --memory 5g --memory-swap 5g \
#     -e SPIKE_CONTAINER="docker run --rm --memory 5g --memory-swap 5g g-tee-oh/spike-preflop:dev" \
#     -e SPIKE_CONCURRENT="none" \
#     -v <out>:/out g-tee-oh/spike-preflop:dev \
#     spike-preflop --out /out --machine zenbook --commit <sha> --allow-dirty

ARG RUST_IMAGE=rust:1-slim-bookworm
ARG RUNTIME_IMAGE=debian:bookworm-slim

# ---- builder (runs on the build host, targets TARGETARCH) --------------------------------
FROM --platform=$BUILDPLATFORM ${RUST_IMAGE} AS builder
ARG BUILDPLATFORM
ARG TARGETPLATFORM
ARG TARGETARCH
ARG PACKAGE=validate
ARG FEATURES=peak-alloc
WORKDIR /app

# Pick the Rust target triple from TARGETARCH and install the cross linker only when the
# host and target platforms differ (as in library-builder.Dockerfile).
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

# The Cargo workspace needs every member manifest present, so the whole Rust side is copied.
# .dockerignore keeps target/, node_modules/ and secrets out.
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY services/solver-query ./services/solver-query
COPY services/library-builder ./services/library-builder
COPY tools ./tools

# BuildKit cache mounts keep the crate registry and the target directory between builds,
# keyed by package and architecture. Cache mounts are not part of the image, so the binary
# is copied to /out.
RUN --mount=type=cache,id=cargo-registry,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,id=cargo-git,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,id=cargo-target-${PACKAGE}-${TARGETARCH},target=/app/target,sharing=locked \
    set -eu; \
    triple="$(cat /rust-target)"; \
    cargo build --release --locked -p "$PACKAGE" --features "$FEATURES" --target "$triple"; \
    mkdir -p /out; \
    cp "target/$triple/release/$PACKAGE" /out/

# ---- runtime (target platform) ----------------------------------------------------------
FROM ${RUNTIME_IMAGE} AS runtime
ARG PACKAGE=validate
LABEL org.opencontainers.image.source="https://github.com/emstacho-su/g-tee-oh" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.title="g-tee-oh spike-preflop" \
      org.opencontainers.image.description="Preflop spike: push/fold and heads-up 100bb seconds and peak bytes under the 5 GB cap"

# Fixed user id 10001 as in the other Rust images. /out is created and owned by that user so
# the report can be written without a bind mount; with one, the host directory is used.
RUN set -eu; \
    groupadd --system --gid 10001 gto; \
    useradd --system --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin gto; \
    mkdir -p /out; \
    chown 10001:10001 /out

COPY --from=builder /out/${PACKAGE} /usr/local/bin/${PACKAGE}

# The spike's inputs at their repository-relative paths under VALIDATE_REPO_ROOT.
ENV VALIDATE_REPO_ROOT=/opt/g-tee-oh
COPY validation/fixtures/equity/preflop-169.json \
     /opt/g-tee-oh/validation/fixtures/equity/preflop-169.json
COPY packages/contracts/schemas/examples/sizing-convention/valid/seed-online.json \
     /opt/g-tee-oh/packages/contracts/schemas/examples/sizing-convention/valid/seed-online.json

USER 10001:10001
WORKDIR /

# No ports and no HEALTHCHECK: the container runs one measurement and exits with the
# validate exit code (0 pass, 1 a failed rule, 2 an error). No default command, since the
# run needs --commit and --machine from the caller.
ENTRYPOINT ["/usr/local/bin/validate"]
