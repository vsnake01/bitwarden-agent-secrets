# bitwarden-agent-secrets Specification

## Scope

`bitwarden-agent-secrets` is a local CLI broker for agents and automation that:

- stores a Bitwarden access token in user config
- fetches secrets from Bitwarden Secrets Manager only through allowed aliases
- prevents direct Bitwarden API access from the agent
- injects secret values into a command through `env` or a temporary file
- writes local audit records without storing secret values

Not in MVP:

- daemon mode
- GUI
- remote service mode
- multi-user shared deployment
- dynamic credential generation
- secret discovery, list, or search

## Core Concepts

### Profile

A profile defines how the CLI connects to Bitwarden.

Examples:

- `default`
- `prod`
- `staging`

Each profile contains:

- `accessToken`
- `apiUrl`
- `identityUrl`

### Policy

Policy is a local allowlist that defines:

- which aliases exist
- which Bitwarden `secretId` each alias maps to
- whether the alias can be used with `env` or `file`
- which profiles may use that alias

### Alias

An alias is the only secret identifier the agent is allowed to use.

Examples:

- `github_token`
- `prod_ssh_key`

### Runtime Execution

Runtime execution is the process of:

1. loading config
2. loading policy
3. validating alias access
4. fetching the secret from Bitwarden
5. injecting the secret into a child process
6. writing an audit record
7. cleaning up temporary state

## User File Layout

Base directory:

- `~/.config/bitwarden-agent-secrets/`

Files:

- `config.json`
- `policy.json`
- `audit.log`

Permissions:

- directory: `0700`
- `config.json`: `0600`
- `policy.json`: `0600`
- `audit.log`: `0600`

## Config Specification

### File: `config.json`

Purpose:

- stores profiles
- stores default profile
- does not store policy

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

Rules:

- `version` is required
- `defaultProfile` is required
- `profiles` is required
- `accessToken` is required for each profile
- `apiUrl` and `identityUrl` are optional for Bitwarden Cloud

MVP storage model:

- `accessToken` is stored as plain text
- file permissions must be enforced

## Policy Specification

### File: `policy.json`

Purpose:

- defines allowed aliases
- blocks arbitrary secret access

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

Secret object fields:

- `secretId`: Bitwarden secret identifier
- `mode`: `env` or `file`
- `envName`: target environment variable name
- `profiles`: list of profiles allowed to use this alias
- `requiresApproval`: reserved for future approval flow

Policy rules:

- the CLI accepts alias names only
- the CLI must not accept arbitrary `secretId` input for runtime fetch
- list/search/discovery operations are not supported
- alias usage must be rejected if profile is not allowed

Allowlist model:

- allowlist is defined locally in `policy.json`
- allowlist is not auto-generated from all secrets visible to the Bitwarden token
- secret values are fetched on demand only for requested aliases
- `policy` commands may help edit `policy.json`, but they do not dump or cache all secrets

## CLI Contract

### `bitwarden-agent-secrets init`

Purpose:

- initialize local config
- create or update a profile
- create a policy template if missing

Prompts:

- profile name, default `default`
- Bitwarden access token
- optional `apiUrl`
- optional `identityUrl`

Flags:

- `--profile <name>`
- `--access-token-stdin`
- `--api-url <url>`
- `--identity-url <url>`
- `--non-interactive`

Behavior:

- create config directory if missing
- write `config.json`
- ensure correct permissions
- create `policy.json` template if missing

Exit codes:

- `0` success
- `1` runtime/config error
- `2` validation error

### `bitwarden-agent-secrets doctor`

Purpose:

- validate local configuration
- validate Bitwarden connectivity
- validate policy

Checks:

- `config.json` exists
- `defaultProfile` exists
- file permissions are correct
- access token is usable
- Bitwarden API is reachable
- `policy.json` is valid
- all configured aliases reference accessible secrets

Flags:

- `--profile <name>`
- `--json`

Exit codes:

- `0` success
- `1` one or more checks failed

### `bitwarden-agent-secrets profile list`

Purpose:

- show configured profiles
- show default profile

### `bitwarden-agent-secrets profile use <name>`

Purpose:

- switch `defaultProfile`

### `bitwarden-agent-secrets profile add <name>`

Purpose:

- add a new profile

Behavior:

- same credential capture flow as `init`

### `bitwarden-agent-secrets profile remove <name>`

Purpose:

- remove a profile

Rules:

- must reject removing the active default profile unless changed first

### `bitwarden-agent-secrets policy list`

Purpose:

- show configured aliases in the local allowlist

### `bitwarden-agent-secrets policy add <alias> --secret-id <id> --mode <env|file> --env <ENV> --profile <name>`

Purpose:

- add or replace an alias in `policy.json`

Rules:

- alias names are local identifiers
- `--secret-id` is required
- `--mode` must be `env` or `file`
- `--env` is required
- at least one `--profile` is required
- `--requires-approval` is optional

### `bitwarden-agent-secrets policy remove <alias>`

Purpose:

- remove an alias from `policy.json`

### `bitwarden-agent-secrets policy validate`

