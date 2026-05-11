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
  `pnpm run setup`.

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
