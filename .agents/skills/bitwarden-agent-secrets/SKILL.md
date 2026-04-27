---
name: bitwarden-agent-secrets
description: Use when an agent needs to run local commands with secrets through the BAS/bitwarden-agent-secrets CLI without directly reading, printing, storing, or managing secret values.
---

<objective>
Use the local BAS (`bas` or `bitwarden-agent-secrets`) CLI to run commands with secrets that are already allowed by local policy. BAS is the boundary: the agent gets a command execution with injected secrets, not Bitwarden credentials or raw secret values.
</objective>

<security_rules>
- Never print, echo, summarize, reveal, copy, or store secret values.
- Never inspect BAS credential storage, keychain entries, Bitwarden machine tokens, or mounted secret file contents.
- Never run `env`, `printenv`, `set`, `cat "$SECRET_FILE"`, `grep "$SECRET_FILE"`, or similar diagnostics after injection.
- Never write injected values to repo files, notes, logs, shell history, custom temp files, or memory files.
- Do not run `policy setup --apply`, `policy add`, `policy remove`, `init`, `profile add`, `profile remove`, or `profile rotate-token` unless the user explicitly asks for access setup/admin work.
- Treat `allowedCommands` as an accidental-misuse guard, not as a sandbox. Once a child command receives a secret, that child command controls it.
- Avoid shell/interpreter wrappers (`sh`, `bash`, `python`, `node`, etc.) unless the policy intentionally allows them and no safer command form exists.
</security_rules>

<command_selection>
Prefer `bas` if available. If it is not found, use `bitwarden-agent-secrets`.

Check availability without touching secrets:
```bash
command -v bas || command -v bitwarden-agent-secrets
```
</command_selection>

<normal_workflow>
1. Discover allowed aliases without reading values:
   ```bash
   bas policy list
   ```

2. Validate local config without fetching secret values when diagnosing setup:
   ```bash
   bas doctor --skip-secrets
   ```

3. For env secrets, run the target command through BAS:
   ```bash
   bas exec --map <alias>:<ENV_NAME> -- <command...>
   ```

4. For file secrets, mount through BAS:
   ```bash
   bas file --mount <alias>:<ENV_NAME> -- <command...>
   ```

5. Report only command result and non-secret diagnostics. If auth fails, discuss alias/profile/allowed command/config/token validity; do not ask the user to reveal the secret.
</normal_workflow>

<policy_guidance>
Policy is the source of truth for what the agent may use.

Safe read-only commands:
```bash
bas policy list
bas policy validate
bas policy setup --dry-run
bas policy setup --interactive --dry-run
```

Admin commands require explicit user request:
```bash
bas init
bas profile add
bas profile remove
bas profile rotate-token
bas policy add
bas policy remove
bas policy setup --apply --yes
```
</policy_guidance>

<examples>
GitHub CLI token:
```bash
bas exec --map github_token:GITHUB_TOKEN -- gh auth status
```

Sentry token:
```bash
bas exec --map sentry_auth_token:SENTRY_AUTH_TOKEN -- sentry-cli info
```

Portainer API token:
```bash
bas exec --map portainer_token:PORTAINER_API_TOKEN -- curl -sS -H "X-API-Key: $PORTAINER_API_TOKEN" https://portainer.example.com/api/endpoints
```

SSH key file, only when the alias is allowed for `ssh`:
```bash
bas file --mount prod_ssh_key:SSH_KEY_FILE -- ssh -i "$SSH_KEY_FILE" user@host
```
</examples>

<failure_handling>
- Unknown alias: run `bas policy list` and choose from configured aliases.
- Command blocked: use the exact command allowed by policy or ask the user before changing policy.
- Missing organization/profile setup: suggest admin setup commands, but do not run them unless requested.
- Bitwarden fetch/auth failure: run `bas doctor --skip-secrets` first; use full `bas doctor` only when the user agrees that fetchability checks are needed.
- Child command prints a secret: stop quoting output and tell the user the child process exposed sensitive output.
</failure_handling>

<success_criteria>
- The agent uses BAS for all secret-backed commands.
- No raw secret value appears in the conversation, repo, logs, or custom temp files.
- Policy/admin changes happen only after explicit user request.
- The final response describes what was done without exposing secret material.
</success_criteria>
