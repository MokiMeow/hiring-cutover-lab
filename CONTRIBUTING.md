# Contributing

Start with [the README](README.md) and [the documentation index](docs/README.md). Small changes with a clear failure case are easiest to review.

## Local setup

Use Node.js 24.22 or newer and npm. Install pinned dependencies with `npm ci --ignore-scripts`. For browser checks, run `npx --no-install playwright install chromium --only-shell` once, or set `BROWSER_PATH` to a compatible headless Chromium executable.

Before opening a pull request:

```sh
npm run verify
```

This checks syntax, runs unit/API tests, executes the required browser journeys, validates the browser report and starts/stops the real CLI process for an HTTP smoke check. It does not contact recruiting vendors. Browser tests use one worker and zero retries.

## Changes and fixtures

- Reproduce a bug before fixing it and cover the observable behavior with a regression.
- Use invented records and `example.test` addresses. Do not attach candidate data, credentials, database files or private assessment material.
- Preserve authorization, identity checks, explicit review, immutable evidence and fail-closed validation.
- Keep outcome assertions and the injected-failure probe. Do not use retries, skipped tests or force clicks to hide a failure.
- Keep runtime dependencies and background work small. Explain new dependencies and retain their licenses.
- Format the files you change with the pinned Prettier version. Do not reformat hash-pinned scanner fixtures.

`artifacts/` is local evidence. It, databases and dependency directories stay out of Git. Optional strict-engine and security scans need separately configured tools; see [validation](docs/RESULTS.md) and [scanner notes](security/README.md).

For ordinary bugs, include the version, minimal invented reproduction, expected result and actual result. For security issues, follow [SECURITY.md](SECURITY.md) instead of posting sensitive details publicly.
