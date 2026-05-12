import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const dryRun = process.argv.includes('--dry-run');
const outPath = process.env.WRANGLER_CONFIG_OUT || 'wrangler.provision.generated.toml';
const envFileArg = process.argv.includes('--env-file')
  ? process.argv[process.argv.indexOf('--env-file') + 1]
  : process.env.FILECUBBY_ENV_FILE;

const kvBindings = [
  ['TASKS', 'tasks'],
  ['USERS', 'users'],
  ['FILES', 'objects'],
  ['FILE_DOWNLOAD_INFO', 'object-download-info'],
];

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function setOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  writeFileSync(outputPath, `${name}=${value}\n`, { flag: 'a' });
}

function addSummary(text) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  writeFileSync(summaryPath, text, { flag: 'a' });
}

function loadEnvFile(path) {
  if (!path) return;
  if (!existsSync(path)) throw new Error(`env file not found: ${path}`);
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1);
    process.env[key] = value;
  }
}

function optional(name, fallback = '') {
  return process.env[name] || fallback;
}

function run(args, options = {}) {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    cwd: new URL('..', import.meta.url),
    env: process.env,
    input: options.input,
    encoding: 'utf8',
    stdio: options.capture ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'inherit', 'inherit'],
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(output || `wrangler ${args.join(' ')} failed`);
  }
  return result.stdout?.trim() ?? '';
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function serviceTokenJson(id, name, note) {
  const now = new Date().toISOString();
  return JSON.stringify({ id, name, enabled: true, createdAt: now, updatedAt: now, note });
}

function escapeMarkdownV2Text(value) {
  return String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('_', '\\_')
    .replaceAll('*', '\\*')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
    .replaceAll('~', '\\~')
    .replaceAll('`', '\\`')
    .replaceAll('>', '\\>')
    .replaceAll('#', '\\#')
    .replaceAll('+', '\\+')
    .replaceAll('-', '\\-')
    .replaceAll('=', '\\=')
    .replaceAll('|', '\\|')
    .replaceAll('{', '\\{')
    .replaceAll('}', '\\}')
    .replaceAll('.', '\\.')
    .replaceAll('!', '\\!');
}

function escapeMarkdownV2Code(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('`', '\\`');
}

async function telegramJson(botToken, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(`Telegram ${method} failed: ${payload.description ?? response.statusText}`);
  }
  return payload.result;
}

async function resolveChat(botToken) {
  const configured = optional('CHAT_ID');
  if (configured) return { id: configured, label: configured, source: 'configured' };
  if (dryRun && !optional('BOT_TOKEN')) return { id: 'dryrun-chat-id', label: 'dryrun-chat', source: 'dry-run' };

  const result = await telegramJson(botToken, 'getUpdates');
  const chats = new Map();
  for (const update of result ?? []) {
    const chat =
      update.message?.chat ??
      update.channel_post?.chat ??
      update.edited_message?.chat ??
      update.edited_channel_post?.chat;
    if (chat?.id) chats.set(String(chat.id), chat.title || chat.username || chat.first_name || 'unnamed chat');
  }

  if (chats.size === 1) {
    const [chatId, label] = [...chats.entries()][0];
    console.log(`Discovered Telegram CHAT_ID ${chatId} (${label}).`);
    return { id: chatId, label, source: 'getUpdates' };
  }

  if (chats.size > 1) {
    const options = [...chats.entries()].map(([id, label]) => `- ${id} (${label})`).join('\n');
    throw new Error(`Multiple Telegram chats were found. Set CHAT_ID explicitly and rerun.\n${options}`);
  }

  throw new Error('CHAT_ID is missing and Telegram getUpdates did not show a chat. Add the bot to the storage chat, send one message there, then rerun.');
}

async function validateChat(botToken, chatId) {
  if (dryRun) return { id: chatId, type: 'private', title: 'dryrun-chat' };
  await telegramJson(botToken, 'getMe');
  const chat = await telegramJson(botToken, 'getChat', { chat_id: chatId });
  await telegramJson(botToken, 'sendMessage', {
    chat_id: chatId,
    text: `filecubby provision check ${new Date().toISOString()}`,
    disable_notification: true,
  });
  return chat;
}

async function deliverBootstrapCredentials(botToken, chatId, workerUrl, adminToken, filecubbyToken, generatedFilecubbyToken) {
  if (dryRun) return;
  const lines = [
    `FILECUBBY_URL=${workerUrl || 'not detected'}`,
    `ADMIN_TOKEN=${adminToken}`,
  ];
  if (generatedFilecubbyToken) {
    lines.push('FILECUBBY_TOKEN=<same as ADMIN_TOKEN>');
  } else if (filecubbyToken && filecubbyToken !== adminToken) {
    lines.push(`FILECUBBY_TOKEN=${filecubbyToken}`);
  }
  const codeBlock = escapeMarkdownV2Code(lines.join('\n'));
  await telegramJson(botToken, 'sendMessage', {
    chat_id: chatId,
    text: [
      escapeMarkdownV2Text('Filecubby bootstrap credentials'),
      '',
      '```',
      codeBlock,
      '```',
      '',
      escapeMarkdownV2Text('Store these outside Telegram if you intend to keep using this deployment.'),
    ].join('\n'),
    parse_mode: 'MarkdownV2',
    disable_notification: true,
  });
}

