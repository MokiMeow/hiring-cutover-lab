# Readiness and remaining gates

This is a local release candidate for a single-organization, synthetic, offline rehearsal workflow. Local tests do not make it a production ATS migration service.

| Area                                                              | State                                                                                        |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Canonical comparison, explicit mapping and stage policy           | Implemented and exercised locally                                                            |
| Synthetic generator, import, evidence downloads and review        | Implemented and exercised locally                                                            |
| Local authentication, role checks, CSRF and session revocation    | Implemented and exercised locally                                                            |
| SQLite persistence and backup/restore                             | Implemented and exercised locally                                                            |
| Headless browser acceptance and injected-failure gate             | Local results in artifacts and RESULTS.md                                                    |
| Security scan                                                     | Approved local scans and rule repairs; current evidence is in artifacts/release-receipt.json |
| Native ATS exporters or production data                           | Not implemented or exercised                                                                 |
| Real migration or automated cutover                               | Not implemented or authorized                                                                |
| Hosted SSO, MFA, tenant isolation, distributed jobs and HA        | Not implemented                                                                              |
| External immutable audit, encrypted managed storage and retention | Not implemented                                                                              |
| Deployment and organization acceptance                            | Not performed                                                                                |

Before a real migration: agree a complete entity contract including attachments, consent and custom fields; implement and verify vendor exporters and cursor completeness; validate with organization-approved fixtures and independent manifests; rehearse restoration and rollback; review data handling and retention; select a deployment architecture and authenticate through the organization's identity provider; obtain the migration owner's release approval.

The listener intentionally binds to loopback HTTP. Cookies are HttpOnly and SameSite=Strict. They lack Secure because this local release has no TLS listener. This is a deliberate local boundary, not a ready public hosting configuration. Password hashing and SQLite operations are synchronous, suitable for the bounded local tool, not an unbounded multi-tenant service.
