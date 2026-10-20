---
id: 'g-tee-oh-docs-security'
title: 'Security threat model (stub)'
collection: 'g-tee-oh'
type: planning
status: 'stub'
created: 2026-10-20
public: true
tags: [g-tee-oh, security]
---
# Security threat model

This is the stub required by the Phase 0 foundations work (R0.12). It is reviewed and extended at each sprint gate, as the quality and operations architecture note requires. The model assumes a single user on a local network and builds as if that were not true, so nothing here is relaxed because only one person uses the system.

## Assets

- The Claude API key used for explanations on request.
- The browser profile and session used for reference-data capture (private repo only).
- Captured reference data (private bucket only).
- The owner's training history.

## Controls in place after Phase 0

| Area | Control | Where |
|---|---|---|
| Private data | A pre-commit hook and a continuous integration (CI) check reject reference-data file patterns and a salted sha256 denylist of identifiers; a history scan covers every commit | `guard/`, `.githooks/`, the `security` job |
| Secrets | `.env` files and the guard inputs under `.guard-private/` are ignored by git; the guard salt lives in a repository secret | `.gitignore`, repository settings |
| Supply chain | Lockfiles committed; cargo-deny blocks GPL and AGPL licenses; cargo audit and pnpm audit run in CI; secret scanning runs in CI | `deny.toml`, the `licenses` and `security` jobs |
| Code review | Every change arrives by pull request into the sprint branch with its requirement identifiers listed | `.github/PULL_REQUEST_TEMPLATE.md` |

## Controls that arrive later

Transport (Caddy with an internal certificate authority), authentication (argon2id, HTTP-only cookies, rate limiting), request validation (Zod on every input, CSRF protection, CORS locked to the app origin), least-privilege database roles and container hardening land with the services that need them in Phases 0 to 3, and this document gains a row for each as it does.

## Review log

| Date | Gate | Outcome |
|---|---|---|
| 2026-10-20 | Phase 0 foundations (S01) | Stub created |
