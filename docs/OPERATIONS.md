# Local operations

Run `npm ci --ignore-scripts`, then `Start-Demo.ps1` or follow README.md. Default port is 4312. The listener binds only to 127.0.0.1. Pick a free PORT if needed. No watcher, browser, service or container is started by the application.

Each database starts with admin only. Bootstrap configuration creates the first account; it does not reset an existing password. Sign in, rotate the password, add named operators/viewers and protect the last administrator. Disabling a user invalidates all its sessions immediately. Password changes also revoke all sessions for that user. Login allows eight attempts per normalized account and remote address per minute, plus a coarse 60-attempt address cap per minute. Untrusted forwarding headers are not used. Sessions expire after four hours. Account/session creation and hash upgrades commit atomically with their audit events.

Keep production personal data out of this tool. synthetic=true and example.test checks are guardrails, not a classifier capable of detecting real names inside arbitrary display text. Use invented fixtures only.

Backup: stop the app with Ctrl+C and copy the closed SQLite database to a restricted backup location. Do not copy only the main database file while WAL is active. The internal Store.backup(path) uses SQLite's backup API and is exercised by restore tests. A backup contains account hashes, sessions and imported evidence, so treat it as sensitive. Restoring on another machine requires Node 24.22 or newer and the same application version. Test restoration before relying on a backup. Future schema versions are rejected, not silently downgraded.

There is no destructive delete API. Run and audit lists show bounded recent windows; saved evidence stays in SQLite. Monitor disk use and establish an approved retention plan. Never delete data to obtain a passing report. Do not modify saved reports to clear issues: import a corrected bundle as a new run with a new request key.

JSON and CSV downloads require a valid session. The local browser interface uses same-origin requests, a CSP, text-only user-data rendering and exact static file routes. Database statements are parameterized. No URL from an input bundle is fetched. SHA-256 hashes are provenance checks, not signatures. A machine administrator can alter local files and hashes.

For an unexpected 500, preserve its request ID, app version and synthetic reproduction. Avoid logging whole request bodies, passwords or cookies. The server's optional onError hook emits only a request ID and error code. Health/readiness endpoints run a database probe; they do not assert external integration health.
