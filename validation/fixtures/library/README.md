# Fixture library placeholder

This directory is the host side of the solutions library that the end to end (e2e) job mounts into the solver-query container. The mount is read only and the path inside the container is fixed at /fixtures/library. The compose file takes the host path from FIXTURE_LIBRARY_PATH and falls back to this directory when that variable is empty, so a checkout with nothing else configured still has something to mount.

It holds no reference data. Session S19 fills it with the G6a solution and the synthetic sets described in O-30 and O-57. Until then the solver-query health probe reports the mounted path as present and the library as empty, which is what the e2e smoke flow expects.