function loadNamespaces() {
  return JSON.parse(run(['kv', 'namespace', 'list', '--config', outPath], { capture: true }));
}

function createBaseConfig({ workerName, accountId }) {
  const text = [
    `name = ${tomlString(workerName)}`,
    'main = "src/index.ts"',
    `account_id = ${tomlString(accountId)}`,
    'compatibility_date = "2026-05-11"',
    'workers_dev = true',
    '',
  ].join('\n');
  writeFileSync(outPath, text);
}

function ensureNamespaces(namespacePrefix) {
  const namespaces = loadNamespaces();
  const byTitle = new Map(namespaces.map((namespace) => [namespace.title, namespace]));
  const ids = new Map();

  for (const [binding, suffix] of kvBindings) {
    const title = `${namespacePrefix}-${suffix}`;
    const existing = byTitle.get(title);
    if (existing) {
      ids.set(binding, existing.id);
      console.log(`Using existing KV namespace ${title} (${existing.id}).`);
      continue;
    }
    if (dryRun) {
      ids.set(binding, `dryrun-${binding.toLowerCase()}`);
      console.log(`Would create KV namespace ${title}.`);
      continue;
    }
    const output = run(['kv', 'namespace', 'create', title, '--config', outPath], { capture: true });
    const id = output.match(/id = "([^"]+)"/)?.[1];
    if (!id) throw new Error(`Could not parse namespace id for ${title}`);
    ids.set(binding, id);
    console.log(`Created KV namespace ${title} (${id}).`);
  }

  return ids;
}

function writeWorkerConfig({ workerName, accountId, customDomain, vars, analyticsDataset, kvIds }) {
  const lines = [
    `name = ${tomlString(workerName)}`,
    'main = "src/index.ts"',
    `account_id = ${tomlString(accountId)}`,
    'compatibility_date = "2026-05-11"',
    'workers_dev = true',
    '',
  ];

  if (customDomain) {
    lines.push('routes = [', `  { pattern = ${tomlString(customDomain)}, custom_domain = true }`, ']', '');
  }

  for (const [binding] of kvBindings) {
    lines.push('[[kv_namespaces]]', `binding = ${tomlString(binding)}`, `id = ${tomlString(kvIds.get(binding))}`, '');
  }

  lines.push('[vars]');
  for (const [key, value] of Object.entries(vars)) {
    lines.push(`${key} = ${typeof value === 'number' ? value : tomlString(value)}`);
  }
  lines.push('', '[triggers]', 'crons = ["0 0 * * *"]', '');
  lines.push('[placement]', 'mode = "smart"', '');

  writeFileSync(outPath, lines.join('\n'));
  console.log(`Wrote ${outPath}.`);
}

function putSecret(name, value) {
  if (dryRun) {
    console.log(`Would set Worker secret ${name}.`);
    return;
  }
  run(['secret', 'put', name, '--config', outPath], { input: value });
}

function seedAdmin(usersNamespaceId, adminToken, filecubbyToken) {
  if (dryRun) {
    console.log('Would seed admin and smoke tokens in USERS KV.');
    return;
  }

  const writes = [
    ['service-token:admin', serviceTokenJson('admin', 'admin', 'Bootstrap admin token')],
    ['service-token-name:admin', 'admin'],
    [`token:${hashToken(adminToken)}`, 'admin'],
  ];
  if (filecubbyToken && filecubbyToken !== adminToken) {
    writes.push(
      ['service-token:setup-smoke', serviceTokenJson('setup-smoke', 'setup-smoke', 'Provision smoke token')],
      ['service-token-name:setup-smoke', 'setup-smoke'],
      [`token:${hashToken(filecubbyToken)}`, 'setup-smoke'],
    );
  }

  for (const [key, value] of writes) {
    run(['kv', 'key', 'put', '--remote', '--namespace-id', usersNamespaceId, key, value], { capture: true });
  }
}

