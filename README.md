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
- Deploy from the Cloudflare button with account-local secrets and
  automatically provisioned KV, or use `pnpm run setup` / the manual GitHub
  Action for operator workflows.

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

## Deploy To Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/sparticle9/filecubby)

This is the primary install path for this public repository. It does not
require Cloudflare or Telegram secrets in the GitHub repo. Cloudflare clones the
project into your GitHub or GitLab account, provisions Worker resources in your
Cloudflare account, and prompts for Worker secrets from `.env.example`.

Before clicking:

1. Open Telegram and message `@BotFather`.
2. Create a bot with `/newbot` and copy the bot token.
3. Open the new bot and send it one message, such as `/start`. Do this before
   the first upload so Telegram exposes the chat to the bot.
4. Generate a private admin token, for example `openssl rand -hex 32`.

In Cloudflare's setup form:

- Set `BOT_TOKEN` to the token from `@BotFather`.
- Set `ADMIN_TOKEN` to your generated admin token.
- Set `CHAT_ID` if you know it; Cloudflare saves it as a Worker secret/env
  binding. For a private bot DM, you may leave it blank after sending `/start`.
  Filecubby discovers the chat on first upload and caches it in KV. Set
  `CHAT_ID` explicitly for groups, channels, or bots that can see more than one
  chat.
- Use the default `*.workers.dev` URL unless you want to add a custom domain
  after the first deploy.

After deploy, use `Authorization: Bearer <ADMIN_TOKEN>` for API or CLI calls.
Custom domains are optional and can be attached later in Cloudflare.

If the first upload says `CHAT_ID` is not configured, send `/start` to the bot
in Telegram and retry the upload. No redeploy is required. A Worker cannot write
back to its own environment bindings at runtime, so auto-discovered chat IDs are
cached in KV; values entered in Cloudflare's setup form are saved as Worker
secrets/env bindings.

## Quick Start

```sh
fnm use
pnpm install
cp .env.local.example .env
pnpm run setup:check
pnpm run typecheck
pnpm run build
```

Fill `.env` with your own Cloudflare and Telegram credentials. Keep `.env` and
CLI config private.

For a fresh public deploy-button install, keep the checked-in `wrangler.toml`
account-neutral. It intentionally does not contain an `account_id`, custom
route, or KV namespace IDs. Cloudflare's deploy-button flow provisions the KV
namespaces from the binding names.

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

- [docs/deployment.md](docs/deployment.md): deploy-button and operator
  deployment notes.
- [docs/architecture.md](docs/architecture.md): system model, API surface, data
  flow, and implementation architecture.
- [docs/observation.md](docs/observation.md): observability model and safe
  operational signals.
