# Security Model

`bitwarden-agent-secrets` is a local broker for one machine and one user context. It is not a vault replacement, a sandbox, or a general-purpose secret proxy.

## What This Tool Defends Against

- A local agent or script trying to fetch arbitrary Bitwarden secrets outside the configured alias allowlist
- Accidental secret persistence in repo files, shell history, or ad hoc config files
- Giving the agent direct Bitwarden API credentials when it only needs a small subset of secrets
- Unbounded profile access when aliases are restricted to specific profiles
- Accidental use of an alias from the wrong child command when `allowedCommands` is configured

## What This Tool Does Not Defend Against

- A malicious or compromised child command exfiltrating a secret it has been explicitly granted
- Local inspection by the same OS user, including `/proc/<pid>/environ`, ptrace, or shell history outside this tool
- Memory dumps, swap inspection, filesystem forensics, or a compromised workstation
- Supply-chain compromise in Node.js, the Bitwarden SDK, or platform credential tooling
- Keystroke logging, screen capture, or shell/session compromise

## Security Boundaries

The policy allowlist limits which secrets may be fetched. It does not control what the child process does with the secret after injection.

`allowedCommands` reduces accidental misuse and blocks obvious mismatches such as granting a GitHub token to `curl`, but it is still not a sandbox:

- if `allowedCommands` is omitted, any child command is allowed
- if you allow `sh`, `bash`, `zsh`, `python`, `node`, or similar interpreters, that alias effectively allows arbitrary execution

## Storage Model

- Profile metadata lives in `config.json`
- Policy lives in `policy.json`
- File-backed Bitwarden access tokens live under `~/.config/bitwarden-agent-secrets/credentials/`
- Audit records live in `audit.log`
- Bitwarden SDK state and runtime temp files live under `~/.local/state/bitwarden-agent-secrets/`

Expected permissions:

- config dir: `0700`
- state dir: `0700`
- config file: `0600`
- policy file: `0600`
- audit log: `0600`
- file-backed credentials: `0600`
- temporary secret files: `0600`

## Current Security Controls

- Alias-only secret resolution
- Profile-restricted alias usage
- `env` and `file` delivery modes
- Best-effort private runtime temp directories
- Local audit records without secret values
- `doctor` checks for permissions, profile integrity, credential readability, Bitwarden auth, and alias fetchability
- Optional per-alias `allowedCommands`

## Current Gaps

- `requiresApproval` is stored in policy but not enforced yet
- Child stdout/stderr is not redacted
- Temporary file cleanup is best-effort, not cryptographic wipe
- Environment variables remain observable to the child process by design

## Recommended Hardening

- Use a dedicated Bitwarden machine account for this tool
- Keep the policy small and explicit
- Prefer `allowedCommands` for high-value aliases
- Do not allow shells or interpreters in `allowedCommands` unless you truly mean “any code”
- Prefer `file` mode for tools that accept file inputs cleanly
- Run untrusted agents inside an additional sandbox such as a container or `bubblewrap`
- Separate profiles and Bitwarden tokens by trust zone, such as `dev` and `prod`

## Reporting a Vulnerability

If you find a security issue, do not open a public issue with exploit details.

- Open a private security advisory on GitHub if available
- Or contact the maintainer directly with affected version, impact, reproduction steps, and a suggested mitigation if known
