# Filecubby

Filecubby is an experimental, single-owner object transfer and media streaming
tool. It runs as a Cloudflare Worker, stores metadata in Cloudflare KV, and
stores object chunks as Telegram documents in an operator-controlled chat.

It is not a general cloud-storage service, backup product, public object host,
piracy tool, or Google Drive clone. The intended use is a self-hosted personal
transfer tool for an operator who controls the Cloudflare account, Telegram bot,
storage chat, and service tokens.

## What Works

- Upload objects through `POST /api/upload` or the Go CLI.
- Store object chunks as Telegram documents and metadata in Cloudflare KV.
- Serve unlisted download URLs from `/d/:objectId`.
- Serve inline media with byte-range support for browser and FFmpeg streaming.
- Organize objects with lightweight paths, tags, and collections.
- Manage named full-access service tokens.
- Use `/openapi.json` and CLI `--json` output for scripts and agents.
- Optionally write parseable Telegram captions or manifest messages for manual
  recovery and Telegram UI search.

## Limits

The default backend uses the public Telegram Bot API. Public Bot API downloads
are constrained by Telegram's `getFile` path, so Filecubby keeps chunks below
that limit. The default chunk size is **19 MiB**.

Do not configure 50 MB chunks for the serverless public Bot API backend. A 50 MB
document may upload successfully but fail later when Filecubby needs to fetch
the bytes for HTTP download or media streaming.

## Stack

- Cloudflare Workers with Hono
- Cloudflare KV namespaces: `USERS`, `FILES`, `FILE_DOWNLOAD_INFO`, `TASKS`
- Cloudflare Analytics Engine
- Telegram Bot API document storage
- Node 22, pnpm, project-local Wrangler
- Go CLI installed by `just install`

## Quick Start

```sh
fnm use
pnpm install
cp .env.example .env
pnpm run setup:check
pnpm run typecheck
pnpm run build
```

Fill `.env` with your own Cloudflare and Telegram credentials. Keep `.env` and
CLI config private.

For a custom domain, use a hostname on your own Cloudflare-managed zone, for
example:

```text
FILECUBBY_URL=https://filecubby.<your-cloudflare-domain>
```

For local or Workers preview use, set `FILECUBBY_URL` to the URL you are
actually serving.

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

## Docs

- [docs/architecture.md](docs/architecture.md): system model, API surface, data
  flow, and implementation architecture.
- [docs/observation.md](docs/observation.md): observability model and safe
  operational signals.
