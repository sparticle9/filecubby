# Architecture

Filecubby is owner-operated, serverless personal object storage. Telegram stores
object bytes, Cloudflare KV stores the filesystem/index, and the Cloudflare
Worker is the object gateway.

## Runtime

- Worker: `src/index.ts`
- Framework: Hono on Cloudflare Workers
- Package manager: global `pnpm`
- Deploy tool: project-local Wrangler
- Node: 22 LTS
- Worker name: `filecubby`
- Production URL: `https://filecubby.<your-cloudflare-domain>`
- Analytics dataset: `filecubby_analytics`

## System Map

```mermaid
flowchart LR
  owner["Owner"]
  cli["filecubby CLI"]
  api["HTTP API / OpenAPI"]
  console["Console"]
  worker["Filecubby Worker<br/>object gateway"]
  kv["Cloudflare KV<br/>filesystem/index"]
  tg["Telegram bot chat<br/>byte store"]
  cache["Download URL / edge cache"]
  player["Browser / media player / agent"]

  owner --> cli
  owner --> api
  owner --> console
  cli --> worker
  api --> worker
  console --> worker
  worker --> kv
  worker --> tg
  worker --> cache
  player --> worker
  worker --> player
```

## Canonical Terms

- Owner: the person who owns the Cloudflare account, Telegram account, bot, and
  service tokens.
- System: one Filecubby deployment operated by that owner.
- Namespace: an object namespace owned by the system. Version 1 has exactly one
  namespace: `default`.
- Collection: a named grouping under namespace `default`; useful for purpose or
  type groupings such as health, tech, food, audio, or receipts.
- Object: one logical stored item with a unique id across namespace `default`.
- Object metadata: name, MIME type, size, upload timestamps, path, tags,
  collection ids, chunk ids, and recovery message ids.
- Chunk: one Telegram document that stores part or all of an object.
- Byte store: Telegram Bot API documents in the owner-controlled storage chat.
- Filesystem/index: Cloudflare KV records that make objects searchable and
  downloadable.
- Recovery record: optional Telegram caption or manifest text that can rebuild
  missing KV metadata when it is still visible through Bot API updates.

## Object Model

```text
owner
  system: filecubby
    namespace: default
      collections
        collection:default:<collectionId>
        collection-slug:default:<slug>
      objects
        object:default:<objectId>
          metadata
          chunks[]
```

Paths and tags are lightweight object metadata. They are intentionally not a
full filesystem permission model. Collections are named groupings in the same
single namespace and are not access-control boundaries.

## Storage

- `FILES`: canonical object metadata at `object:default:<objectId>`,
  collection metadata at `collection:default:<collectionId>`, and slug indexes
  at `collection-slug:default:<slug>`.
- `USERS`: named service-token metadata and token indexes.
- `FILE_DOWNLOAD_INFO`: Telegram chunk URL cache and download helper metadata.
- `TASKS`: task namespace retained for scheduled/background workflows.
- Telegram chat: object-byte backing store through the bot API.

`FILES` is the source of truth for object organization. Telegram `file_id`
values are stored as chunk ids; the Worker resolves those ids to Telegram file
URLs when serving downloads.

## Auth Model

The project is intentionally single-tenant:

- One Telegram bot/chat stores all object chunks.
- `ADMIN_TOKEN` protects token-management APIs.
- Many named service tokens can upload, list, patch, delete, and download from
  the same storage tenant.
- There is no RBAC.

Service-token storage uses:

- `service-token:<id>` -> token metadata
- `service-token-name:<name>` -> token id
- `token:<sha256(token)>` -> token id

The plaintext token value is returned only by `POST /api/tokens`.

## Object Metadata

Current metadata shape:

