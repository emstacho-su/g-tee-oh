# Container images

One Dockerfile per service, multi-arch for linux/amd64 and linux/arm64, built with Docker buildx (R0.3 Dockerfile part, R0.5; layout from A1 section 1). The continuous integration (CI) job `.github/workflows/images.yml` builds every entry of `images.json` on pull requests and pushes to the GitHub Container Registry (ghcr.io) on `v*` tags only (A9 section 2).

| File | Service | Base images | Port |
|---|---|---|---|
| `solver-query.Dockerfile` | Rust, read-only query service | `rust:1-slim-bookworm` then `debian:bookworm-slim` | 7070 |
| `library-builder.Dockerfile` | Rust, background build worker | `rust:1-slim-bookworm` then `debian:bookworm-slim` | 7071 |
| `api.Dockerfile` | TypeScript, Fastify product application programming interface (API) | `node:24-slim` | 8080 |
| `web.Dockerfile` | Vite single-page app served by Caddy | `node:24-slim` then `caddy:2-alpine` | 8080 |
| `spike-preflop.Dockerfile` | Rust, the preflop spike (`validate spike-preflop`, R2.21, O-228); not in `images.json`. Build: `docker buildx build --load --platform linux/amd64 -f infra/docker/spike-preflop.Dockerfile -t g-tee-oh/spike-preflop:dev .` Run: `docker run --rm --memory 5g --memory-swap 5g -e SPIKE_CONTAINER=... -e SPIKE_CONCURRENT=... -v <out>:/out g-tee-oh/spike-preflop:dev spike-preflop --out /out --machine zenbook --commit <sha> --allow-dirty` | `rust:1-slim-bookworm` then `debian:bookworm-slim` | none |

Base image tags are pinned by major version. Every runtime stage runs as a non-root user with a
fixed user id (10001 for the Rust and web images, the image's `node` user for the api), carries no
writable state and sets Open Container Initiative (OCI) labels for the source repository and the
Massachusetts Institute of Technology (MIT) license. Read-only root filesystems, dropped
capabilities, the `no-new-privileges` option and memory limits are applied by the compose file, not
by the images (A9 section 3); the compose file also mounts a tmpfs on the only paths a process
still writes under a read-only root, `/tmp` for the api's Node and `/data` plus `/config` for the
web image's Caddy.

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

`images.yml` passes `cache-from` and `cache-to` of type `gha` with one scope per service, so image layers are reused between runs. The BuildKit cache mounts inside the Dockerfiles (the cargo registry and target directory, the pnpm store) are not part of that export, so a cold runner rebuilds the Rust dependency set from scratch. Two options when that becomes the slow step: `reproducible-containers/buildkit-cache-dance`, which saves and restores the cache mounts through `actions/cache`, or `cargo-chef`, which turns the dependency build into an ordinary image layer that the `gha` cache does keep. Neither is adopted yet (O-121): the e2e job builds `solver-query`, `api` and `web` on its runner through `just dev-up` (a cold amd64 release build, roughly five minutes) and the images job keeps the `gha` layer cache as it is; `cargo-chef` is the first option to take when either job passes 15 minutes.

## What each image runs and how it reports health (R0.7)

- `api.Dockerfile` installs the `@g-tee-oh/api...` workspace slice, runs the api build script (esbuild bundles the workspace packages into `services/api/dist/index.js`, O-114) and starts it with `node services/api/dist/index.js`. Its `HEALTHCHECK` fetches `GET /healthz`, the root alias of `/api/v1/healthz`, with Node's own `fetch`, so the image carries no `curl`.
- `web.Dockerfile` installs the `@g-tee-oh/web...` slice, runs the Vite build and serves `web/dist` from Caddy on 8080 with `try_files` for client routes. Its `HEALTHCHECK` probes `http://127.0.0.1:8080/` with busybox `wget`.
- `solver-query.Dockerfile` carries `HEALTHCHECK CMD ["/usr/local/bin/solver-query", "healthz"]`:
  the binary's own subcommand connects to the configured bind (through the loopback when the bind
  is every interface), sends `GET /healthz` (A5 section 2), prints the health JSON and exits 0 on
  a 200 status line, which keeps `curl` and `wget` out of the image. The JSON's `fixture_library`
  block names the configured path and whether that directory exists inside the container. The
  smoke script (`infra/compose/smoke.mjs`, run by `just smoke` and the e2e job) runs this same
  subcommand through `docker compose exec`, parses the JSON it prints and fails unless `path` is
  `/fixtures/library` and `present` is true, which is how the `FIXTURE_LIBRARY_PATH` bind mount
  is proven (O-62).
- `library-builder.Dockerfile` carries no `HEALTHCHECK` yet: its S01 stub ignores its arguments, prints a version line and exits. The session that gives it a server adds the same self-probe pattern.

The compose dev profile (`infra/compose/compose.yaml`) relies on these image probes for `depends_on: condition: service_healthy` and `up --wait`; it repeats no healthcheck block for the three built images.

## The matrix file

`images.json` holds `{"services": [...]}`. Each entry is `{"name", "dockerfile", "context"}`: `name` becomes the image name under `ghcr.io/<repository>/` and the `gha` cache scope, `dockerfile` is a path from the repo root and `context` is always `.`, the repo root, because every Dockerfile's `COPY` paths and `.dockerignore` are written against it. The `plan` job reads the file with `jq`; when the list is empty it prints a notice and the `build` job is skipped, otherwise `build` runs once per entry for both platforms. The first entry is `solver-query` (S06):

```json
{"name": "solver-query", "dockerfile": "infra/docker/solver-query.Dockerfile", "context": "."}
```

`api`, `web` and `library-builder` are added in the same shape when their sessions publish them. `scripts/images-matrix.test.mjs` (run by `pnpm run test:scripts`, R0.3) checks that `solver-query` is listed, that every entry carries exactly those three keys, names an existing Dockerfile and uses the repo root as context, and that no name repeats.

## Build context

`.dockerignore` at the repo root keeps `target`, `node_modules`, `.git`, `.guard-private`, `.env`, `docs`, `validation/reports` and the compose data volumes out of every build context, so nothing private or large reaches a layer.
