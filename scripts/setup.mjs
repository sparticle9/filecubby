import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const checkOnly = process.argv.includes('--check');
const yes = process.argv.includes('--yes');
const envPath = new URL('../.env', import.meta.url);
const envExamplePath = new URL('../.env.example', import.meta.url);
const wranglerPath = new URL('../wrangler.toml', import.meta.url);
const requiredEnv = ['CLOUDFLARE_API_TOKEN', 'BOT_TOKEN', 'ADMIN_TOKEN', 'CHAT_ID', 'FILECUBBY_URL'];
const kvBindings = ['TASKS', 'USERS', 'FILES', 'FILE_DOWNLOAD_INFO'];
const kvNames = new Map([
  ['TASKS', 'filecubby-tasks'],
  ['USERS', 'filecubby-users'],
  ['FILES', 'filecubby-objects'],
  ['FILE_DOWNLOAD_INFO', 'filecubby-object-download-info'],
]);

function parseEnv(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    values.set(line.slice(0, index), line.slice(index + 1));
  }
  return values;
}

function formatEnv(values) {
  const keys = [
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_API_TOKEN',
    'BOT_TOKEN',
    'ADMIN_TOKEN',
    'CHAT_ID',
    'FILECUBBY_URL',
    'FILECUBBY_TOKEN',
  ];
  return `${keys.map((key) => `${key}=${values.get(key) ?? ''}`).join('\n')}\n`;
}

function loadEnv() {
  const text = existsSync(envPath)
    ? readFileSync(envPath, 'utf8')
    : existsSync(envExamplePath)
      ? readFileSync(envExamplePath, 'utf8')
      : '';
  const values = parseEnv(text);
  for (const [key, value] of Object.entries(process.env)) {
    if (value && !values.get(key)) values.set(key, value);
  }
  return values;
}

function saveEnv(values) {
  writeFileSync(envPath, formatEnv(values), { mode: 0o600 });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, ...Object.fromEntries(options.envValues ?? []) },
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.status !== 0) {
    if (options.capture) {
      throw new Error((result.stderr || result.stdout || `${command} failed`).trim());
    }
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
  return result.stdout?.trim() ?? '';
}

function runPnpm(args, options) {
  return run('pnpm', args, options);
}

