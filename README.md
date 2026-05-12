# Filecubby

Filecubby is an experimental, single-owner object transfer and media streaming tool.
It runs as a Cloudflare Worker, stores metadata in Cloudflare KV, and stores
object chunks as Telegram documents in an operator-controlled chat.

This project is public OSS, but it is not positioned as a general cloud-storage
service, backup product, public object host, piracy tool, or Google Drive clone.
Read [docs/architecture.md](docs/architecture.md) and
[docs/observation.md](docs/observation.md) before publishing a
deployment.

Production URL for this repo's current deployment: `https://filecubby.<your-cloudflare-domain>`

## What Works

- Upload objects through `POST /api/upload` or the Go CLI.
- Store object chunks as Telegram documents and metadata in Cloudflare KV.
- Serve unlisted download URLs from `/d/:objectId`.
- Serve inline media with byte-range support for browser and FFmpeg streaming.
- Organize objects with lightweight paths, tags, and collections.
- Manage named full-access service tokens.
- Use `/openapi.json` and CLI `--json` output for agent workflows.
- Use `/console` for session-local token and collection management.
- Optionally write parseable Telegram captions or manifest messages for manual
  recovery and Telegram UI search.
- Bootstrap Cloudflare, Telegram, secrets, KV, deploys, and smoke checks with
  `pnpm run setup` or the manual `Deploy Filecubby` GitHub Action.

## Important Limits

The default backend uses the public Telegram Bot API. Public Bot API downloads
are constrained by Telegram's `getFile` path, so Filecubby keeps chunks below that
limit. The default chunk size is **19 MiB**.

Do not configure 50 MB chunks for the serverless public Bot API backend. A 50 MB
document may upload successfully but fail later when Filecubby needs to fetch the
bytes for HTTP download or media streaming.

## Telegram Organization Records

By default, this repo's Worker config uses `caption`, so chunk documents get a
short readable caption but uploads do not send a second recovery manifest
message. To keep organization metadata only in Cloudflare KV, set
`TELEGRAM_ORGANIZATION_MODE = "off"`.

```toml
TELEGRAM_ORGANIZATION_MODE = "caption"  # off, caption, or manifest
FILECUBBY_MARKER = "fc"
```

`caption` adds short marker-prefixed captions to chunk documents.
`manifest` additionally sends one recovery text message per logical object after
the chunk documents are uploaded, so leave it opt-in. The marker is customizable
so forks can use their own namespace.

Repair/import is intentionally simple and uses Telegram `getUpdates`, so it can
only import messages the Bot API can currently see:

```sh
filecubby --json repair import-telegram --dry-run
filecubby repair import-telegram --dry-run=false
```

## Stack

- Cloudflare Workers, Hono
- Cloudflare KV namespaces: `USERS`, `FILES`, `FILE_DOWNLOAD_INFO`, `TASKS`
- Cloudflare Analytics Engine dataset: `filecubby_analytics`
- Telegram Bot API document storage
- Node 22, pnpm, project-local Wrangler
- Go CLI installed by `just install`

## Quick Start

```sh
fnm use
pnpm install
pnpm run setup:check
pnpm run typecheck
pnpm run build
```

For full interactive setup:

```sh
pnpm run setup
```

The setup script reads/writes ignored `.env`, validates Telegram and
Cloudflare, creates/verifies KV namespaces, sets Worker secrets, initializes
remote KV, runs dry-run deploy, asks before live deploy, and performs real
upload/download smoke checks.

GitHub Actions deployment is available through the manual
`Deploy Filecubby` workflow after repository secrets are configured.

## Deployment

Filecubby is designed to be deployable by an owner who already has a
Cloudflare account and a Telegram bot. A custom domain is optional: without
one, Wrangler can publish the Worker on the account's `*.workers.dev`
subdomain.

Prerequisites:

- Cloudflare account ID.
- Cloudflare API token for Wrangler.
- Telegram bot token from `@BotFather`.
- Telegram chat or channel where the bot can upload documents.
- Node 22 from `fnm` or `mise`, pnpm, and this repo's project-local Wrangler
  dependency.

Create the Cloudflare API token from the Cloudflare dashboard:

