# What real use means for this release

Hiring Cutover Lab's supported product is an offline synthetic migration rehearsal. Organizations can use it now with invented canonical source/target fixtures, explicit mappings, blocking differences and a separate administrator review. It does not read Greenhouse/HackerRank accounts or migrate candidate records. These are deliberate product boundaries, not a claim that account-connected migration acceptance passed.

## Before expanding to real vendor exports

| Decision or capability                  | Why it is required                                                                                                                    | Current state                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Source and destination ATS/API versions | Export models, pagination, identifiers and permissions differ                                                                         | Not selected                                                |
| Cohort and entity contract              | Define current/history records, jobs, stages, assessments, notes, consent, attachments, offers, custom fields and explicit exclusions | Only the four-entity synthetic v1 contract exists           |
| Acquisition adapters                    | Fetch or parse vendor-approved exports, retain page/cursor/capture metadata and reject unsupported data                               | Not implemented                                             |
| Independent completeness evidence       | Closing a cursor chain and matching operator-provided counts do not prove the intended vendor cohort is complete                      | Organization-authoritative counts and capture policy needed |
| Authoritative crosswalks                | Explicit identity, stage and test equivalence, including job-specific stages, must be reviewed                                        | Current mapping covers canonical v1 only                    |
| Real data authorization                 | Storage access, retention, encryption, backups and export ownership must be approved                                                  | Not supplied; runtime still requires synthetic data         |
| Migration/rollback acceptance           | Validate real vendor behavior and restoration with the migration owner                                                                | Not run; no migration writer exists                         |

Do not switch `synthetic:true` off, relabel real emails as `example.test` or discard unsupported fields to obtain a passing result. Local comparison hashes describe the supplied bundle, not independently complete vendor state or an authorized production cutover.

A safe next development step, once the vendor/export contract is selected, is an offline acquisition-manifest preflight. It should verify file hashes, byte/record counts, entity inventory, capture/cohort identity and cursor-chain closure, and reject missing pages, cycles, mixed captures, duplicate IDs and unsupported fields. Keep that acquisition receipt separate from comparison provenance. An operator-authored manifest remains an assertion and needs independent reconciliation.

Shared hosting, SSO/MFA, tenant isolation and high availability are required only if the product moves beyond the trusted local deployment. They are not implemented. The current listener remains loopback HTTP and should not be exposed publicly.

Use README.md and public/contract.json to run the supported synthetic workflow. Use artifacts/release-receipt.json for the current tested source and security evidence. No test result in this project establishes Relay's real Greenhouse/HackerRank account integration.
