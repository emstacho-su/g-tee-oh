# Container images

One Dockerfile per service, multi-arch for linux/amd64 and linux/arm64, built with Docker buildx (R0.3 Dockerfile part, R0.5; layout from A1 section 1). The continuous integration (CI) job `.github/workflows/images.yml` builds every entry of `images.json` on pull requests and pushes to the GitHub Container Registry (ghcr.io) on `v*` tags only (A9 section 2).

| File | Service | Base images | Port |
|---|---|---|---|
| `solver-query.Dockerfile` | Rust, read-only query service | `rust:1-slim-bookworm` then `debian:bookworm-slim` | 7070 |
| `library-builder.Dockerfile` | Rust, background build worker | `rust:1-slim-bookworm` then `debian:bookworm-slim` | 7071 |
| `api.Dockerfile` | TypeScript, Fastify product application programming interface (API) | `node:24-slim` | 8080 |
| `web.Dockerfile` | Vite single-page app served by Caddy | `node:24-slim` then `caddy:2-alpine` | 8080 |

Base image tags are pinned by major version. Every runtime stage runs as a non-root user with a fixed user id (10001 for the Rust and web images, the image's `node` user for the api), carries no writable state and sets Open Container Initiative (OCI) labels for the source repository and the Massachusetts Institute of Technology (MIT) license. Read-only root filesystems, dropped capabilities and memory limits are applied by the compose file, not by the images (A9 section 3).

## Build one image locally

From the repo root, which is the build context for every Dockerfile:

```powershell
docker buildx build --load --platform linux/amd64 -f infra/docker/solver-query.Dockerfile -t g-tee-oh/solver-query .
docker run --rm g-tee-oh/solver-query
```

`--load` puts the single-platform image into the local Docker engine so `docker run` finds it. A multi-platform build cannot be loaded; drop `--load` and pass `--platform linux/amd64,linux/arm64` to check that both platforms build, or add `--push` with a registry tag to publish.

The same shape builds the other three: swap the Dockerfile name and the tag. The web and api images build in under a minute; a Rust image takes several minutes on the first run and seconds afterwards, because the crate registry and the target directory live in BuildKit cache mounts that survive between builds.

## The solver-query rule: always `-p solver-query`

`solver-query.Dockerfile` runs `cargo build --release -p solver-query`, never `cargo build --workspace`. Cargo unifies features across every package in one build invocation. A whole-workspace build would turn on `gto-library`'s default `solve` feature, because `library-builder`, `validate` and `library-pack` want it, and that feature links `gto-solve` and the vendored engine into every binary of that build, `solver-query` included. Building the package alone resolves features for that package only, so the shipped binary holds no solver (O-101, architecture decision record (ADR) 0018). `just rust-boundary` checks the declared dependency graph on every CI run; the Dockerfile keeps the built artifact honest. Keep the `-p` form in any script or compose `build:` block that produces this image.

## How the Rust images cross-compile

The builder stage is pinned to the build host's platform (`FROM --platform=$BUILDPLATFORM`) and compiles for the requested target architecture (`TARGETARCH`): `x86_64-unknown-linux-gnu` for amd64 and `aarch64-unknown-linux-gnu` for arm64. Every crate in `Cargo.lock` is pure Rust, so the only cross toolchain the stage installs is the target's `gcc` as the linker, and only when the host and the target differ. The runtime stage is the target platform's `debian:bookworm-slim` and receives the binary by `COPY --from`. The result is that an arm64 image built on the Zenbook or a GitHub runner never compiles Rust under QEMU emulation; QEMU is used only for the small runtime-stage `RUN` that creates the user. The Mac (arm64) builds its own arm64 image natively the same way.

## Caches in CI

`images.yml` passes `cache-from` and `cache-to` of type `gha` with one scope per service, so image layers are reused between runs. The BuildKit cache mounts inside the Dockerfiles (the cargo registry and target directory, the pnpm store) are not part of that export, so a cold runner rebuilds the Rust dependency set from scratch. Two options when that becomes the slow step: `reproducible-containers/buildkit-cache-dance`, which saves and restores the cache mounts through `actions/cache`, or `cargo-chef`, which turns the dependency build into an ordinary image layer that the `gha` cache does keep. S06 picks one when it adds `solver-query` to the matrix.

## Placeholders until S06 (R0.7)

- `api.Dockerfile` runs `pnpm --filter @g-tee-oh/api run build --if-present`; with no build script the step exits 0. The runtime `CMD` runs `node services/api/dist/index.js` when that file exists and otherwise prints `api image placeholder, S06 adds the server` and exits 0.
- `web.Dockerfile` runs the web build the same way and writes a placeholder `web/dist/index.html` when the build produced none. A real `web/dist/index.html` wins without any edit to the Dockerfile.
- The Rust images carry no `HEALTHCHECK` yet. The S01 stubs ignore their arguments, print a version line and exit, so a `--version` probe would prove nothing. S06 adds `GET /healthz` (A5 section 2) and a self-check subcommand for the probe, which keeps `curl` and `wget` out of the images. The web image already probes `http://127.0.0.1:8080/` with busybox `wget`.

## The matrix file

`images.json` holds `{"services": [...]}`. Each entry is `{"name", "dockerfile", "context"}`. The `plan` job reads it with `jq`; when the list is empty it prints a notice and the `build` job is skipped, otherwise `build` runs once per entry. The first entry S06 adds is:

```json
{"name": "solver-query", "dockerfile": "infra/docker/solver-query.Dockerfile", "context": "."}
```

## Build context

`.dockerignore` at the repo root keeps `target`, `node_modules`, `.git`, `.guard-private`, `.env`, `docs`, `validation/reports` and the compose data volumes out of every build context, so nothing private or large reaches a layer.
