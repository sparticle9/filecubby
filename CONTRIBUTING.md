# Contributing

Filecubby is intentionally small: a personal transfer and streaming tool, not a
hosted storage platform. Contributions should preserve that shape.

## Local Checks

Run the project gates before proposing a merge:

```sh
pnpm run typecheck
pnpm run build
just test
```

`pnpm run build` is a Wrangler dry-run deploy.

## Scope Guidelines

- Keep the default deployment serverless and free-friendly.
- Keep secrets out of docs, fixtures, command output, and tests.
- Preserve single-owner semantics unless a change explicitly revisits the
  product model.
- Prefer OpenAPI and stable CLI JSON for agent-facing features.
- Do not add features that encourage public file hosting, piracy, malware
  distribution, spam, phishing, or platform-limit evasion.

## Pull Requests

Use small, reviewable pull requests. Include the local checks you ran and note
any live Cloudflare or Telegram verification separately from local build proof.
