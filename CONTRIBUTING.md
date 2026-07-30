# Contributing

Astilba Env accepts focused fixes, tests, documentation improvements, and reproducible bug reports.

## Local checks

Use the pinned package manager and run:

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm knip
pnpm pack:artifact
pnpm verify:consumers
```

Keep public and server projections physically separate. Do not add generated `dist` output, local artifacts, configuration files, credentials, or package-manager caches to Git.

## Pull requests

Describe the public behavior changed, include focused tests, and keep examples executable against the proposed package. Do not include customer configuration, vulnerability details, or unpublished release evidence.