async function smoke(baseUrl, token) {
  if (!baseUrl || dryRun) return;
  const base = baseUrl.replace(/\/$/, '');
  const health = await fetch(`${base}/test`);
  if (!health.ok) throw new Error(`/test failed: ${health.status}`);

  const body = `filecubby github provision smoke ${new Date().toISOString()}\n`;
  const form = new FormData();
  form.append('file', new Blob([body], { type: 'text/plain' }), 'filecubby-github-provision-smoke.txt');
  form.append('expiryHours', '24');
  const upload = await fetch(`${base}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!upload.ok) throw new Error(`upload failed: ${upload.status} ${await upload.text()}`);
  const payload = await upload.json();
  const download = await fetch(`${base}/d/${payload.objectId}`);
  if (!download.ok) throw new Error(`download failed: ${download.status}`);
  const downloaded = await download.text();
  if (downloaded !== body) throw new Error('downloaded bytes did not match upload');
  console.log(`Smoke passed: ${base}/d/${payload.objectId}`);
}

async function main() {
  loadEnvFile(envFileArg);
  const accountId = required('CLOUDFLARE_ACCOUNT_ID');
  const workerName = optional('FILECUBBY_WORKER_NAME', 'filecubby');
  const namespacePrefix = optional('FILECUBBY_NAMESPACE_PREFIX', workerName);
  const customDomain = optional('FILECUBBY_CUSTOM_DOMAIN');
  const botToken = dryRun ? optional('BOT_TOKEN', 'dryrun-bot-token') : required('BOT_TOKEN');
  const chat = await resolveChat(botToken);
  const chatInfo = await validateChat(botToken, chat.id);
  const generatedAdminToken = !optional('ADMIN_TOKEN');
  const adminToken = dryRun ? optional('ADMIN_TOKEN', 'dryrun-admin-token') : optional('ADMIN_TOKEN', randomBytes(32).toString('hex'));
  const filecubbyToken = optional('FILECUBBY_TOKEN', adminToken);
  const generatedFilecubbyToken = !optional('FILECUBBY_TOKEN');
  if (!dryRun && generatedAdminToken && chatInfo.type !== 'private') {
    throw new Error('ADMIN_TOKEN is missing and the resolved Telegram chat is not private. Set ADMIN_TOKEN explicitly or use a private bot DM for bootstrap delivery.');
  }
  const publicUrl = optional('FILECUBBY_URL');

  const outDir = outPath.includes('/') ? outPath.slice(0, outPath.lastIndexOf('/')) : '';
  if (outDir && !existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  createBaseConfig({ workerName, accountId });
  const kvIds = ensureNamespaces(namespacePrefix);
  writeWorkerConfig({
    workerName,
    accountId,
    customDomain,
    kvIds,
    vars: {
      TG_USER_AGENT: optional('TG_USER_AGENT', 'Mozilla/5.0 (Linux; Android 13; Pixel 7 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36'),
      MAX_CHUNK_SIZE: Number(optional('MAX_CHUNK_SIZE', '19922944')),
      MAX_IMAGE_SIZE: Number(optional('MAX_IMAGE_SIZE', '10457280')),
      CACHE_CHUNK_URL_MAX_RETRY: Number(optional('CACHE_CHUNK_URL_MAX_RETRY', '5')),
      CACHE_CHUNK_URL_TIMEOUT: Number(optional('CACHE_CHUNK_URL_TIMEOUT', '5000')),
      CACHE_CHUNK_EDGE_ON_UPLOAD: optional('CACHE_CHUNK_EDGE_ON_UPLOAD', 'false'),
      EDGE_CACHE_CHUNK_TTL: Number(optional('EDGE_CACHE_CHUNK_TTL', '24')),
      EDGE_CACHE_MAX_CHUNK_SIZE: Number(optional('EDGE_CACHE_MAX_CHUNK_SIZE', '50')),
      TELEGRAM_ORGANIZATION_MODE: optional('TELEGRAM_ORGANIZATION_MODE', 'caption'),
      FILECUBBY_MARKER: optional('FILECUBBY_MARKER', 'fc'),
    },
  });

  putSecret('BOT_TOKEN', botToken);
  putSecret('CHAT_ID', chat.id);
  putSecret('ADMIN_TOKEN', adminToken);

  if (dryRun) {
    run(['deploy', '--config', outPath, '--dry-run']);
    return;
  }

  const deployOutput = run(['deploy', '--config', outPath], { capture: true });
  console.log(deployOutput);
  seedAdmin(kvIds.get('USERS'), adminToken, filecubbyToken);
  const inferredUrl = deployOutput.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0] ?? '';
  const workerUrl = publicUrl || inferredUrl;
  if (generatedAdminToken) {
    await deliverBootstrapCredentials(botToken, chat.id, workerUrl, adminToken, filecubbyToken, generatedFilecubbyToken);
  }
  setOutput('worker_url', workerUrl);
  setOutput('chat_id', chat.id);
  addSummary([
    '## Filecubby deployment',
    '',
    `- Worker: \`${workerName}\``,
    `- URL: ${workerUrl || 'not detected'}`,
    `- Telegram CHAT_ID: \`${chat.id}\``,
    generatedAdminToken ? '- ADMIN_TOKEN was generated and delivered via private Telegram DM.' : '- ADMIN_TOKEN came from configured secret.',
    generatedFilecubbyToken ? '- FILECUBBY_TOKEN defaults to ADMIN_TOKEN for this bootstrap.' : '- FILECUBBY_TOKEN came from configured secret.',
    '',
    generatedAdminToken ? 'Store the delivered ADMIN_TOKEN as a repo or environment secret if you want future runs to reuse it instead of rotating it.' : '',
    '',
  ].filter(Boolean).join('\n'));
  await smoke(workerUrl, filecubbyToken);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
