import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const envPath = new URL('../.env', import.meta.url);
const examplePath = new URL('../.env.example', import.meta.url);

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

async function discoverChatId(botToken) {
  if (!botToken) return null;

  const response = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`);
  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(`Telegram getUpdates failed: ${payload.description ?? response.statusText}`);
  }

  const chats = new Map();
  for (const update of payload.result ?? []) {
    const chat =
      update.message?.chat ??
      update.channel_post?.chat ??
      update.edited_message?.chat ??
      update.edited_channel_post?.chat;
    if (chat?.id) {
      chats.set(String(chat.id), chat.title || chat.username || chat.first_name || 'unnamed chat');
    }
  }

  if (chats.size === 1) {
    return [...chats.keys()][0];
  }

  if (chats.size > 1) {
    console.log('Multiple Telegram chats found. Set CHAT_ID manually in .env:');
    for (const [id, label] of chats) {
      console.log(`- ${id} (${label})`);
    }
  } else {
    console.log('No Telegram chats found yet. Send a message in the target chat after adding the bot, then rerun this script.');
  }

  return null;
}

async function main() {
  const seedText = existsSync(envPath)
    ? readFileSync(envPath, 'utf8')
    : existsSync(examplePath)
      ? readFileSync(examplePath, 'utf8')
      : '';
  const values = parseEnv(seedText);

  let changed = false;

  if (!values.get('ADMIN_TOKEN')) {
    values.set('ADMIN_TOKEN', randomBytes(32).toString('hex'));
    changed = true;
    console.log('Generated ADMIN_TOKEN in .env.');
  }

  if (!values.get('FILECUBBY_TOKEN') && values.get('ADMIN_TOKEN')) {
    values.set('FILECUBBY_TOKEN', values.get('ADMIN_TOKEN'));
    changed = true;
    console.log('Set FILECUBBY_TOKEN to ADMIN_TOKEN for initial CLI and smoke tests.');
  }

  if (!values.get('FILECUBBY_URL')) {
    values.set('FILECUBBY_URL', 'https://filecubby.<your-cloudflare-domain>');
    changed = true;
  }

  if (!values.get('CHAT_ID') && values.get('BOT_TOKEN')) {
    const chatId = await discoverChatId(values.get('BOT_TOKEN'));
    if (chatId) {
      values.set('CHAT_ID', chatId);
      changed = true;
      console.log('Discovered CHAT_ID from Telegram updates and wrote it to .env.');
    }
  }

  writeFileSync(envPath, formatEnv(values), { mode: 0o600 });

  if (!changed) {
    console.log('.env already contains the bootstrap values this script can create.');
  }

  const missing = ['BOT_TOKEN', 'CHAT_ID', 'ADMIN_TOKEN'].filter((key) => !values.get(key));
  if (missing.length > 0) {
    console.log(`Still missing: ${missing.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
