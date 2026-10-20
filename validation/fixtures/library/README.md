# Fixture library placeholder

This directory is the host side of the solutions library that the end to end (e2e) job mounts into
the solver-query container. The mount is read only and the path inside the container is fixed at
/fixtures/library. The compose file takes the host path from FIXTURE_LIBRARY_PATH and falls back
to this directory when that variable is empty, so a checkout with nothing else configured still has
something to mount.

It holds no reference data. Session S19 fills it with the G6a solution and the synthetic sets
described in O-30 and O-57. Until then the directory holds only this README.

The mount is checked on every e2e run. The solver-query health response carries a fixture_library
block with the configured path and whether that directory exists inside the container; the smoke
script (infra/compose/smoke.mjs, run by just smoke and the e2e job) runs the container's own
healthz subcommand through docker compose exec, parses the JavaScript Object Notation (JSON) it
prints and fails unless that block reports path /fixtures/library with present true. A mount that
is missing or landed somewhere else therefore fails the e2e job before S19 adds the first library
read.
