# Deployment

## Primary OSS Deploy

Use the README's **Deploy to Cloudflare** button for public installs. This path
keeps Cloudflare account IDs, Cloudflare API tokens, and Telegram bot secrets
out of this source repository. Cloudflare still asks the user to connect a
GitHub or GitLab account so it can create a copy of the project and connect
that copy to Workers Builds.

Minimum user steps:

1. In Telegram, ask `@BotFather` to create a bot with `/newbot`.
2. Send one message to the new bot, such as `/start`, before the first upload.
3. Click the deploy button.
4. In Cloudflare's setup UI, set `BOT_TOKEN` and `ADMIN_TOKEN`.
5. Set `CHAT_ID` if known so Cloudflare saves it as a Worker secret/env
   binding. For a private bot DM, it can be left blank after sending `/start`;
   Filecubby discovers it on first upload and caches it in KV. Set it
   explicitly for groups, channels, or bots visible in more than one chat.
6. For each KV namespace prompt, choose **Create new**. If Cloudflare pre-fills
   every namespace name as `filecubby`, rename them to distinct names:
   `filecubby-tasks`, `filecubby-users`, `filecubby-files`, and
   `filecubby-download-info`.

Cloudflare provisions the Worker and KV namespaces from `wrangler.toml`, and
prompts for Worker secrets from `.env.example`. Custom domains are optional and
should be attached after the first deploy if the user hosts a suitable zone in
their Cloudflare account.

The checked-in `wrangler.toml` is intentionally template-safe: no `account_id`,
no production route, and no account-specific KV namespace IDs.

If a user forgets to message the bot before uploading, the deploy still
succeeds. The first upload fails with an instruction to send a message to the
bot and retry. No redeploy is required. Runtime discovery cannot write back to
Worker environment bindings, so discovered chat IDs are stored in KV; values
entered in the setup form remain Worker secrets/env bindings.

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

Local setup uploads `CHAT_ID` as a Worker secret when it is configured or
discoverable. If it is blank, setup skips that secret and the deployed Worker
uses runtime discovery on first upload.

Telegram `BOT_TOKEN` must come from `@BotFather`. `CHAT_ID` is optional for a
private bot DM when exactly one chat is visible to Telegram `getUpdates`; send
one message to the bot before the first upload. Set `CHAT_ID` explicitly for
groups, channels, or bots visible in multiple chats. If supplied during deploy
or with `wrangler secret put CHAT_ID`, it is a Worker secret/env binding. If
auto-discovered at runtime, it is cached in KV because Workers cannot mutate
their own environment bindings.

## Fork And Deploy

This is the second recommended path for users who can tolerate a few GitHub
steps and want a better update story than a one-time clone. Fork
`sparticle9/filecubby`, configure a GitHub Environment in the fork, and run the
manual **Deploy Filecubby** workflow.

Minimum environment variable:

- `CLOUDFLARE_ACCOUNT_ID`

Minimum environment secrets:

- `CLOUDFLARE_API_TOKEN`
- `BOT_TOKEN`

Optional environment secrets:

- `CHAT_ID`
- `ADMIN_TOKEN`
- `FILECUBBY_TOKEN`

Workflow inputs worth setting:

- `github_environment`: the environment that stores the values above.
- `worker_name`: Worker name, usually `filecubby`.
- `namespace_prefix`: KV namespace prefix. Leave blank to use `worker_name`.
- `custom_domain`: optional hostname if the user already has a Cloudflare zone.
- `dry_run`: set true for a non-mutating validation pass.

`CHAT_ID` follows the same model as the deploy-button path: set it to save it
as a Worker secret/env binding, or leave it blank for private-DM discovery after
sending `/start` to the bot.

To update later, sync the fork from `sparticle9/filecubby`, review the incoming
changes, and run the workflow again. This is still more work than the deploy
button, but it gives the owner a durable Git repo they control.

Custom domains are intentionally not part of the primary deploy-button flow
yet. Attach one after the first deploy from Cloudflare, or use the operator path
when you need a scripted custom-domain route.
