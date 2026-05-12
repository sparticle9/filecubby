# Observation

Filecubby should be observable without exposing operator identity, token values,
Cloudflare account identifiers, Telegram chat ids, or hosted-domain details.

## Signals

- Worker request status, latency, and route-level error rates.
- Upload and download counts by route family.
- Telegram API success/failure counts.
- KV operation success/failure counts.
- Cache hit/miss behavior for Telegram file URLs and optional chunk-body cache.
- Scheduled expiration task results.
- Token-management events without token values.

## Safe Event Shape

Events should identify behavior, not private infrastructure:

```text
event=filecubby.request
route=/api/upload
status=200
duration_ms=123
object_size_bucket=10-20MiB
chunks=1
cache=miss
```

Do not log:

- raw bearer tokens, admin tokens, Telegram bot tokens, or GitHub tokens
- Telegram chat ids, message ids where they are not needed for debugging, or
  user-identifying Telegram metadata
- Cloudflare account ids, namespace ids, zone ids, API token names, or token
  values
- private hostnames or operator domains
- local filesystem paths that reveal a user or machine name

## Next Observability Plan

The default deployment intentionally does not provision Analytics Engine. Basic
operators should not have to choose another Cloudflare resource just to upload
and download files.

For optional analytics, prefer Cloudflare Workers OpenTelemetry export to a
provider with a usable free tier, such as Grafana Cloud Free or Axiom Free.
Keep this opt-in:

- users configure the OTel destination in the Cloudflare dashboard
- `wrangler.toml` adds the matching destination names only when the user wants
  external observability
- emitted logs/traces keep the safe event shape above and avoid object ids,
  token ids, chat ids, domains, and Cloudflare account/resource ids

Example future config shape:

```toml
[observability.traces]
enabled = true
destinations = ["grafana-traces"]

[observability.logs]
enabled = true
destinations = ["grafana-logs"]
```

Use the equivalent Axiom destination names for Axiom Free. Do not make either
provider mandatory in the OSS template.

## Error Handling

Errors returned to clients should be specific enough to act on but should not
include secret-bearing upstream responses. Prefer stable categories:

- `auth_failed`
- `object_not_found`
- `telegram_upload_failed`
- `telegram_download_failed`
- `metadata_write_failed`
- `cache_clear_failed`

Internal logs may include redacted upstream status codes and short reason
strings. Full upstream payloads should be sampled carefully or avoided.

## Operator Checks

For a deployed instance, useful checks are:

```sh
curl -fsS "$FILECUBBY_URL/test"
curl -fsS "$FILECUBBY_URL/openapi.json" >/dev/null
```

End-to-end upload/download smoke tests should use an operator-owned service
token from local private configuration. Do not commit that token or the hosted
domain used for the smoke test.
