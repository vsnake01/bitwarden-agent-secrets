# bitwarden-agent-secrets

A local CLI broker for agents and automation that retrieves secrets from Bitwarden Secrets Manager through an explicit local allowlist.

`bitwarden-agent-secrets` is designed for one machine, one user account, and one clear trust boundary:

```text
agent or script -> bitwarden-agent-secrets -> Bitwarden Secrets Manager
```

The agent never gets direct Bitwarden API credentials. It only gets the specific aliases your local policy allows for one command execution.

## Goals

- Keep secrets in Bitwarden Secrets Manager
- Prevent arbitrary secret lookup by local agents or scripts
- Inject secrets only at command runtime
- Support environment-variable and temporary-file delivery
- Keep a local audit trail without logging secret values
- Build local policy from Bitwarden secret names without reading secret values

## Non-goals

- CI secret orchestration
- Remote broker or daemon mode
- Shared multi-user service
- Secret value reveal, search, or discovery at runtime
- Full masking of child process output

## Installation

```bash
npm install -g bitwarden-agent-secrets
```

Or inside another local project:

```bash
npm install bitwarden-agent-secrets
```

The package exposes both command names:

```bash
bitwarden-agent-secrets --help
bas --help
```

## Requirements

- Node.js 20+
- A Bitwarden Secrets Manager machine account access token
- Access to the Bitwarden secrets you want to expose locally

## First-Time Setup

Initialize the default profile:

```bash
bitwarden-agent-secrets init --credential-store keychain --organization-id <bitwarden-organization-id>
```

If no `BWS_ACCESS_TOKEN` is present and the command is running in a terminal, `init`
prompts for the Bitwarden Secrets Manager machine account token without echoing it.
You can request that explicitly:

```bash
bitwarden-agent-secrets init \
  --credential-store keychain \
  --organization-id <bitwarden-organization-id> \
  --access-token-prompt
```

For automation, pass the token through stdin:

```bash
printf '%s' "$BWS_ACCESS_TOKEN" | \
  bitwarden-agent-secrets init \
    --credential-store keychain \
    --organization-id <bitwarden-organization-id> \
    --access-token-stdin
```

Initialize another profile without changing the default:

```bash
bitwarden-agent-secrets init --profile prod --credential-store file
```

Change the default profile explicitly:

```bash
bitwarden-agent-secrets init --profile prod --credential-store file --set-default
```

Then validate the local installation:

```bash
bitwarden-agent-secrets doctor
bitwarden-agent-secrets doctor --json
```

## Local Files

Default paths:

- config dir: `~/.config/bitwarden-agent-secrets/`
- state dir: `~/.local/state/bitwarden-agent-secrets/`
- config: `~/.config/bitwarden-agent-secrets/config.json`
- policy: `~/.config/bitwarden-agent-secrets/policy.json`
- audit log: `~/.config/bitwarden-agent-secrets/audit.log`
- file-backend credentials: `~/.config/bitwarden-agent-secrets/credentials/`
- Bitwarden SDK state: `~/.local/state/bitwarden-agent-secrets/bitwarden/`
- runtime temp files: `~/.local/state/bitwarden-agent-secrets/tmp/`

Expected permissions:

- config dir: `0700`
- state dir: `0700`
- config file: `0600`
- policy file: `0600`
- audit log: `0600`

## Configuration

### `config.json`

`config.json` stores connection profiles and the default profile.

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

Supported credential backends:

- macOS: system Keychain via `security`
- Linux: Secret Service / GNOME Keyring via `secret-tool`
- fallback: local file backend with `0600` permissions

### `policy.json`

`policy.json` defines the only aliases the broker may expose.

```json
{
  "version": 2,
  "secrets": {
    "github_token": {
      "secretId": "bw-secret-id-github-token",
      "mode": "env",
      "envName": "GITHUB_TOKEN",
      "profiles": ["default"],
      "requiresApproval": false,
      "allowedCommands": ["gh", "git"]
    },
    "prod_ssh_key": {
      "secretId": "bw-secret-id-prod-ssh-key",
      "mode": "file",
      "envName": "SSH_KEY_FILE",
      "profiles": ["prod"],
      "requiresApproval": true,
      "allowedCommands": ["ssh"]
    }
  }
}
```

Notes:

- `requiresApproval` is stored but not enforced yet
- `allowedCommands` is optional
- if `allowedCommands` is omitted, any child command is allowed
- if `allowedCommands` includes shells or interpreters such as `sh`, `bash`, `python`, or `node`, that alias effectively allows arbitrary execution

## Usage

### Environment-variable injection

```bash
bitwarden-agent-secrets exec --map github_token:GITHUB_TOKEN -- gh auth status
```

### Temporary-file injection

```bash
bitwarden-agent-secrets file --mount prod_ssh_key:SSH_KEY_FILE -- sh -c 'ssh -i "$SSH_KEY_FILE" user@host'
```

Shell expansion caveat:

- `"$SSH_KEY_FILE"` is expanded by your current shell before the broker runs
- if you want the injected file path to be expanded inside the child process, wrap the child command with `sh -c '...'`
- tools that read the path from an environment variable themselves do not need this wrapper

### Policy management

List aliases:

```bash
bitwarden-agent-secrets policy list
```

Add an env alias:

```bash
bitwarden-agent-secrets policy add github_token \
  --secret-id 382580ab-1368-4e85-bfa3-b02e01400c9f \
  --mode env \
  --env GITHUB_TOKEN \
  --profile default \
  --allowed-command gh \
  --allowed-command git
```

Add a file alias:

