# Security Policy

## Reporting a Vulnerability

If you believe you found a security issue in `bitwarden-agent-secrets`, do not open a public issue with exploit details.

Instead:

- open a private security advisory on GitHub, if available
- or contact the maintainer directly and include:
  - affected version or commit
  - impact
  - reproduction steps
  - proposed mitigation, if known

## Automated Security Checks

This repository is configured to run multiple security-related checks in GitHub Actions:

- `CodeQL` for static analysis and code scanning
- `Dependency Audit` via `npm audit`
- `Gitleaks` for committed secret detection
- `OpenSSF Scorecard` for repository security posture checks
- `Dependabot` for dependency and GitHub Actions update PRs

## Security Scope

This project is a local CLI library/tool, not a web application.

Because of that:

- OWASP ASVS is used as general security guidance, not as a formal compliance claim
- repository and supply-chain checks are emphasized over web-app specific controls
- local secret handling, credential storage, dependency hygiene, and CI integrity are treated as primary concerns

## Security Expectations

The project aims to:

- avoid storing Bitwarden access tokens in plain config by default
- keep secret exposure time and filesystem footprint minimal
- prevent arbitrary secret enumeration outside local allowlist policy
- fail clearly when secure storage or Bitwarden authentication is unavailable
- keep CI-visible security checks green on `main`
