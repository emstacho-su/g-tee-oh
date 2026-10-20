# Upstream provenance

This directory is the `engine/` crate of https://github.com/ucsandman/postflop, vendored under the MIT license per ADR 0002. The upstream LICENSE file sits beside this note as `LICENSE`; it stays with the code and is never edited.

| Field | Value |
|---|---|
| Upstream repository | https://github.com/ucsandman/postflop |
| Upstream commit | 5fc7ee3d92b823b6c58e4f58cbee7d50d5e9e6de (branch main, 2026-09-02) |
| Subdirectory | engine/ |
| Split commit | b515f0057c9135917d88291e6ddd35cfa2457b99 (git subtree split --prefix=engine) |
| Vendored on | 2026-10-20 |
| Crate name | engine (unchanged, so later subtree pulls merge cleanly); the workspace refers to it as the dependency alias postflop-engine |

## How it was vendored

The upstream repository is a Cargo workspace with a browser workbench and large fixtures beside the engine, so only the engine crate is vendored:

```text
git clone https://github.com/ucsandman/postflop.git upstream
cd upstream
git subtree split --prefix=engine -b engine-only
cd ../g-tee-oh
git subtree add --prefix crates/vendor/postflop-engine ../upstream engine-only --squash
```

## How to update

```text
cd upstream
git fetch origin
git checkout main
git subtree split --prefix=engine -b engine-only
cd ../g-tee-oh
git subtree pull --prefix crates/vendor/postflop-engine ../upstream engine-only --squash
```

Then update the commit fields above and rerun the validation gates G1 to G3.

## Local changes

None. Changes needed by g-tee-oh live in `gto-solve` adapters, not in this directory, so the subtree stays mergeable.