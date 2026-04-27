# bitwarden-agent-secrets Specification

## Product Position

`bitwarden-agent-secrets` is a local CLI broker. It is intentionally built for workstation-local agent and automation use, not for CI orchestration, remote brokering, or multi-user deployment.

## Scope

The tool:

- stores a Bitwarden access token in a selected local credential backend
- resolves only aliases defined in local policy
- fetches secrets from Bitwarden Secrets Manager on demand
- injects secret values into one child process through environment variables or temporary files
- writes local audit records without storing secret values
- can build local policy from Bitwarden secret metadata without reading secret values

The tool does not:

- expose direct Bitwarden API access to the agent
- support secret value listing, search, or discovery at runtime
- run as a daemon or remote service
- act as a sandbox for untrusted child commands

## Data Model

### `config.json`

```json
{
  "version": 1,
  "defaultProfile": "default",
  "profiles": {
    "default": {
        "apiUrl": "https://api.bitwarden.com",
        "identityUrl": "https://identity.bitwarden.com",
        "organizationId": "bitwarden-organization-id",
        "credentialStore": {
        "type": "keychain",
        "service": "bitwarden-agent-secrets",
        "account": "default"
      }
    }
  }
}
```

Rules:

- `defaultProfile` is required
- `profiles` is required
- each profile must define `credentialStore`
- `credentialStore.type` is `keychain` or `file`
- `organizationId` is optional for runtime secret fetches but required for metadata listing in `policy setup`
- `init` must not overwrite `defaultProfile` unless `--set-default` is passed or this is the first config

### `policy.json`

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
    }
  }
}
```

Secret policy fields:

- `secretId`: Bitwarden secret identifier
- `mode`: `env` or `file`
- `envName`: target environment variable name
- `profiles`: allowed profile names
- `requiresApproval`: reserved metadata, not enforced yet
- `allowedCommands`: optional basename allowlist for child commands

Compatibility rule:

- legacy `version: 1` policies with `allowReveal` must still load
- `allowReveal` is ignored

## File Layout

- config dir: `~/.config/bitwarden-agent-secrets/`
- state dir: `~/.local/state/bitwarden-agent-secrets/`
- config: `~/.config/bitwarden-agent-secrets/config.json`
- policy: `~/.config/bitwarden-agent-secrets/policy.json`
- audit log: `~/.config/bitwarden-agent-secrets/audit.log`
- file-backed credentials: `~/.config/bitwarden-agent-secrets/credentials/`
- Bitwarden SDK state: `~/.local/state/bitwarden-agent-secrets/bitwarden/`
- runtime temp files: `~/.local/state/bitwarden-agent-secrets/tmp/`

Expected permissions:

- config dir: `0700`
- state dir: `0700`
- config file: `0600`
- policy file: `0600`
- audit log: `0600`
- file-backed credentials: `0600`
- temp files: `0600`

## CLI Contract

### `init`

Purpose:

- create or update one profile
- store the access token in the selected backend
- create a policy template if missing

Flags:

- `--profile <name>`
- `--credential-store <keychain|file>`
- `--access-token-stdin`
- `--access-token-prompt`
- `--organization-id <id>`
- `--api-url <url>`
- `--identity-url <url>`
- `--set-default`

Behavior:

- if no token is provided through stdin or `BWS_ACCESS_TOKEN` and the command is running in a terminal, prompt for the token without echoing input
- `--access-token-prompt` forces the hidden prompt path
- non-interactive automation should use `--access-token-stdin`
- `--organization-id` should be stored for profiles that will use `policy setup`

### `doctor`

Purpose:

- validate local state for one profile
- validate Bitwarden authentication
- validate secret fetchability for aliases allowed on that profile

Flags:

- `--profile <name>`
- `--json`
- `--skip-secrets`

Checks:

- config presence and mode
- config dir mode
- `defaultProfile` integrity
- policy presence and mode
- audit log mode if present
- state dir mode if present
- credential store readability
- Bitwarden authentication
- alias fetchability for matching aliases unless `--skip-secrets` is used

Behavior:

- text mode prints a human-readable report and exits non-zero on failed error-level checks
- `--json` prints a machine-readable report and sets a non-zero exit code on failed error-level checks

### `exec`

Form:

```bash
bitwarden-agent-secrets exec [--profile <name>] --map <alias:ENV> -- <command...>
```

Rules:

- each alias must exist
- each alias must have `mode=env`
- selected profile must be allowed by the alias
- if `allowedCommands` is configured, `basename(argv[0])` must match
- secret values are injected only into the child process environment

### `file`

Form:

```bash
bitwarden-agent-secrets file [--profile <name>] --mount <alias:ENV> -- <command...>
```

Rules:

- each alias must exist
- each alias must have `mode=file`
- selected profile must be allowed by the alias
- if `allowedCommands` is configured, `basename(argv[0])` must match
- temp files are created inside the user-private runtime directory
- cleanup runs in `finally`

Shell expansion caveat:

```bash
bitwarden-agent-secrets file --mount prod_ssh_key:SSH_KEY_FILE -- sh -c 'ssh -i "$SSH_KEY_FILE" user@host'
```

Without the nested `sh -c`, your current shell expands `"$SSH_KEY_FILE"` before the broker starts.

### `policy add`

Form:

```bash
bitwarden-agent-secrets policy add <alias> \
  --secret-id <id> \
  --mode <env|file> \
  --env <ENV> \
  --profile <name> \
  [--profile <name> ...] \
  [--allowed-command <name> ...] \
  [--requires-approval]
