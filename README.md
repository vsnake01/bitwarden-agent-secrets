# bitwarden-agent-secrets

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

1. Loads a local user config with a Bitwarden access token
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

This creates a user config directory and stores your Bitwarden access token.

Default paths:

- config directory: `~/.config/bitwarden-agent-secrets/`
- config file: `~/.config/bitwarden-agent-secrets/config.json`
- policy file: `~/.config/bitwarden-agent-secrets/policy.json`
- audit log: `~/.config/bitwarden-agent-secrets/audit.log`

Permissions:

- config directory: `0700`
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
      "accessToken": "BWS_ACCESS_TOKEN_HERE",
      "apiUrl": "https://api.bitwarden.com",
      "identityUrl": "https://identity.bitwarden.com"
    }
  }
}
```

Notes:

- `accessToken` is required
- `apiUrl` and `identityUrl` may be omitted for Bitwarden Cloud
- multiple profiles are supported
- the access token is stored in plain text in MVP, so file permissions matter

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
- writes the secret to a temporary file with `0600`
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
- Bitwarden connectivity
- policy validity
- secret accessibility for configured aliases

### Manage profiles

```bash
bitwarden-agent-secrets profile list
bitwarden-agent-secrets profile add prod
bitwarden-agent-secrets profile use prod
bitwarden-agent-secrets profile remove staging
```

## CLI Reference

### `init`

Initialize config and create a profile.

```bash
bitwarden-agent-secrets init
```

Supported behavior:

- creates config directory
- stores a Bitwarden access token
- creates a config profile
- creates a policy template if missing

Planned flags:

```bash
bitwarden-agent-secrets init --profile default
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
```

### `reveal`

Unsafe direct output of a secret.

```bash
bitwarden-agent-secrets reveal github_token
```

This command should be considered disabled by default and only allowed when explicitly enabled in policy.

### `audit tail`

Show local audit records.

```bash
bitwarden-agent-secrets audit tail
```

## Security Model

`bitwarden-agent-secrets` is a local broker, not a vault replacement.

Security depends on:

- keeping the Bitwarden access token protected
- limiting access through `policy.json`
- using least privilege in Bitwarden
- avoiding broad tokens with access to everything

### Recommended practices

- use a dedicated Bitwarden machine account for this tool
- scope access only to the secrets actually needed
- separate profiles for `dev`, `staging`, and `prod`
- keep `policy.json` small and explicit
- prefer `exec` and `file` over printing secrets
- rotate tokens and secrets regularly
- use different Bitwarden access tokens for different trust zones

### What this tool deliberately does not support

- secret listing
- secret search
- raw Bitwarden pass-through
- arbitrary fetch by user-supplied secret id

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

- the Bitwarden access token is stored in plain text in `config.json`
- environment-variable injection is not safe against every local inspection vector
- child process output is not guaranteed to be secret-safe
- `requiresApproval` is metadata only in MVP
- no OS keychain integration yet

## Roadmap

Post-MVP work:

- OS keychain integration for access tokens
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
