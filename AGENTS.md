# Project rules

Read CONTEXT.md, README.md and docs/READINESS.md before changing the scope. Keep this tool synthetic and offline. Do not add live ATS calls, production data, external uploads or paid services without explicit authorization.

Preserve strict validation, independent expected-count checks, explicit identity mapping, orphan/duplicate checks, immutable run evidence and separate administrator review. Never clear issues or infer completeness from matching observed counts. Report hashes are not signatures.

Run `npm test`, `npm run check`, `npm run test:e2e`, `node scripts/gate.mjs` and `node scripts/smoke.mjs` after relevant changes. Use one headless browser worker. A green report must include every required browser title with no retries, skips or expected failures. Re-run the injected-failure check if the acceptance gate changes.

Security scans require the Semgrep skill's exact target/rules approval. Keep source local and metrics off. Record rule errors and incomplete coverage. No git push, publishing, real messaging or system changes without separate permission. No AI attribution. No em dashes.