```

Rules:

- `--profile` is repeatable and required at least once
- `--allowed-command` is repeatable and optional
- dangerous interpreters such as `sh`, `bash`, `python`, or `node` must emit a warning

### `policy list`

Purpose:

- print aliases and their runtime constraints

Output includes:

- alias
- mode
- env name
- profiles
- secret id
- allowed commands when configured

### `policy validate`

Checks:

- `secretId` present
- valid `mode`
- `envName` present
- one or more `profiles`
- `allowedCommands`, if present, must be a non-empty string array

### `policy setup`

Purpose:

- build or update local policy from Bitwarden secret names
- support repeated runs by loading the current source policy and compiled policy
- show a human-readable change plan before writing
- resolve Bitwarden secret names to IDs using metadata only

Form:

```bash
bitwarden-agent-secrets policy setup \
  [--profile <name>] \
  [--organization-id <id>] \
  [--interactive] \
  [--select <BitwardenName,...>] \
  [--allow <alias:cmd,cmd>] \
  [--dry-run|--apply --yes]
```

Rules:

- `--select` represents the desired exposed Bitwarden secret names for the profile
- `--interactive` opens a terminal UI with checkboxes for secrets and allowed commands
- if interactive mode needs Bitwarden metadata and no `organizationId` is available, it asks for the Bitwarden organization id
- interactive mode asks `Apply this policy? [y/N]` after rendering the plan unless `--dry-run` is passed
- `--organization-id` overrides the profile organization for this run
- if neither profile nor command defines `organizationId`, setup fails before listing Bitwarden metadata
- selected names are converted to aliases, for example `GITHUB_TOKEN` -> `github_token`
- `--allow` sets allowed child commands for an alias
- command values are normalized to basenames and de-duplicated
- `--dry-run` prints the plan without writing files
- `--apply --yes` writes the source policy and compiled policy in non-interactive automation
- setup must not fetch secret values

Source file:

```text
~/.config/bitwarden-agent-secrets/policy.sources/<profile>.json
```

Compiled file:

```text
~/.config/bitwarden-agent-secrets/policy.json
```

### `audit tail`

Purpose:

- print local audit records

### Removed Command

`reveal` is not part of the CLI contract. Direct secret printing is intentionally unsupported.

## Runtime Behavior

For `exec` and `file`:

1. parse runtime arguments
2. load config and policy
3. resolve active profile
4. validate alias existence, mode, profile access, and `allowedCommands`
5. fetch the secret from Bitwarden
6. inject secret values into the child process
7. run the child command without a shell wrapper in the broker itself
8. write an audit record for success and failure paths
9. clean up temporary files for `file`

## Audit Contract

Audit records are JSON Lines in `audit.log`.

Example:

```json
{"ts":"2026-04-20T10:20:00Z","profile":"default","alias":"github_token","aliases":["github_token"],"mode":"env","command":"gh auth status","result":"success","exitCode":0,"allowedCommand":"pass"}
{"ts":"2026-04-20T10:21:00Z","profile":"default","alias":"github_token","aliases":["github_token"],"mode":"env","command":"curl https://example.com","result":"policy_violation","exitCode":65,"errorKind":"CliError","allowedCommand":"fail"}
```

Fields:

- `ts`
- `profile`
- `alias`: backward-compatible comma-joined alias string
- `aliases`: explicit alias array
- `mode`
- `command`
- `result`: `success`, `failure`, `policy_violation`, or `fetch_error`
- `exitCode`
- `errorKind` when available
- `allowedCommand`: `pass`, `fail`, or `unrestricted`

Must not log:

- secret values
- Bitwarden access tokens
- full environment contents
- temp file contents

## Exit Codes

- `0`: success
- `1`: runtime/config error or failed error-level `doctor` checks
- `2`: validation error
- `64`: CLI usage error
- `65`: policy violation
- child exit code for launched `exec` or `file` commands
- `128 + signal` for child processes terminated by signal

## Security Notes

- `allowedCommands` is a hardening layer, not a sandbox
- once a secret is injected into a child process, that child controls the secret
- `requiresApproval` remains metadata until a real approval flow exists

Full threat model: [SECURITY.md](./SECURITY.md)