```bash
bitwarden-agent-secrets policy add prod_ssh_key \
  --secret-id be8e0ad8-d545-4017-a55a-b02f014d4158 \
  --mode file \
  --env SSH_KEY_FILE \
  --profile prod \
  --allowed-command ssh
```

Validate policy:

```bash
bitwarden-agent-secrets policy validate
```

Build or update policy from Bitwarden secret names:

```bash
bitwarden-agent-secrets policy setup \
  --profile default \
  --organization-id <bitwarden-organization-id> \
  --select GITHUB_TOKEN,SENTRY_AUTH_TOKEN \
  --allow github_token:gh,git \
  --allow sentry_auth_token:sentry-cli,curl \
  --dry-run
```

Or use the interactive terminal UI:

```bash
bitwarden-agent-secrets policy setup --profile default --interactive
```

The setup UI shows Bitwarden secrets as checkboxes, then lets you choose allowed
commands from checkbox presets and add extra command names as a comma-separated list.
If the active profile has no organization id and `--organization-id` was not passed,
interactive setup asks for the Bitwarden organization id. It then prints the review
plan and asks `Apply this policy? [y/N]` before writing.

Preview the interactive plan without writing:

```bash
bitwarden-agent-secrets policy setup --profile default --interactive --dry-run
```

Apply a reviewed non-interactive plan:

```bash
bitwarden-agent-secrets policy setup \
  --profile default \
  --organization-id <bitwarden-organization-id> \
  --select GITHUB_TOKEN,SENTRY_AUTH_TOKEN \
  --allow github_token:gh,git \
  --allow sentry_auth_token:sentry-cli,curl \
  --apply --yes
```

`policy setup` lists Bitwarden secret metadata to resolve names to IDs. It does not fetch secret values.
If the profile was initialized with `--organization-id`, you can omit `--organization-id`
from later `policy setup` runs.
It writes a human-editable source file at:

```text
~/.config/bitwarden-agent-secrets/policy.sources/<profile>.json
```

The compiled runtime allowlist remains:

```text
~/.config/bitwarden-agent-secrets/policy.json
```

## Agent Skill

This repository ships an optional Codex/agent skill at:

```text
.agents/skills/bitwarden-agent-secrets/SKILL.md
```

The skill teaches agents to use BAS safely:

- discover allowed aliases with `bas policy list`
- validate local setup with `bas doctor --skip-secrets`
- run commands through `bas exec` or `bas file`
- avoid reading, printing, copying, or storing secret values
- avoid changing policy/profile/init state unless the user explicitly asks for admin setup

Install the skill from a cloned repository:

```bash
mkdir -p ~/.agents/skills
cp -R .agents/skills/bitwarden-agent-secrets ~/.agents/skills/
```

Install the skill from a global npm install:

```bash
mkdir -p ~/.agents/skills
cp -R "$(npm root -g)/bitwarden-agent-secrets/.agents/skills/bitwarden-agent-secrets" ~/.agents/skills/
```

After installation, an agent can be asked to use BAS without receiving raw secrets. Example prompts:

```text
Use BAS to check the latest GitHub Actions run for this repository.
```

```text
Use BAS and the Portainer alias to list Portainer endpoints.
```

Safe command patterns the skill directs agents to use:

```bash
bas policy list
bas doctor --skip-secrets
bas exec --map admin_github_api_token:GH_TOKEN -- gh run list --limit 1
bas exec --map portainer_api_token_crm:PORTAINER_API_TOKEN -- curl -sS -H "X-API-Key: $PORTAINER_API_TOKEN" https://portainer.example.com/api/endpoints
```

The skill intentionally does not contain secret IDs, tokens, or a copy of your local policy. Local policy remains the source of truth.

## `doctor`

`doctor` validates local state and Bitwarden reachability for one profile.

Current checks include:

- config and policy file presence
- file and directory permissions
- `defaultProfile` integrity
- credential store readability
- Bitwarden authentication
- alias fetchability for aliases allowed on the selected profile

Useful forms:

```bash
bitwarden-agent-secrets doctor
bitwarden-agent-secrets doctor --profile prod
bitwarden-agent-secrets doctor --json
bitwarden-agent-secrets doctor --skip-secrets
```

## Audit Log

Audit records are written as JSON Lines to:

```text
~/.config/bitwarden-agent-secrets/audit.log
```

Example:

```json
{"ts":"2026-04-20T10:20:00Z","profile":"default","alias":"github_token","aliases":["github_token"],"mode":"env","command":"gh auth status","result":"success","exitCode":0,"allowedCommand":"pass"}
{"ts":"2026-04-20T10:21:00Z","profile":"default","alias":"github_token","aliases":["github_token"],"mode":"env","command":"curl https://example.com","result":"policy_violation","exitCode":65,"errorKind":"CliError","allowedCommand":"fail"}
```

The audit log does not include:

- secret values
- Bitwarden access tokens
- full environment contents
- temporary file contents

## Security Model

This tool narrows secret scope. It does not sandbox the child process.

It is good at:

- preventing arbitrary secret lookup outside the local allowlist
- keeping Bitwarden access tokens out of the agent's normal runtime
- limiting which profiles and aliases can be used
- reducing plaintext secret persistence on disk

It does not defend against:

- a child command that exfiltrates a secret it has been explicitly granted
- local same-user inspection of process state such as `/proc/<pid>/environ`
- memory dumps, swap inspection, or a compromised shell

For the full threat model, see [SECURITY.md](./SECURITY.md).

## Limitations

- `requiresApproval` is metadata only today
- `allowedCommands` is a hardening layer, not a sandbox
- `file` credential storage still stores the Bitwarden token in a local `0600` file
- child process output may still expose secrets if the child prints them
- environment-variable delivery is visible to the child process by design

## License

MIT - see [LICENSE](./LICENSE).
