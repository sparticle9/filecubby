# Filecubby CLI

Go CLI for Filecubby uploads and service-token administration.

## Install

From the repository root:

```sh
just install
```

This builds `~/.local/bin/filecubby`. Override with:

```sh
FILECUBBY_INSTALL_DIR=/path/to/bin just install
```

## Configuration

Default config path:

```text
~/.config/filecubby/config.yml
```

Example:

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

Env and flags override config:

```sh
FILECUBBY_URL=https://filecubby.<your-cloudflare-domain>
FILECUBBY_TOKEN=<token>
filecubby --base-url https://filecubby.<your-cloudflare-domain> --token <token> uf ./file
```

## Uploads

```sh
filecubby uf ./file.txt
filecubby uf ./file.txt --path /docs --tag draft
filecubby ui ./image.png
filecubby ui
```

`filecubby ui` reads image bytes through `github.com/aymanbagabas/go-nativeclipboard`. On macOS it falls back to `osascript` when the native clipboard backend cannot return image bytes.

Use `--json` for scripts:

```sh
filecubby --json uf ./file.txt
filecubby --json objects ls --path /docs
```

## Objects And Collections

```sh
filecubby objects ls
filecubby meta <object-id>
filecubby get <object-id> ./downloaded-file
filecubby mv <object-id> /archive
filecubby tag <object-id> draft,archive
filecubby collections list
filecubby collections create "Audio drafts" --path /audio --tag draft
filecubby repair import-telegram --dry-run
```

## Service Tokens

These commands use `/api/tokens` and require an admin token:

```sh
filecubby tokens list
filecubby tokens create laptop --note "local CLI"
filecubby tokens update <id> --name laptop-main --note "rotated"
filecubby tokens disable <id>
filecubby tokens enable <id>
filecubby tokens delete <id>
```

Token values are printed only on `tokens create`.

## Local Development

```sh
cd cli
go test ./...
go build -ldflags="-s -w" -o filecubby .
```