function redacted(value) {
  if (!value) return 'missing';
  return `present (${value.length} chars)`;
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function serviceTokenJson(id, name, note) {
  const now = new Date().toISOString();
  return JSON.stringify({ id, name, enabled: true, createdAt: now, updatedAt: now, note });
}

function wranglerConfigKvIds() {
  const text = readFileSync(wranglerPath, 'utf8');
  const ids = new Map();
  for (const binding of kvBindings) {
    const match = text.match(new RegExp(`binding\\s*=\\s*"${binding}"[\\s\\S]*?id\\s*=\\s*"([^"]+)"`));
    if (match) ids.set(binding, match[1]);
  }
  return ids;
}

function verifyLocalTools(env) {
  const major = Number(process.versions.node.split('.')[0]);
  if (major !== 22) throw new Error(`Node 22 is required; current node is ${process.version}`);
  runPnpm(['--version'], { envValues: env, capture: true });
  runPnpm(['exec', 'wrangler', '--version'], { envValues: env, capture: true });
  runPnpm(['exec', 'wrangler', 'whoami'], { envValues: env, capture: true });
}

function ensureKvBindings(env) {
  const ids = wranglerConfigKvIds();
  for (const binding of kvBindings) {
    if (ids.get(binding)) continue;
    const name = kvNames.get(binding);
    console.log(`Creating missing KV namespace ${name} for ${binding}.`);
    runPnpm(['exec', 'wrangler', 'kv', 'namespace', 'create', name, '--binding', binding, '--update-config'], { envValues: env });
  }
}

async function telegramJson(env, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${env.get('BOT_TOKEN')}/${method}`, {
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

async function discoverChatId(env) {
  const result = await telegramJson(env, 'getUpdates');
  const chats = new Map();
  for (const update of result ?? []) {
    const chat = update.message?.chat ?? update.channel_post?.chat ?? update.edited_message?.chat ?? update.edited_channel_post?.chat;
    if (chat?.id) chats.set(String(chat.id), chat.title || chat.username || chat.first_name || 'unnamed chat');
  }
  if (chats.size === 1) return [...chats.keys()][0];
  if (chats.size > 1) {
    console.log('Multiple Telegram chats found:');
    for (const [id, label] of chats) console.log(`- ${id} (${label})`);
  }
  return null;
}

async function validateTelegram(env, mutate) {
  if (!env.get('BOT_TOKEN') || !env.get('CHAT_ID')) return { ok: false, reason: 'BOT_TOKEN or CHAT_ID missing' };
  const bot = await telegramJson(env, 'getMe');
  const chat = await telegramJson(env, 'getChat', { chat_id: env.get('CHAT_ID') });
  if (mutate) {
    await telegramJson(env, 'sendMessage', {
      chat_id: env.get('CHAT_ID'),
      text: `filecubby setup check ${new Date().toISOString()}`,
      disable_notification: true,
    });
  }
  return { ok: true, bot: bot.username, chat: chat.title || chat.username || chat.id };
}

function getWorkerUrl(env) {
  const configured = env.get('FILECUBBY_URL') || 'http://localhost:8787';
  return configured.replace(/\/$/, '');
}

async function smoke(env) {
  const base = getWorkerUrl(env);
  let testUrl = base;
  try {
    const testResponse = await fetch(`${testUrl}/test`);
    if (!testResponse.ok) throw new Error(`${testResponse.status}`);
  } catch {
    testUrl = 'https://filecubby.<account-subdomain>.workers.dev';
    const fallbackResponse = await fetch(`${testUrl}/test`);
    if (!fallbackResponse.ok) throw new Error(`fallback /test failed: ${fallbackResponse.status}`);
  }

  const body = `filecubby setup smoke ${new Date().toISOString()}\n`;
  const form = new FormData();
  form.append('file', new Blob([body], { type: 'text/plain' }), 'filecubby-setup-smoke.txt');
  form.append('expiryHours', '24');
  const upload = await fetch(`${testUrl}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.get('FILECUBBY_TOKEN') || env.get('ADMIN_TOKEN')}` },
    body: form,
  });
  if (!upload.ok) throw new Error(`upload failed: ${upload.status} ${await upload.text()}`);
  const uploadJson = await upload.json();
  const download = await fetch(`${testUrl}/d/${uploadJson.objectId}`);
  if (!download.ok) throw new Error(`download failed: ${download.status}`);
  const downloaded = await download.text();
  if (downloaded !== body) throw new Error('downloaded bytes did not match upload');
  return { url: testUrl, objectId: uploadJson.objectId };
}

async function check(env) {
  console.log('Local environment');
  console.log(`- node: ${process.version}`);
  console.log(`- pnpm: ${execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim()}`);
  for (const key of requiredEnv) console.log(`- ${key}: ${redacted(env.get(key))}`);
  console.log(`- FILECUBBY_TOKEN: ${redacted(env.get('FILECUBBY_TOKEN'))}`);

  const kvIds = wranglerConfigKvIds();
  console.log('KV bindings');
  for (const binding of kvBindings) console.log(`- ${binding}: ${kvIds.get(binding) ? 'configured' : 'missing'}`);

  try {
    const whoami = runPnpm(['exec', 'wrangler', 'whoami'], { capture: true, envValues: env });
    console.log(`Wrangler auth: ${whoami.includes('logged in') ? 'present' : 'unknown'}`);
  } catch (error) {
    console.log(`Wrangler auth: failed (${error.message.split('\n')[0]})`);
  }

  try {
    const secrets = runPnpm(['exec', 'wrangler', 'secret', 'list'], { capture: true, envValues: env });
    for (const key of ['BOT_TOKEN', 'ADMIN_TOKEN', 'CHAT_ID']) {
      console.log(`- Worker secret ${key}: ${secrets.includes(key) ? 'present' : 'missing'}`);
    }
  } catch (error) {
    console.log(`Worker secrets: unavailable (${error.message.split('\n')[0]})`);
  }

  try {
    const telegram = await validateTelegram(env, false);
    console.log(`Telegram: ${telegram.ok ? `ok (${telegram.bot} -> ${telegram.chat})` : telegram.reason}`);
  } catch (error) {
    console.log(`Telegram: failed (${error.message})`);
  }

  try {
    const response = await fetch(`${getWorkerUrl(env)}/test`);
    console.log(`Route /test: ${response.ok ? 'ok' : `failed ${response.status}`}`);
  } catch (error) {
    console.log(`Route /test: failed (${error.message})`);
  }
}

async function askYes(question) {
  if (yes) return true;
  const rl = createInterface({ input, output });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return ['y', 'yes'].includes(answer.trim().toLowerCase());
}

async function putSecret(name, env) {
  const result = spawnSync('pnpm', ['exec', 'wrangler', 'secret', 'put', name], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, ...Object.fromEntries(env) },
    input: env.get(name),
    encoding: 'utf8',
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (result.status !== 0) throw new Error(`failed to set Worker secret ${name}`);
}

async function seedAdmin(env) {
  const admin = serviceTokenJson('admin', 'admin', 'Bootstrap admin token');
  runPnpm(['exec', 'wrangler', 'kv', 'key', 'put', '--remote', '--binding=USERS', 'service-token:admin', admin], { envValues: env, capture: true });
  runPnpm(['exec', 'wrangler', 'kv', 'key', 'put', '--remote', '--binding=USERS', 'service-token-name:admin', 'admin'], { envValues: env, capture: true });
  runPnpm(['exec', 'wrangler', 'kv', 'key', 'put', '--remote', '--binding=USERS', `token:${hashToken(env.get('ADMIN_TOKEN'))}`, 'admin'], { envValues: env, capture: true });
  if (env.get('FILECUBBY_TOKEN') && env.get('FILECUBBY_TOKEN') !== env.get('ADMIN_TOKEN')) {
    const smokeToken = serviceTokenJson('setup-smoke', 'setup-smoke', 'Setup smoke token');
    runPnpm(['exec', 'wrangler', 'kv', 'key', 'put', '--remote', '--binding=USERS', 'service-token:setup-smoke', smokeToken], { envValues: env, capture: true });
    runPnpm(['exec', 'wrangler', 'kv', 'key', 'put', '--remote', '--binding=USERS', 'service-token-name:setup-smoke', 'setup-smoke'], { envValues: env, capture: true });
    runPnpm(['exec', 'wrangler', 'kv', 'key', 'put', '--remote', '--binding=USERS', `token:${hashToken(env.get('FILECUBBY_TOKEN'))}`, 'setup-smoke'], { envValues: env, capture: true });
  }
}

async function setup() {
  const env = loadEnv();
  let changed = false;
  if (!env.get('ADMIN_TOKEN')) {
    env.set('ADMIN_TOKEN', randomBytes(32).toString('hex'));
    changed = true;
    console.log('Generated ADMIN_TOKEN in .env.');
  }
  if (!env.get('FILECUBBY_TOKEN')) {
    env.set('FILECUBBY_TOKEN', env.get('ADMIN_TOKEN'));
    changed = true;
  }
  if (!env.get('FILECUBBY_URL')) {
    env.set('FILECUBBY_URL', 'http://localhost:8787');
    changed = true;
  }
  if (!env.get('CHAT_ID') && env.get('BOT_TOKEN')) {
    const chatId = await discoverChatId(env);
    if (chatId) {
      env.set('CHAT_ID', chatId);
      changed = true;
      console.log('Discovered CHAT_ID from Telegram updates.');
    }
  }
  if (changed) saveEnv(env);

  const missing = requiredEnv.filter((key) => !env.get(key));
  if (missing.length) throw new Error(`Missing required env: ${missing.join(', ')}`);

  verifyLocalTools(env);
  await validateTelegram(env, true);
  ensureKvBindings(env);
  for (const key of ['BOT_TOKEN', 'ADMIN_TOKEN', 'CHAT_ID']) await putSecret(key, env);
  runPnpm(['run', 'typecheck'], { envValues: env });
  runPnpm(['run', 'build'], { envValues: env });

  if (await askYes('Deploy the Worker now?')) {
    runPnpm(['run', 'deploy'], { envValues: env });
    await seedAdmin(env);
    const result = await smoke(env);
    console.log(`Smoke passed via ${result.url}; objectId=${result.objectId}`);
  } else {
    console.log('Deploy skipped. Run pnpm setup -- --yes or pnpm run deploy when ready.');
  }
}

if (checkOnly) {
  await check(loadEnv());
} else {
  await setup();
}
