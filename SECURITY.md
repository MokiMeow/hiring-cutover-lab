# Security policy

This project is a local release candidate. A passing test suite is not production certification. Read the documented deployment and data boundaries before handling real organizational data.

## Reporting a vulnerability

Use this repository's **Security > Report a vulnerability** form for a private report. Include the affected commit, a minimal invented reproduction, the impact and any proposed mitigation. Do not include live API keys, session cookies, candidate records or private assessment content.

If the private reporting form is unavailable, do not publish exploit details in an issue. Ask the maintainer for a private reporting route through the contact information on their GitHub profile.

## Scope and handling

- Keep demos and tests synthetic. Never send real invitations as a test without the account owner's explicit authorization.
- Keep credentials in the deployment's secret manager or process environment. The application does not load `.env` files.
- Restrict database and backup access. SQLite files contain sensitive data when real records are used.
- Report stale or missing verification evidence. Do not remove findings or weaken checks to obtain a green result.

The vendored stylesheet and optional scanner rules retain their own license notices. Dependency advisories and static analysis cover known patterns, not every vulnerability.