1. Open **Manage Account > Account API Tokens**. These account-owned tokens are
   durable service-principal credentials, use the `cfat_` prefix for new tokens,
   and are the preferred fit for CI/CD or long-lived OSS deployments. Creating
   them requires Super Administrator permission on the Cloudflare account.
2. Select **Create Token**, choose a custom token, and name it for this
   deployment, for example `filecubby-wrangler-deploy`.
3. Add the account permissions needed by Wrangler and this repo's setup script:
   `Account Settings:Read`, `Workers Scripts:Read`,
   `Workers Scripts:Edit`, `Workers KV Storage:Read`, and
   `Workers KV Storage:Edit`.
4. Optional but useful for operational inspection: add
   `Workers Observability:Write` for Workers telemetry queries. If the dashboard
   presents separate read/write observability choices, include the read choice
   as well. Cloudflare's telemetry key, value, and query API endpoints currently
   require `Workers Observability Write`.
5. If you will attach a custom domain or zone route, add
   `Workers Routes:Edit` scoped only to that zone. Do not grant all zones unless
   you intentionally deploy across all zones.
6. Scope the account resource to the one Cloudflare account that will run
   Filecubby. Optionally add Cloudflare token restrictions such as TTL or client
   IP filtering.
7. Copy the token secret once and store it only in ignored local state or CI
   secrets.

Cloudflare's current token flow recommends scoping tokens down to the specific
account and zone resources they need. Their account-owned token docs describe
these as the durable integration path when the target endpoints are compatible;
Workers and Workers KV are compatible. Filecubby does not need R2 for the
default Telegram-backed deployment.

Local deployment:

```sh
# preferred
fnm use

# also supported
mise install

pnpm install
cp .env.example .env
```

The repo keeps `.node-version` for `fnm` and `.tool-versions` for `mise`.
Mise can also read `.node-version`, but that requires enabling mise's
idiomatic Node version file support globally; the checked-in `.tool-versions` avoids
that extra prerequisite for new contributors.

Fill `.env` with:

```text
CLOUDFLARE_API_TOKEN=<token from Cloudflare>
BOT_TOKEN=<telegram bot token>
CHAT_ID=<telegram chat id>
ADMIN_TOKEN=<random private admin token>
FILECUBBY_URL=https://<worker-name>.<account-subdomain>.workers.dev
FILECUBBY_TOKEN=<optional service token for smoke checks>
```

For a fresh OSS deployment, update `wrangler.toml` before deploying:

- Set `account_id` to your Cloudflare account ID.
- Keep `workers_dev = true` if you do not use a custom domain.
- Remove or replace the `routes` entry unless you own the listed custom domain.
- Keep the KV binding names unless you are also changing the code.

Then run:

```sh
pnpm run setup:check
pnpm run setup
```

`pnpm run setup` creates or verifies the KV namespaces, uploads Worker secrets,
runs typecheck and a Wrangler dry-run deploy, asks before the live deploy, seeds
the admin token into remote KV, and performs a real upload/download smoke check.

For non-interactive deploys after the first setup:

```sh
pnpm run typecheck
pnpm run build
pnpm run deploy
```

For non-developer operators, prefer the manual **Deploy Filecubby** GitHub
Action. Configure a GitHub Environment such as `production` or `staging` with
the minimum required values:

```text
CLOUDFLARE_ACCOUNT_ID # environment variable
CLOUDFLARE_API_TOKEN  # environment secret
BOT_TOKEN             # environment secret
```

Manual GitHub setup:

1. Open the repository on GitHub.
2. Go to **Settings -> Environments**.
3. Create an environment such as `production` or `staging`.
4. Add variable `CLOUDFLARE_ACCOUNT_ID`.
5. Add secrets `CLOUDFLARE_API_TOKEN` and `BOT_TOKEN`.
6. Optionally add `CHAT_ID`, `ADMIN_TOKEN`, and `FILECUBBY_TOKEN`.
7. Go to **Actions -> Deploy Filecubby -> Run workflow** and select that
   environment.