```ts
interface ObjectMetadata {
  namespaceId: "default"
  id: string
  userId: string
  name: string
  size: number
  chunks: number
  chunkSize?: number
  chunkIds: string[]
  chunkMessageIds?: Array<number | null>
  manifestMessageId?: number
  expiresAt: string | null
  type: string
  uploadedAt: string
  updatedAt?: string
  path?: string
  tags?: string[]
  collectionIds?: string[]
  description?: string
  backend?: "telegram-bot-api"
  createdByTokenId?: string
}
```

`chunkSize` is saved when known so ranged media streaming can map byte offsets
to Telegram chunks accurately. `path`, `tags`, and `collectionIds` are the
organization primitives.

Collection metadata is lightweight:

```ts
interface Collection {
  namespaceId: "default"
  id: string
  name: string
  slug: string
  description?: string
  path?: string
  tags?: string[]
  createdAt: string
  updatedAt: string
}
```

## Upload Flow

Small uploads go through `POST /api/upload` as multipart form data. The binary
field may remain `file` because it is the submitted blob. Object metadata fields
use object terminology:

- `objectName`
- `objectType`
- `objectSize`
- optional organization fields: `path`, `tags`, `collectionIds`, `description`

Chunked uploads use the same endpoint:

- initialize with metadata-only `POST /api/upload`
- upload chunks with `isChunk=true`, `chunkIndex`, `totalChunks`, `objectId`,
  `objectName`, `objectType`, `chunkSize`, and binary field `file`
- optionally call `POST /api/upload/finalize/:objectId`

Responses return `objectId` and, when complete, `/d/<objectId>`.

## Download Flow

Downloads are unlisted bearer-style object URLs:

- `HEAD /d/:objectId`
- `GET /d/:objectId`
- `GET /d/:objectId?dl=1` to force attachment behavior

The Worker loads metadata from `FILES`, resolves Telegram chunk URLs through
`FILE_DOWNLOAD_INFO`, and streams bytes to the client. It sets
`Accept-Ranges: bytes`; `Range` requests return `206 Partial Content` with a
precise `Content-Range` and only fetch the required chunks.

Inline display is allowed for common media and document types, including MP4,
WebM, MP3/MPEG audio, images, JSON, PDF, and text.

## Caching

The active performance path has two layers:

- Telegram chunk URL caching in `FILE_DOWNLOAD_INFO`.
- Optional chunk-body caching through the Cloudflare Cache API.

Relevant `wrangler.toml` vars:

- `CACHE_CHUNK_URL_MAX_RETRY`
- `CACHE_CHUNK_URL_TIMEOUT`
- `CACHE_CHUNK_EDGE_ON_UPLOAD`
- `EDGE_CACHE_CHUNK_TTL`
- `EDGE_CACHE_MAX_CHUNK_SIZE`

`CACHE_CHUNK_EDGE_ON_UPLOAD` is currently false, so upload completion does not
block on edge chunk-body caching. Downloads can still cache fetched chunks.

## Telegram Recovery Records

`TELEGRAM_ORGANIZATION_MODE` defaults to `off`.

- `caption`: object chunks get short, marker-prefixed captions.
- `manifest`: Filecubby sends one marker-prefixed recovery manifest message
  after the object chunks have been uploaded.

`FILECUBBY_MARKER` defaults to `fc`. Captions and manifests include
`namespace: default` when needed for repair/import.

Repair/import uses `getUpdates` through `POST /api/repair/import-telegram`.
That can reconstruct KV records only from messages the Bot API can currently
see; it does not read arbitrary old chat history.

## CLI

The Go CLI is in `cli/` and installs only as `filecubby` with `just install`.

Config resolution:

- `--config <path>` if passed
- `$XDG_CONFIG_HOME/filecubby/config.yml`
- `~/.config/filecubby/config.yml`
- env overrides such as `FILECUBBY_TOKEN`, `FILECUBBY_BASE_URL`,
  `FILECUBBY_API_BASE_URL`, and `FILECUBBY_URL`

Clipboard image upload first uses `github.com/aymanbagabas/go-nativeclipboard`.
On macOS, it falls back to `osascript` when the native clipboard backend cannot
return image bytes.
