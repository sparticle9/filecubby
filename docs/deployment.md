# Deployment

## Primary OSS Deploy

Use the README's **Deploy to Cloudflare** button for the easiest first install,
especially on a clean Cloudflare account. This path keeps Cloudflare account
IDs, Cloudflare API tokens, and Telegram bot secrets out of this source
repository. Cloudflare still asks the user to connect a GitHub or GitLab
account so it can create a copy of the project and connect that copy to Workers
Builds.

This button path is intentionally a first-install path, not an update system.
Cloudflare creates a one-time copy and does not keep it automatically synced to
upstream. Users who want repeatable updates should use **Fork And Deploy**.

Minimum user steps:

1. In Telegram, ask `@BotFather` to create a bot with `/newbot`.
2. Send one message to the new bot, such as `/start`, before the first upload.
3. Click the deploy button.
4. In Cloudflare's setup UI, set `BOT_TOKEN` and `ADMIN_TOKEN`.
5. Set `CHAT_ID` in the non-secret options if known. For a private bot DM, it
   can be left blank after sending `/start`; Filecubby discovers it on first
   upload and caches it in KV. Set it explicitly for groups, channels, or bots
   visible in more than one chat.

Cloudflare prompts for Worker secrets from `.env.example`. The deploy command
resolves existing KV namespaces first, creates missing ones, writes an ignored
generated Wrangler config with IDs, and deploys that generated config. Users
should not need to choose KV namespaces in Cloudflare's setup UI; the generated
config binds `filecubby-tasks`, `filecubby-users`, `filecubby-files`, and
`filecubby-download-info` automatically. If Cloudflare's UI still shows stale KV
prompts, leave them unchanged and let the deploy script finish.

The checked-in `wrangler.toml` is intentionally template-safe: no `account_id`,
no production route, and no account-specific KV namespace IDs. It also omits KV
bindings from the template so the deploy-button form does not ask non-dev users
to pick namespace IDs before setup.

If a user forgets to message the bot before uploading, the deploy still
succeeds. The first upload fails with an instruction to send a message to the
bot and retry. No redeploy is required. Runtime discovery cannot write back to
Worker environment bindings, so discovered chat IDs are stored in KV; values
entered in the setup form remain Worker environment variables.

## Local Operator Setup

Use local setup when you want to manage deployment through Wrangler or the
manual GitHub Action instead of the Cloudflare deploy button.

```sh
fnm use
pnpm install
cp .env.local.example .env
pnpm run setup:check
pnpm run setup
```

Local `.env` may contain:

```text
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
BOT_TOKEN=
ADMIN_TOKEN=
CHAT_ID=
FILECUBBY_URL=http://localhost:8787
FILECUBBY_TOKEN=
```

Local setup uploads `CHAT_ID` as a Worker secret only when it is configured or
discoverable through the local helper. In the deploy-button and GitHub Action
paths, `CHAT_ID` is a non-secret Worker environment variable from the generated
Wrangler config.

Telegram `BOT_TOKEN` must come from `@BotFather`. `CHAT_ID` is optional for a
private bot DM when exactly one chat is visible to Telegram `getUpdates`; send
one message to the bot before the first upload. Set `CHAT_ID` explicitly for
groups, channels, or bots visible in multiple chats. If supplied in the
deploy-button form, it is a Worker environment variable. If auto-discovered at
runtime, it is cached in KV because Workers cannot mutate their own environment
bindings.

## Fork And Deploy

This is the second recommended path for users who can tolerate a few GitHub
steps and want a better update story than a one-time clone. Fork
`sparticle9/filecubby`, add two GitHub Actions secrets in the fork, and run the
manual **Deploy Filecubby** workflow.

Minimum setup:

- `CLOUDFLARE_API_TOKEN` and `BOT_TOKEN` must exist as GitHub Actions secrets
  before the workflow can deploy. GitHub does not securely prompt for secrets in
  the **Run workflow** form.
- `CLOUDFLARE_ACCOUNT_ID` is required, but it can be typed into the workflow
  form instead of pre-created as a GitHub Actions variable.
- `ADMIN_TOKEN`, `FILECUBBY_TOKEN`, and `CHAT_ID` are optional. `CHAT_ID` is a
  non-secret value and is deployed as a plain Worker variable. If `ADMIN_TOKEN`
  is omitted, the workflow generates one and sends it to the private Telegram
  bot chat; store it as an Actions secret later if future runs should reuse the
  same admin token.

Before running the workflow, add `CLOUDFLARE_API_TOKEN` and `BOT_TOKEN` under
`Settings -> Secrets and variables -> Actions -> Secrets`. The workflow form can
accept non-secret values like Cloudflare account ID and Telegram chat ID.

Workflow inputs worth setting:

- `cloudflare_account_id`: Cloudflare account ID, if not stored as a GitHub
  Actions variable.
- `chat_id`: optional non-secret Telegram chat ID, if known.
- `worker_name`: Worker name, usually `filecubby`.
- `namespace_prefix`: KV namespace prefix. Leave blank to use `worker_name`.
- `custom_domain`: optional hostname if the user already has a Cloudflare zone.
- `dry_run`: set true for a non-mutating validation pass.

`CHAT_ID` can be set as the `chat_id` workflow input or as a GitHub Actions
variable named `CHAT_ID`, or left blank for private-DM discovery after sending
`/start` to the bot. When discovered by the workflow, it is written into the
generated Wrangler config as a plain Worker variable.

To update later, sync the fork from `sparticle9/filecubby`, review the incoming
changes, and run the workflow again. This is still more work than the deploy
button, but it gives the owner a durable Git repo they control.

Custom domains are intentionally not part of the primary deploy-button flow
yet. Attach one after the first deploy from Cloudflare, or use the operator path
when you need a scripted custom-domain route.