`CHAT_ID`, `ADMIN_TOKEN`, and `FILECUBBY_TOKEN` are optional. If `CHAT_ID` is
missing, the workflow tries to discover it from Telegram `getUpdates`; add the
bot to the storage chat and send one message before running. If `ADMIN_TOKEN` is
missing and the resolved chat is a private bot DM, the workflow generates one
and delivers it there. It does not print generated credentials in GitHub logs or
job summaries.

`gh` CLI can set the same values, but it is optional:

```sh
gh variable set CLOUDFLARE_ACCOUNT_ID --env staging --body "$CLOUDFLARE_ACCOUNT_ID"
gh secret set CLOUDFLARE_API_TOKEN --env staging --body "$CLOUDFLARE_API_TOKEN"
gh secret set BOT_TOKEN --env staging --body "$BOT_TOKEN"
```

For a local staging rehearsal, use an ignored `.env.staging` copied from
`.env.staging.example`, then run:

```sh
pnpm run provision:staging:dry-run
```

More operational detail is in [docs/architecture.md](docs/architecture.md).

## CLI

Install:

```sh
just install
```

Daily config:

```yaml
general:
  baseUrl: http://localhost:8787/api/
  token: <service-or-admin-token>
  timeout: 30
  MAX_CHUNK_SIZE: 19
image:
  MAX_IMAGE_SIZE: 10
```

Keep it private:

```sh
chmod 600 ~/.config/filecubby/config.yml
```

Usage:

```sh
filecubby uf ./file.m4a --path /audio --tag demo
filecubby ui ./image.png --path /images
filecubby objects ls --path /audio
filecubby meta <object-id>
filecubby get <object-id> ./file.m4a
filecubby mv <object-id> /archive/audio
filecubby tag <object-id> demo,archive
filecubby collections create "Audio drafts" --path /audio --tag draft
filecubby tokens list
```

Use `--json` for scripts and agents.

## API

Service-token auth uses `Authorization: Bearer <service-token>`.

Admin routes use `Authorization: Bearer <ADMIN_TOKEN>`.

```text
GET  /test
GET  /openapi.json
GET  /console
POST /api/upload
GET  /api/upload/status/:objectId
POST /api/upload/finalize/:objectId
GET  /api/objects
GET  /api/objects/:id
PATCH /api/objects/:id
GET  /api/collections
POST /api/collections
GET  /api/collections/:id
PATCH /api/collections/:id
DELETE /api/collections/:id
POST /api/repair/import-telegram
POST /api/upload/image
HEAD /d/:objectId
GET  /d/:objectId
GET  /d/:objectId/partial
POST /api/del
POST /api/delete-expired
GET  /api/tokens
POST /api/tokens
PATCH /api/tokens/:id
DELETE /api/tokens/:id
POST /api/cache/clear
GET  /api/cache/status
GET  /api/cache/count
POST /bot-webhook
```

Upload:

```sh
curl -fsS -X POST "$FILECUBBY_URL/api/upload" \
  -H "Authorization: Bearer $FILECUBBY_TOKEN" \
  -F "file=@/path/to/file" \
  -F "path=/audio" \
  -F "tags=demo,draft"
```

Download:

```sh
curl -fsS "$FILECUBBY_URL/d/<objectId>" -o object
curl -fsS -r 0-1023 "$FILECUBBY_URL/d/<objectId>" -o part
```

Use `?dl=1` to force attachment disposition for otherwise inline-safe types.

## Validation

Local gates:

```sh
pnpm run typecheck
pnpm run build
just test
```

Representative live proof from the revival baseline:

- Custom domain `/test` returned OK.
- Real CLI upload/download byte-compare passed.
- A 60 MB `.m4a` uploaded through chunking and streamed in Chrome.
- FFmpeg ranged seek/decode read a small byte range instead of the full object.

## Docs

- [docs/architecture.md](docs/architecture.md): OSS posture and product
  principles.
- [docs/observation.md](docs/observation.md): platform and privacy
  boundaries.
- [docs/architecture.md](docs/architecture.md): operator runbook.
- [docs/architecture.md](docs/architecture.md): current implementation design.
- [docs/architecture.md](docs/architecture.md): short module map.
- [docs/observation.md](docs/observation.md): Analytics Engine status and query
  examples.
