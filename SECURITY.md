# Security Policy

## Supported Versions

This project is currently maintained as a single active branch:

- `main`

Security fixes, if provided, will be made against the latest state of `main`.

## Reporting a Vulnerability

Please do **not** open a public GitHub issue for security-sensitive problems.

If you discover a vulnerability, report it privately with:

- a clear description of the issue
- reproduction steps
- affected files or endpoints
- impact assessment if known
- any suggested mitigation

Until a dedicated security contact is added, the recommended path is:

1. Open a private channel if one is available through GitHub security reporting.
2. If private reporting is not available, contact the maintainer directly before any public disclosure.

## Scope

Examples of issues that should be reported privately:

- leaked or mis-scoped API keys
- server/client secret exposure
- unsafe command execution
- injection vulnerabilities
- privilege or access-control issues
- dependency vulnerabilities with practical impact

Examples of issues that usually do **not** need private disclosure:

- typo fixes
- documentation mistakes
- UI polish bugs with no security impact
- non-sensitive validation bugs

## Handling Secrets

This repository expects local secrets to stay out of version control.

Follow these rules:

- never commit `.env.local`, `.env`, or production credentials
- use separate Google browser and server keys
- restrict browser keys by HTTP referrer
- restrict server keys by API scope and environment
- rotate keys immediately if you suspect exposure

## Disclosure Expectations

Please allow reasonable time to investigate and remediate reported issues before public disclosure.
