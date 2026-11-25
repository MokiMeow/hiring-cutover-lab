# Canonical rehearsal contract, version 1

`public/contract.json` is a valid example bundle, not a JSON Schema document. Runtime validation lives in `src/engine.mjs` and is shared by the API and CLI.

Root fields: `schemaVersion: 1`, `source`, `target`, `mapping`, optional `rules`. Each snapshot has `schemaVersion: 1`, `synthetic: true`, `expectedCounts` and four arrays. Counts must be independently declared for the intended cohort, not inferred by an exporter from whichever partial pages it happened to receive. A matching count is a required check, not proof that an export was complete.

| Array        | Required record fields                             | Allowed states                                   |
| ------------ | -------------------------------------------------- | ------------------------------------------------ |
| jobs         | id, title, status                                  | open, closed, draft                              |
| candidates   | id, name, email                                    | email must use example.test                      |
| applications | id, candidateId, jobId, stage, status              | active, hired, rejected                          |
| assessments  | id, applicationId, testId, status, score, maxScore | invited, in_progress, reports_pending, completed |

IDs and relation IDs use 1 to 120 ASCII letters, digits, colon, underscore or hyphen. Text must be nonempty, without control characters, and at most 160 characters (email 254). IDs must be unique in each entity and snapshot. All relation targets must exist within that snapshot. Jobs, candidates and applications must be nonempty on the source. Assessments may be empty when declared as zero. Completed scores are finite numbers between zero and a positive maxScore. Other assessment states require both score fields to be null.

`mapping` contains one array per entity, each with `{sourceId,targetId}` pairs. Each source and target must have exactly one valid mapping. Missing, dangling, duplicate and colliding mappings block the rehearsal. Extra target records also block it. There is no fuzzy identity matching.

`rules.stageMap` explicitly translates source stage labels, for example `{"Technical":"Technical interview"}`. `rules.trimDisplayText: true` permits trimming only name/title comparisons. The default is false. Email, status, scores and relationships remain exact. Input snapshots are never rewritten. Source and target IDs may differ, but relationship comparison follows the approved mapping.

Unsupported fields, entities, policies and pair fields block the report. Do not quietly discard source custom fields to obtain a green report. This contract excludes attachments, notes, consent records, retention settings, users, offers, deletions and custom fields. A real migration needs a separately reviewed extension covering them.

The HTTP body and CLI input file limit is 8 MiB. Validation also caps JSON depth at 8, visited values at 200,000, each entity array at 20,000 and accumulated string bytes at 8 MiB. Some shapes hit the node bound before the array bound. The generator supports at most 3,000 candidates. Every issue blocks readiness. At most 2,000 issue details are retained, while the complete blocking count and truncation flag remain visible. Fix and rerun to inspect further issues.

The report records algorithm version, source/target record counts, compared and matching records, issue details and SHA-256 hashes of the canonical bundle, snapshots, mapping and effective rules. Object-key order does not affect hashes. Array order does affect provenance hashes. Approval binds the saved report hash and never clears issues.

CSV cells are always quoted. Formula-like strings starting with optional whitespace and `=`, `+`, `-` or `@` gain an apostrophe. CSV is intended for inspection, not round-trip source data. Re-saving through spreadsheet software may change its protections.
