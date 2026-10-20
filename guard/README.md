# Private-data guard

The guard keeps two kinds of private data out of this public repository (requirement R0.4, open question O-58): files whose path matches a private pattern, and identifiers that stand on a denylist. It is plain Node with no dependencies, lives under `guard/`, and runs as the pre-commit hook, as a step of the security job in continuous integration (CI), over the whole history, and over any directory on disk.

## How the path check works

`guard/patterns.json` holds glob-like patterns. Each path under test is normalized to forward slashes relative to the repository root and compared case-insensitively. In a pattern, `**/` matches zero or more whole directories, a trailing `/**` matches anything below a directory, `*` and `?` stay inside one path segment, and every other character is literal. The shipped patterns cover HTTP Archive (HAR) captures (`**/*.har`, `**/*.harx`), any `reference`, `capture` or `screenshots` directory at any depth, and `.guard-private/**`. A path that matches is a finding, and in paths mode the file is not opened at all.

The path check needs no secret, so it runs everywhere, including on forks.

## How the identifier check works

Every added line of a diff is split into tokens: runs of six or more letters, digits or underscores, lowercased. Each token is hashed as `sha256(salt + token)` with the salt immediately followed by the token and no separator. A hit is any hash that appears in `guard/denylist.sha256`, which holds one lowercase hex digest per line, with blank lines and `#` comments ignored.

The guard reports the file and the line number of a hit together with the first eight characters of the hash. It never prints the token. The denylist is salted so that the public file reveals nothing about the identifiers it protects: without the salt the hashes cannot be matched against a word list.

## Modes

Run `node guard/src/cli.mjs <mode>` from the repository root, or use the `just` recipes in brackets.

- `staged` [`just guard`]: paths from `git diff --cached --name-only --diff-filter=ACR` and added lines from `git diff --cached --unified=0`. This is what the pre-commit hook runs.
- `ci --base <sha>` [`just guard-ci`]: paths and added lines from `git diff <base>...HEAD`. When the base is empty, the zero sha, or not a commit in the clone, the guard says so and compares `HEAD~1...HEAD`; a root commit is compared against the empty tree. Without the flag the base comes from the `GUARD_BASE` environment variable.
- `history` [`just guard-history`]: every commit from `git rev-list --all`, with paths from `git show --name-only --diff-filter=ACR --format=` and added lines from `git show --unified=0 --format=`. Merge commits are read as combined diffs. Progress is printed every 50 commits.
- `paths <dir>` [`just guard-paths DIR`]: walks a directory, skipping `.git`. Paths are relative to the repository root when the directory sits in a work tree, otherwise relative to the directory. Files larger than 2 MB and binary files (containing a NUL byte) are not opened; every other file is scanned as if each line had been added.

## The salt and the fail-closed rule

The salt comes from the `GUARD_SALT` environment variable, or else from the file `.guard-private/salt` (trimmed) at the repository root. Locally that file exists on the owner's machine; in CI the security job sets `GUARD_SALT` from the repository secret of the same name.

When neither source is available the guard cannot run the identifier check. If `GUARD_FORK` is `true` or the flag `--patterns-only` is given, it runs the path check only and prints a notice. Otherwise it exits with code 2 and this message:

```text
guard: GUARD_SALT is not set and .guard-private/salt is missing; the identifier check cannot run (fail closed, O-58)
```

Failing closed means a misconfigured run can never report a clean result it did not earn.

## Exit codes and output

- 0: clean.
- 1: findings. One line per finding, such as `guard: path data/x.har matches private pattern **/*.har` or `guard: identifier at notes/a.md:12 hash 3f9a1c2e is on the denylist`.
- 2: configuration error (missing salt, unreadable denylist, unknown mode, git failure).

Every run ends with a summary line: `guard: <mode> checked <n> files and <m> added lines; <k> findings`.

## Adding an identifier

The plain list never enters this repository. It lives in `.guard-private/denylist.txt` on the owner's machine, which `.gitignore` and the guard patterns both cover, and moves to the private repository in session S03 (O-58). One identifier per line; blank lines and `#` comments are ignored. An entry must be a single run of six or more letters, digits or underscores, because that is what the tokenizer extracts; entries are lowercased before hashing because diff tokens are.

To regenerate the hashes:

```text
node guard/src/hash-denylist.mjs
```

The script reads `.guard-private/salt` and `.guard-private/denylist.txt`, rewrites `guard/denylist.sha256` sorted, and prints only counts and the line numbers of entries it skipped. It refuses to print a token or the salt. Commit the regenerated `guard/denylist.sha256`.

Changing the salt invalidates every hash, so regenerate the file and update the `GUARD_SALT` secret in the same step.

## The fork rule

A pull request from a fork runs without repository secrets, so the identifier check cannot run there. The security job passes `GUARD_FORK` from `github.event.pull_request.head.repo.fork`; when it is `true` the guard runs the path check only and says so. The identifier check then runs on the base repository once the change is pushed to a branch there, before it reaches `sprint/1-v1` or `main`.

## Hooks

`just hooks` sets `git config core.hooksPath .githooks`. `.githooks/pre-commit` runs `node guard/src/cli.mjs staged`; `.githooks/commit-msg` runs `node guard/src/commit-msg.mjs`, which rejects a commit made from a Claude Code session (the `CLAUDECODE` environment variable is set) that lacks the co-author trailer (O-29). Git for Windows runs these `sh` hooks through its bundled shell. On Linux and macOS the files need the executable bit, which git stores in the index.

## Tests

```text
just guard-test
node --test "guard/test/*.test.mjs"
```

The tests use synthetic salts, tokens and directories only. `GUARD_DENYLIST_PATH` points the command line at a temporary denylist and `GUARD_PRIVATE_DIR` points the hash script at a temporary private directory, so the real `guard/denylist.sha256` and `.guard-private/` are never read by a test.

## Environment variables

| Variable | Meaning |
|---|---|
| `GUARD_SALT` | The salt; wins over `.guard-private/salt` |
| `GUARD_FORK` | `true` on a fork pull request; path check only when the salt is missing |
| `GUARD_BASE` | Base commit for `ci` mode when `--base` is not given |
| `GUARD_DENYLIST_PATH` | Alternative denylist file (tests) |
| `GUARD_PRIVATE_DIR` | Alternative private directory for `hash-denylist.mjs` (tests) |
