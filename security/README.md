# Optional security scans

Normal app setup and `npm run verify` do not require a scanner. The native CE scan adapter is optional and uses an explicitly approved external `run-scans.sh` orchestrator. It does not download tools, install a skill, log in or upload source.

## Setup

Configure absolute local paths before running a separately reviewed scan:

| Environment variable | Required tool                                                                    |
| -------------------- | -------------------------------------------------------------------------------- |
| SEMGREP_BINARY       | Native Semgrep CE executable                                                     |
| JQ_BINARY            | Native jq executable                                                             |
| SEMGREP_SCAN_RUNNER  | Approved run-scans.sh orchestrator                                               |
| BASH_BINARY          | Optional Bash executable; defaults to Git Bash on Windows or /bin/bash elsewhere |

```sh
node security/run.mjs security-20
node security/summarize.mjs security-20
```

Choose a fresh security-N directory. Existing output is never overwritten. The adapter supplies this repository's eight-pack rulesets.json, important-only mode and one job. Wrappers enforce metrics/version checks off, memory bounds and source/dependency/secret exclusions. Missing tool configuration fails before scanning. Review any raw findings even when the important-only filter removes them.

The original scan workflow is from the separately installed Semgrep skill's run-scans.sh. It is not vendored or silently installed here. Users without that approved runner can still inspect the pinned rule fixes and run their fixture command with a native Semgrep executable:

```sh
node scripts/test-security-rules.mjs ABSOLUTE_SEMGREP_EXECUTABLE
```

## Apiiro compatibility repairs

Three upstream rules failed under native CE 1.186.0. Dart and JavaScript/TypeScript switches now use complete case/default patterns. Java's invalid bare-class alternative was redundant with its valid class-body pattern and was removed. Rule IDs and severities remain. A Dart constant-folding false negative is covered while intentional while(true) remains excluded.

The wrapper patches only a generated Apiiro clone under artifacts/security-N/repos. Original and replacement SHA-256 values pin canonical UTF-8/LF content, accepting Git's equivalent CRLF checkout. Unknown upstream drift, tampered replacements and out-of-scope paths fail closed before any rule is written. The original MIT notice is retained in apiiro-fixes/APIIRO-LICENSE. Repairs are local and have not been submitted upstream.

Fixtures cover Dart, Java, JavaScript and TypeScript positives/negatives. Unit tests cover patching, idempotence, CRLF compatibility, tampering and scope rejection. The test command records source-bound evidence under artifacts. Release receipts reject rule errors and stale/missing evidence.

CE lacks Pro cross-file taint analysis. The external runner excludes an unsupported elttam join-mode rule. Important-only is a filtered security scan, not proof that every rule or possible vulnerability was checked. Source hashes and a zero-finding result do not establish real integration acceptance or production certification.
