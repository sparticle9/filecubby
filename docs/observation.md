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

## Analytics Engine

The Worker can bind Cloudflare Analytics Engine as `ANALYTICS_ENGINE`.
Recommended dimensions are route family, status class, cache status, upload mode,
and coarse object-size bucket. Keep dimensions low-cardinality and avoid object
ids, token ids, chat ids, or domains.

Example query shape:

```sql
SELECT
  blob1 AS route_family,
  blob2 AS status_class,
  COUNT() AS requests
FROM filecubby_analytics
WHERE timestamp > now() - INTERVAL '1' DAY
GROUP BY route_family, status_class
ORDER BY requests DESC
```

Use dataset names that match your deployment. Keep account-specific values in
private configuration, not in the repository.

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
