# Security Policy

Filecubby is a self-hosted, single-owner personal tool. The operator is responsible
for the Cloudflare account, Telegram account, bot token, storage chat, admin
token, and service tokens used by their deployment.

## Supported Versions

Security fixes target the current `main` branch.

## Reporting

Do not include secret values, bot tokens, service tokens, private file URLs, or
chat IDs in public issues.

For a private report, contact the maintainer through the repository's preferred
private channel. If no private channel is listed, open a public issue with only
the affected component and impact, then coordinate disclosure details there.

## Secrets

Filecubby never needs committed secret values. Keep these in ignored local files,
Cloudflare Worker secrets, GitHub repository secrets, or local CLI config with
private filesystem permissions:

- `BOT_TOKEN`
- `CHAT_ID`
- `ADMIN_TOKEN`
- `FILECUBBY_TOKEN`
- `CLOUDFLARE_API_TOKEN`

Rotate any token that appears in logs, screenshots, command output, support
requests, issues, pull requests, or generated examples.
