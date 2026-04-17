# bitwarden-agent-secrets

[![CI](https://github.com/vsnake01/bitwarden-agent-secrets/actions/workflows/ci.yml/badge.svg)](https://github.com/vsnake01/bitwarden-agent-secrets/actions/workflows/ci.yml)
[![CodeQL](https://github.com/vsnake01/bitwarden-agent-secrets/actions/workflows/codeql.yml/badge.svg)](https://github.com/vsnake01/bitwarden-agent-secrets/actions/workflows/codeql.yml)
[![Dependency Audit](https://github.com/vsnake01/bitwarden-agent-secrets/actions/workflows/dependency-audit.yml/badge.svg)](https://github.com/vsnake01/bitwarden-agent-secrets/actions/workflows/dependency-audit.yml)
[![Gitleaks](https://github.com/vsnake01/bitwarden-agent-secrets/actions/workflows/gitleaks.yml/badge.svg)](https://github.com/vsnake01/bitwarden-agent-secrets/actions/workflows/gitleaks.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/vsnake01/bitwarden-agent-secrets/badge)](https://scorecard.dev/viewer/?uri=github.com/vsnake01/bitwarden-agent-secrets)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-node__test-5A67D8)](https://github.com/vsnake01/bitwarden-agent-secrets/actions/workflows/ci.yml)

A local CLI broker for agents and automation that retrieves secrets from Bitwarden Secrets Manager through a controlled allowlist.

Instead of giving an agent direct access to Bitwarden, `bitwarden-agent-secrets` exposes only predefined aliases from a local policy file and injects secret values into a command at runtime.

## Why

Agents and automation often need credentials for:

- APIs
- SSH access
- login/password flows
- deployment tooling

Storing those secrets in local files, repo configs, or agent-specific state is a bad default. `bitwarden-agent-secrets` keeps secrets in Bitwarden Secrets Manager and only exposes them on demand through a local CLI.

## Goals

- Keep secrets in Bitwarden Secrets Manager
- Prevent arbitrary secret lookup by an agent
- Allow access only through local aliases defined in policy
- Inject secrets into a process through environment variables or temporary files
- Avoid storing secrets in project files or shell history
- Keep a local audit trail without logging secret values

## Security Signals

- CI, CodeQL, dependency audit, and secret scanning run in GitHub Actions
- OpenSSF Scorecard publishes a repository security posture score
- Dependabot is configured for npm packages and GitHub Actions
- GitHub Actions are pinned to immutable commit SHAs
- `CODEOWNERS` is present for review enforcement
- Release artifacts are built with provenance attestations in GitHub Actions
- OWASP ASVS is treated as guidance, not as a formal certification target for this CLI package

More details are documented in [SECURITY.md](SECURITY.md).

## Non-goals

- Direct Bitwarden access for the agent
- Secret discovery, listing, or searching
- Shared multi-user daemon mode
- Remote secret broker service
- Dynamic credential generation
- Full secret masking of all child process output

## Installation

```bash
npm install -g @your-scope/bitwarden-agent-secrets
```

Or run it locally inside another project:

```bash
npm install @your-scope/bitwarden-agent-secrets
```

## Requirements

- Node.js 20+
- A Bitwarden Secrets Manager machine account access token
- Access to the target Bitwarden secrets you want to expose

## How It Works

The trust boundary is:

```text
agent -> bitwarden-agent-secrets -> Bitwarden Secrets Manager
```

The agent never receives direct Bitwarden API credentials.

The CLI:

1. Loads a local user config with a credential store reference
2. Loads a local policy file with allowed secret aliases
3. Resolves an alias to a specific Bitwarden `secretId`
4. Fetches the secret from Bitwarden
5. Injects it into a child process through:
   - an environment variable
   - or a temporary file
6. Writes an audit record without logging the secret value

## First-Time Setup

Run:

```bash
bitwarden-agent-secrets init
```

This creates a user config directory and stores your Bitwarden access token in a credential backend.

Default paths:

- config directory: `~/.config/bitwarden-agent-secrets/`
- state directory: `~/.local/state/bitwarden-agent-secrets/`
- config file: `~/.config/bitwarden-agent-secrets/config.json`
- credential file fallback dir: `~/.config/bitwarden-agent-secrets/credentials/`
- policy file: `~/.config/bitwarden-agent-secrets/policy.json`
- audit log: `~/.config/bitwarden-agent-secrets/audit.log`
- Bitwarden SDK state dir: `~/.local/state/bitwarden-agent-secrets/bitwarden/`
- runtime temp root: `~/.local/state/bitwarden-agent-secrets/tmp/`

Permissions:

- config directory: `0700`
- state directory: `0700`
- config file: `0600`
- policy file: `0600`
- audit log: `0600`

After setup, run:

```bash
bitwarden-agent-secrets doctor
```

## Configuration

### `config.json`

`config.json` stores connection profiles for Bitwarden.

Example:

```json
{
  "version": 1,
  "defaultProfile": "default",
  "profiles": {
    "default": {
      "apiUrl": "https://api.bitwarden.com",
      "identityUrl": "https://identity.bitwarden.com",
      "credentialStore": {
        "type": "keychain",
        "service": "bitwarden-agent-secrets",
        "account": "default"
      }
    }
  }
}
```

Notes:

- `credentialStore` is required
- `apiUrl` and `identityUrl` may be omitted for Bitwarden Cloud
- multiple profiles are supported
- `type=keychain` is preferred on macOS and Linux developer machines
- `type=file` is an explicit fallback and stores the token in a `0600` file under `~/.config/bitwarden-agent-secrets/credentials/`

Supported credential backends:

- macOS: system Keychain via `security`
- Linux: Secret Service / GNOME Keyring via `secret-tool`
- fallback: local file backend with `0600` permissions

At runtime, the tool uses the official Bitwarden Secrets Manager Node SDK and keeps per-profile SDK state files under `~/.local/state/bitwarden-agent-secrets/bitwarden/`.

### `policy.json`

`policy.json` defines which aliases are allowed.

Example:

```json
{
  "version": 1,
  "allowReveal": false,
  "secrets": {
    "github_token": {
      "secretId": "382580ab-1368-4e85-bfa3-b02e01400c9f",
      "mode": "env",
      "envName": "GITHUB_TOKEN",
      "profiles": ["default"],
      "requiresApproval": false
    },
    "prod_ssh_key": {
      "secretId": "be8e0ad8-d545-4017-a55a-b02f014d4158",
      "mode": "file",
      "envName": "SSH_KEY_FILE",
      "profiles": ["prod"],
      "requiresApproval": true
    }
  }
}
```

Important rules:

- only aliases from `policy.json` can be used
- direct arbitrary `secretId` lookup is not allowed
- list/search/discovery is not supported
- `mode=env` is for runtime environment injection
- `mode=file` is for temporary file injection

### Policy Management

In MVP, the allowlist lives in `policy.json`. You can either edit it directly or use CLI helpers.

List configured aliases:

```bash
bitwarden-agent-secrets policy list
```

Add a new alias:

```bash
bitwarden-agent-secrets policy add github_token \
  --secret-id 382580ab-1368-4e85-bfa3-b02e01400c9f \
  --mode env \
  --env GITHUB_TOKEN \
  --profile default
```

Add a file-based alias:

```bash
bitwarden-agent-secrets policy add prod_ssh_key \
  --secret-id be8e0ad8-d545-4017-a55a-b02f014d4158 \
  --mode file \
  --env SSH_KEY_FILE \
  --profile prod \
  --requires-approval
```

Remove an alias:

```bash
bitwarden-agent-secrets policy remove github_token
```

Validate `policy.json`:

```bash
bitwarden-agent-secrets policy validate
```

## Usage

### Inject a secret as an environment variable

```bash
bitwarden-agent-secrets exec --map github_token:GITHUB_TOKEN -- gh auth status
```

This flow:

- resolves `github_token`
- fetches its value from Bitwarden
- starts `gh auth status` with `GITHUB_TOKEN` set only for that process

### Inject a secret as a temporary file

```bash
bitwarden-agent-secrets file --mount prod_ssh_key:SSH_KEY_FILE -- ssh -i "$SSH_KEY_FILE" user@host
```

This flow:

- resolves `prod_ssh_key`
- writes the secret to a temporary file with `0600` inside a user-private runtime directory
- starts the command with `SSH_KEY_FILE=/path/to/tempfile`
- deletes the temp file after execution

### Validate your local setup

```bash
bitwarden-agent-secrets doctor
```

Checks include:

- config presence
- file permissions
- profile validity
- credential backend readability
- Bitwarden connectivity
- policy validity
- secret accessibility for configured aliases

### Manage profiles

```bash
bitwarden-agent-secrets profile list
bitwarden-agent-secrets profile add prod --credential-store keychain
bitwarden-agent-secrets profile rotate-token prod --access-token-stdin
bitwarden-agent-secrets profile use prod
bitwarden-agent-secrets profile remove staging
```

### Manage policy allowlist

```bash
bitwarden-agent-secrets policy list
bitwarden-agent-secrets policy add github_token --secret-id <id> --mode env --env GITHUB_TOKEN --profile default
bitwarden-agent-secrets policy remove github_token
bitwarden-agent-secrets policy validate
```

## CLI Reference

### `init`

Initialize config and create a profile.

```bash
bitwarden-agent-secrets init
```

Supported behavior:

- creates config directory
- stores a Bitwarden access token in the selected credential backend
- creates a config profile
- creates a policy template if missing

Planned flags:

```bash
bitwarden-agent-secrets init --profile default
bitwarden-agent-secrets init --credential-store keychain
bitwarden-agent-secrets init --credential-store file
bitwarden-agent-secrets init --access-token-stdin
bitwarden-agent-secrets init --api-url https://api.bitwarden.example.com
bitwarden-agent-secrets init --identity-url https://identity.bitwarden.example.com
bitwarden-agent-secrets init --non-interactive
```

### `doctor`

Validate local state and connectivity.

```bash
bitwarden-agent-secrets doctor
```

Planned flags:

```bash
bitwarden-agent-secrets doctor --profile prod
bitwarden-agent-secrets doctor --json
```

### `exec`

Inject one or more secrets as environment variables into a command.

```bash
bitwarden-agent-secrets exec --map github_token:GITHUB_TOKEN -- gh auth status
bitwarden-agent-secrets exec --profile prod --map deploy_token:DEPLOY_TOKEN -- your-command
```

Multiple mappings are allowed:

```bash
bitwarden-agent-secrets exec \
  --map api_user:API_USER \
  --map api_pass:API_PASS \
  -- your-command
```

### `file`

Inject one or more secrets as temporary files.

```bash
bitwarden-agent-secrets file --mount prod_ssh_key:SSH_KEY_FILE -- ssh -i "$SSH_KEY_FILE" user@host
bitwarden-agent-secrets file --profile prod --mount prod_ssh_key:SSH_KEY_FILE -- ssh -i "$SSH_KEY_FILE" user@host
```

### `profile rotate-token`

Rotate or migrate the stored Bitwarden access token for an existing profile.

```bash
bitwarden-agent-secrets profile rotate-token prod --access-token-stdin
bitwarden-agent-secrets profile rotate-token prod --credential-store file --access-token-stdin
```

This command can also migrate a profile between `keychain` and `file` storage.

### `reveal`

Unsafe direct output of a secret.

```bash
bitwarden-agent-secrets reveal github_token
```

This command should be considered disabled by default and only allowed when explicitly enabled in policy.

### `policy list`

Show configured allowlist aliases.

```bash
bitwarden-agent-secrets policy list
```

### `policy add`

Add or replace a policy alias.

```bash
bitwarden-agent-secrets policy add github_token \
  --secret-id 382580ab-1368-4e85-bfa3-b02e01400c9f \
  --mode env \
  --env GITHUB_TOKEN \
  --profile default
```

Flags:

- `--secret-id <id>`
- `--mode <env|file>`
- `--env <ENV>`
- `--profile <name>` repeatable
- `--requires-approval`

### `policy remove`

Remove a policy alias.

```bash
bitwarden-agent-secrets policy remove github_token
```

### `policy validate`

Validate the local policy file.

```bash
bitwarden-agent-secrets policy validate
```

### `audit tail`

Show local audit records.

```bash
bitwarden-agent-secrets audit tail
```

## Security Model

`bitwarden-agent-secrets` is a local broker, not a vault replacement.

Security depends on:

- keeping the Bitwarden access token protected in the selected credential backend
- limiting access through `policy.json`
- using least privilege in Bitwarden
- avoiding broad tokens with access to everything

### Recommended practices

- use a dedicated Bitwarden machine account for this tool
- scope access only to the secrets actually needed
- separate profiles for `dev`, `staging`, and `prod`
- prefer `keychain` over `file`
- keep `policy.json` small and explicit
- prefer `exec` and `file` over printing secrets
- rotate tokens and secrets regularly
- use different Bitwarden access tokens for different trust zones

### What this tool deliberately does not support

- secret listing
- secret search
- raw Bitwarden pass-through
- arbitrary fetch by user-supplied secret id

The `policy` commands only manage the local alias allowlist. They do not enumerate or import every secret available to the Bitwarden token.

## Audit Logging

Audit records are written to:

```text
~/.config/bitwarden-agent-secrets/audit.log
```

Format: JSON Lines

Example:

```json
{"ts":"2026-04-17T12:30:00Z","profile":"default","alias":"github_token","mode":"env","command":"gh auth status","result":"success","exitCode":0}
{"ts":"2026-04-17T12:31:10Z","profile":"prod","alias":"prod_ssh_key","mode":"file","command":"ssh -i $SSH_KEY_FILE user@host","result":"failure","exitCode":255}
```

Audit records do not include:

- secret values
- access tokens
- full environment contents
- temporary file contents

Temporary secret files are created only inside the user-owned runtime directory under `~/.local/state/bitwarden-agent-secrets/tmp/`, not in the shared system temp directory.

## Exit Codes

Planned exit codes:

- `0`: success
- `1`: runtime or configuration error
- `2`: validation error
- `64`: CLI usage error
- `65`: policy violation
- `66`: secret fetch error

When running `exec` or `file`, the CLI should normally return the child process exit code if command launch succeeded.

## Limitations

Current MVP limitations:

- `keychain` depends on platform-native tooling being available
- environment-variable injection is not safe against every local inspection vector
- child process output is not guaranteed to be secret-safe
- `requiresApproval` is metadata only in MVP
- `file` backend still stores the token in plain text, protected only by filesystem permissions
- temporary secret files are best-effort cleaned up, but no file deletion scheme can guarantee wipe semantics on every filesystem

## Roadmap

Post-MVP work:

- better interactive fallback behavior when secure credential storage is unavailable
- approval flow for sensitive aliases
- output masking
- shell completions
- import/export helpers for policy
- stricter command policy controls
- profile override on every runtime command

## Development Status

This project is currently in specification/MVP design stage.

## License

TBD