Purpose:

- validate schema and local consistency of `policy.json`

Checks:

- alias entries contain `secretId`
- alias entries contain valid `mode`
- alias entries contain `envName`
- alias entries contain one or more `profiles`

### `bitwarden-agent-secrets exec --map <alias:ENV> -- <command...>`

Purpose:

- fetch one or more secrets
- inject them as environment variables into a child process

Example:

```bash
bitwarden-agent-secrets exec --map github_token:GITHUB_TOKEN -- gh auth status
```

Rules:

- multiple `--map` flags are allowed
- each alias must exist in policy
- each alias must have `mode=env`
- the selected profile must be allowed by policy
- the child process receives the mapped environment variables only for that execution

Exit codes:

- child process exit code when command launches successfully
- `64` usage error
- `65` policy violation
- `66` secret fetch error

### `bitwarden-agent-secrets file --mount <alias:ENV> -- <command...>`

Purpose:

- fetch one or more secrets
- write them to temporary files
- inject temp file paths into a child process

Example:

```bash
bitwarden-agent-secrets file --mount prod_ssh_key:SSH_KEY_FILE -- ssh -i "$SSH_KEY_FILE" user@host
```

Rules:

- multiple `--mount` flags are allowed
- each alias must exist in policy
- each alias must have `mode=file`
- temporary files must be created with `0600`
- temporary files must be removed after execution

### `bitwarden-agent-secrets reveal <alias>`

Purpose:

- print a secret directly to stdout

Status:

- optional
- considered unsafe
- should be disabled by default

Rules:

- only allowed if `allowReveal=true`
- should require an explicit `--unsafe` flag in implementation

### `bitwarden-agent-secrets audit tail`

Purpose:

- read local audit records

## Runtime Behavior

### `exec`

Execution flow:

1. load `config.json`
2. select the active profile
3. load `policy.json`
4. validate aliases
5. fetch secret values from Bitwarden
6. construct child process environment
7. run command
8. write audit record
9. exit with child process exit code

### `file`

Execution flow:

1. load `config.json`
2. select the active profile
3. load `policy.json`
4. validate aliases
5. fetch secret values from Bitwarden
6. create temporary files with `0600`
7. inject file paths into child process environment
8. run command
9. remove temporary files
10. write audit record

## Audit Logging

Audit file:

- `~/.config/bitwarden-agent-secrets/audit.log`

Format:

- JSON Lines

Example:

```json
{"ts":"2026-04-17T12:30:00Z","profile":"default","alias":"github_token","mode":"env","command":"gh auth status","result":"success","exitCode":0}
{"ts":"2026-04-17T12:31:10Z","profile":"prod","alias":"prod_ssh_key","mode":"file","command":"ssh -i $SSH_KEY_FILE user@host","result":"failure","exitCode":255}
```

Must not log:

- secret values
- access tokens
- full environment values
- temp file contents

## Security Requirements

Required for MVP:

- alias-based access only
- no list/search/discovery commands
- no arbitrary secret id input in runtime commands
- hidden token capture in interactive init flow
- `0600` enforcement for sensitive files
- `0600` enforcement for temporary secret files
- cleanup in `finally`-style execution paths where possible
- no secret values in normal logs or error messages

## Known MVP Limitations

- `accessToken` is stored in plain text in `config.json`
- environment variable injection is not secure against every local inspection path
- child process output may still expose secrets if the child prints them
- `requiresApproval` is metadata only
- no OS keychain integration in MVP

## Suggested Node.js Project Layout

```text
bitwarden-agent-secrets/
  package.json
  tsconfig.json
  README.md
  SPEC.md
  src/
    cli.ts
    commands/
      init.ts
      doctor.ts
      exec.ts
      file.ts
      policy-add.ts
      policy-list.ts
      policy-remove.ts
      policy-validate.ts
      reveal.ts
      profile-list.ts
      profile-add.ts
      profile-use.ts
      profile-remove.ts
      audit-tail.ts
    config/
      paths.ts
      load-config.ts
      save-config.ts
      load-policy.ts
    bitwarden/
      client.ts
      auth.ts
      secrets.ts
    runtime/
      run-env.ts
      run-file.ts
      temp-file.ts
    audit/
      logger.ts
    security/
      permissions.ts
      redact.ts
    schemas/
      config-schema.ts
      policy-schema.ts
    errors/
      cli-error.ts
```

## MVP User Flows

### First-time setup

```bash
bitwarden-agent-secrets init
bitwarden-agent-secrets doctor
```

### Run a command with an API token

```bash
bitwarden-agent-secrets exec --map github_token:GITHUB_TOKEN -- gh auth status
```

### Run a command with a temporary SSH key file

```bash
bitwarden-agent-secrets file --mount prod_ssh_key:SSH_KEY_FILE -- ssh -i "$SSH_KEY_FILE" user@host
```

## Post-MVP

- OS keychain backend for access tokens
- approval flow for `requiresApproval`
- output masking
- shell completions
- policy import/export helpers
- stricter command-level policy controls
- profile override flags on all runtime commands
