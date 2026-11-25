# Validation and recorded results

The [GitHub Actions workflow](https://github.com/MokiMeow/hiring-cutover-lab/actions/workflows/ci.yml) is the current published-commit check. Local verification writes fresh source fingerprints and hashed output evidence to ignored artifacts. A historical result is not carried forward as proof for changed source.

## Reproduce the checks

```sh
npm ci --ignore-scripts
npx --no-install playwright install chromium --only-shell
npm run verify
```

Verification requires nonempty passing unit/API tests, all 18 approved browser journey titles with zero retries/skips, the report gate and a real CLI process smoke check. The CLI must return HTTP 200 for health, readiness, sign-in and records, then stop its owned process.

```sh
node scripts/supplementary.mjs fault
```

The fault profile deliberately breaks the ordinary healthy journey. The check passes only when the expected failure and its marker are observed; an unexplained failure or a healthy run does not count as a successful fault probe.

Optional profiles take explicit local tool paths:

```sh
node scripts/supplementary.mjs node24 --node ABSOLUTE_NODE_24_EXECUTABLE
node scripts/supplementary.mjs strict --flashwright ABSOLUTE_STRICT_TEST_ENTRY
node scripts/test-security-rules.mjs ABSOLUTE_SEMGREP_EXECUTABLE
```

The strict profile is a separate reviewed local Flashwright installation, not a dependency of this application. Normal contributors and CI use pinned Playwright. Browser/API tests use invented data and loopback provider fixtures, without contacting real recruiting accounts.

## Recorded baseline, 24 November 2026

This is a dated baseline before repository portability/documentation cleanup. Use the current CI result and fresh local evidence for a later revision.

| Check                              | Recorded result                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| Unit/API/tooling                   | 71 passed on Node 26.13.1 and Node 24.22.3                                                        |
| Stable and strict browser profiles | 18 required journeys per engine, no retries/skips                                                 |
| Fault probe                        | Injected API failure caught by the healthy journey and report gate                                |
| CLI and persistence                | Actual process startup, HTTP readiness, owned-process shutdown and backup/restore checked         |
| Eight-pack Semgrep CE              | Zero rule parse errors, important findings, failed packs or skipped packs                         |
| Raw static-analysis warning        | One reviewed low-confidence local scanner-launcher warning; no application input path established |
| Rule repair fixtures               | Dart, Java, JavaScript and TypeScript positive/negative cases passed                              |

Semgrep's important-only mode filters severity and security metadata. The CE runner excludes an unsupported elttam join-mode rule and does not provide Pro cross-file taint analysis. Secret files, generated artifacts, dependencies and vendored CSS are excluded. Zero findings is not a security certification. See [scanner setup and limitations](../security/README.md).

Local receipts bind source, command, actual Node version and fresh output hashes. Missing outputs, changed source, signals, timeouts, skipped/empty suites, unequal compatibility counts and rule errors cannot produce a passing current receipt. These are local checks, not externally signed attestations.

## External acceptance

Live vendor acquisition, production data/migration, hosted identity and organization cutover acceptance remain outside the verified scope. Read REAL-USE.md and CONTRACT.md. The synthetic runtime guard remains enforced. The comparison matrix blocks 240 seeded broken migration cases; browser coverage includes a 3,000-candidate cohort.
