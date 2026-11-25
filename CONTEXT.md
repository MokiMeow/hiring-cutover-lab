# Hiring Cutover Lab

Offline, synthetic hiring migration rehearsal. Compare canonical jobs, candidates, applications and assessments across source/target snapshots with explicit ID mappings. Produce deterministic issues, completeness/relationship checks and content hashes; require a separate authorized review before marking a rehearsal approved. No production migration, automatic advance/reject decision or external connector is implemented or implied.

Source and target each declare schemaVersion1, synthetic:true, independent expectedCounts and four entity arrays. Mappings are explicit for every source identity. Relationships are checked within each snapshot and across the mapping. Strict field comparison is default; approved stage mappings and display-whitespace normalization are visible in the policy hash. Empty/incomplete/ambiguous data cannot pass.

Roles and expiring server sessions follow the already-tested local Assessment Relay access design. Node HTTP/SQLite/crypto; no external runtime assets or services. Test seams: public reconciliation engine, HTTP API/CLI, persisted runs/review, browser import/rehearsal/export. Every automated test uses synthetic data. Do not read other app credentials, use desktop Chrome, run Docker or write to an ATS.

Research: Greenhouse v3 cursor pagination and related-resource joins mean row counts alone are insufficient; CSV exports require formula-injection defenses. Datafold's MIT open-source data-diff is archived and is a different SQL workload; no dependency or live database access is needed for bounded canonical synthetic snapshots.
