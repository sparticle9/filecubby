import { Env } from '../index'
import { ObjectMetadata, getObjectMetadata } from '../db'
import { cacheChunk, getCachedChunk } from './cache'
import { filecubbyMarker, telegramOrganizationMode } from './metadata'

const TG_USER_AGENT = (env: Env) => env.TG_USER_AGENT || 'Filecubby-Server/1.0';
const CHAT_ID_CACHE_KEY = 'telegram:chat-id';

/**
 * Uploads a file or chunk to Telegram.
 * This function sends a file or chunk to the Telegram API and returns the object ID.
 * @param env - The environment object containing configuration and bindings.
 * @param botToken - The Telegram bot token.
 * @param chatId - The Telegram chat ID.
 * @param file - The file or chunk to upload.
 * @param objectName - The name of the object.
 * @param mimeType - The MIME type of the file.
 * @returns A promise that resolves to the object ID.
 */
export interface TelegramDocumentUploadResult {
  chunkId: string;
  messageId?: number;
}

export async function sendTelegramManifest(env: Env, metadata: ObjectMetadata): Promise<number | undefined> {
  if (telegramOrganizationMode(env) !== 'manifest') return undefined;
  const chatId = await resolveTelegramChatId(env);

  const text = [
    telegramRecoveryOneLiner(env, metadata),
    'manifest: recovery record',
    `namespace: ${metadata.namespaceId}`,
    `name: ${metadata.name}`,
    `path: ${metadata.path || '/'}`,
    ...(metadata.tags?.length ? [`tags: ${metadata.tags.join(', ')}`] : []),
    `id: ${metadata.id}`,
    `size: ${formatBytes(metadata.size)}`,
    `chunks: ${metadata.chunks}`,
  ].join('\n');
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': TG_USER_AGENT(env),
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
  const result: any = await response.json();
  if (!result.ok) {
    throw new Error(`Failed to send Telegram manifest: ${result.description}`);
  }
  return result.result?.message_id;
}

export function shouldSendTelegramManifest(env: Env): boolean {
  return telegramOrganizationMode(env) === 'manifest';
}

export async function resolveTelegramChatId(env: Env): Promise<string> {
  if (env.CHAT_ID) return env.CHAT_ID;

  const cached = await env.TASKS.get(CHAT_ID_CACHE_KEY);
  if (cached) return cached;

  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getUpdates`, {
    headers: { 'User-Agent': TG_USER_AGENT(env) },
  });
  const payload: any = await response.json();
  if (!payload.ok) {
    throw new Error(`CHAT_ID is not configured and Telegram getUpdates failed: ${payload.description || response.statusText}`);
  }

  const chats = new Map<string, string>();
  for (const update of payload.result ?? []) {
    const chat =
      update.message?.chat ??
      update.channel_post?.chat ??
      update.edited_message?.chat ??
      update.edited_channel_post?.chat;
    if (chat?.id) chats.set(String(chat.id), chat.title || chat.username || chat.first_name || 'unnamed chat');
  }

  if (chats.size === 1) {
    const [chatId] = chats.keys();
    await env.TASKS.put(CHAT_ID_CACHE_KEY, chatId);
    return chatId;
  }

  if (chats.size > 1) {
    const options = [...chats.entries()].map(([id, label]) => `${id} (${label})`).join(', ');
    throw new Error(`CHAT_ID is not configured and Telegram shows multiple chats: ${options}. Set CHAT_ID explicitly.`);
  }

  throw new Error('CHAT_ID is not configured. Send one message, such as /start, to the Telegram bot, then retry, or set CHAT_ID explicitly.');
}

export async function uploadToTelegramDocument(
  env: Env,
  botToken: string,
  chatId: string,
  file: File | Blob,
  objectName: string,
  mimeType: string,
  options: { caption?: string; replyToMessageId?: number } = {}
): Promise<TelegramDocumentUploadResult> {
  console.log(`Uploading object to Telegram: ${objectName}, size: ${file instanceof File ? file.size : 'unknown'} bytes, type: ${mimeType}`);
  const formData = new FormData()
  formData.append('chat_id', chatId)
  if (options.caption) {
    formData.append('caption', options.caption);
  }
  if (options.replyToMessageId) {
    formData.append('reply_to_message_id', String(options.replyToMessageId));
    formData.append('allow_sending_without_reply', 'true');
  }
  
  formData.append('document', file, objectName);

  console.log('uploadToTelegramDocument: Sending request to Telegram API')
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
    method: 'POST',
    body: formData,
    headers: {
      'User-Agent': TG_USER_AGENT(env)
    }
  })

  let result;
  try {
    const text = await response.text();
    console.log('Raw response from Telegram API:', text);
    result = JSON.parse(text);
  } catch (error) {
    console.error('Failed to parse Telegram API response:', error);
    throw new Error(`Failed to parse Telegram API response: ${error.message}. Status: ${response.status} ${response.statusText}`);
  }

  console.log('uploadToTelegramDocument: Telegram API response:', JSON.stringify(result, null, 2))

  if (!result.ok) {
    console.error('Failed to upload to Telegram:', result.description)
    throw new Error(`Failed to upload to Telegram: ${result.description}`)
  }

  const chunkId = extractTelegramFileId(result.result);
  if (!chunkId) {
    console.error('Telegram upload response did not include a supported file payload:', JSON.stringify(result.result, null, 2));
    throw new Error(`Telegram upload succeeded but no file_id was found in the response payload`);
  }

  return {
    chunkId,
    messageId: result.result.message_id,
  };
}

export function buildChunkCaption(env: Env, metadata: ObjectMetadata, chunkIndex: number): string | undefined {
  const mode = telegramOrganizationMode(env);
  if (mode === 'off') return undefined;

  const caption = [
    telegramOneLiner(env, metadata, `chunk-${chunkIndex + 1}-of-${metadata.chunks}`),
    `path: ${metadata.path || '/'}`,
    ...(metadata.tags?.length ? [`tags: ${metadata.tags.join(', ')}`] : []),
    `id: ${metadata.id}`,
  ].join('\n');
  return caption.length <= 1024 ? caption : [
    telegramOneLiner(env, metadata, `chunk-${chunkIndex + 1}-of-${metadata.chunks}`),
    `id: ${metadata.id}`,
  ].join('\n');
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024;
  for (const unit of units) {
    if (value < 1024) return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
    value /= 1024;
  }
  return `${value.toFixed(2)} TiB`;
}

function telegramOneLiner(env: Env, metadata: ObjectMetadata, suffix: string): string {
  const tags = metadata.tags?.length ? metadata.tags.join('+') : 'untagged';
  const path = compactToken(metadata.path || '/');
  const name = compactToken(metadata.name);
  return `${filecubbyMarker(env)} ${metadata.id}.${name}.${path}.${tags}-${suffix}`;
}

function telegramRecoveryOneLiner(env: Env, metadata: ObjectMetadata): string {
  const tags = metadata.tags?.length ? metadata.tags.join('+') : 'untagged';
  const path = compactToken(metadata.path || '/');
  const name = compactToken(metadata.name);
  return `${filecubbyMarker(env)} recovery ${metadata.id}.${name}.${path}.${tags}-manifest`;
}

function compactToken(value: string): string {
  const compact = value
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+/g, '~')
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9._~+-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
  return compact || 'root';
}

function extractTelegramFileId(message: any): string | undefined {
  if (!message || typeof message !== 'object') {
    return undefined;
  }

  const directMedia = [
    message.document,
    message.audio,
    message.video,
    message.voice,
    message.animation,
    message.video_note,
    message.sticker,
  ];

  for (const media of directMedia) {
    if (media && typeof media.file_id === 'string' && media.file_id.length > 0) {
      return media.file_id;
    }
  }

  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const largest = message.photo[message.photo.length - 1];
    if (largest && typeof largest.file_id === 'string' && largest.file_id.length > 0) {
      return largest.file_id;
    }
  }

  return undefined;
}

/**
 * Fetches the URL of a chunk from Telegram.
 * This function retrieves the URL of a chunk from the Telegram API.
 * @param env - The environment object containing configuration and bindings.
 * @param botToken - The Telegram bot token.
 * @param chunkId - The ID of the chunk.
 * @returns A promise that resolves to the URL of the chunk.
 */
async function fetchChunkUrlFromTelegram(env: Env, botToken: string, chunkId: string): Promise<string> {
  const initialTimeout = parseInt(String(env.CACHE_CHUNK_URL_TIMEOUT), 10) || 10000;
  const maxRetries = parseInt(String(env.CACHE_CHUNK_URL_MAX_RETRY), 10) || 5;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const currentTimeout = initialTimeout + attempt * 1000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), currentTimeout);

    try {
      const url = `https://api.telegram.org/bot${botToken}/getFile?file_id=${chunkId}`;
      console.log(`Attempt ${attempt + 1}: Sending request to: ${url}`);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': TG_USER_AGENT(env),
          'Accept': '*/*',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}, statusText: ${response.statusText}`);
      }

      const result: any = await response.json();
      if (!result.ok || !result.result?.file_path) {
        throw new Error(`Invalid response from Telegram API: ${JSON.stringify(result)}`);
      }

      const fileUrl = `https://api.telegram.org/file/bot${botToken}/${result.result.file_path}`;
      console.log(`Generated file URL: ${fileUrl}`);
      
      const urlValidityResponse = await fetch(fileUrl, { method: 'HEAD' });
      if (!urlValidityResponse.ok) {
        throw new Error(`Invalid URL: ${fileUrl}, status: ${urlValidityResponse.status}`);
      }

      return fileUrl;
    } catch (error) {
      console.error(`Error fetching chunk URL (attempt ${attempt + 1}):`, error);
      if (attempt === maxRetries - 1) {
        console.error(`Max retries (${maxRetries}) reached for chunk ID: ${chunkId}`);
        throw error;
      }
      // Add a delay before the next retry
      await new Promise(resolve => setTimeout(resolve, 1000));
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw new Error(`Failed to fetch valid chunk URL after ${maxRetries} attempts`);
}

/**
 * Retrieves the URL of a chunk.
 * This function checks the cache for the URL of a chunk and fetches it from Telegram if not found.
 * @param env - The environment object containing configuration and bindings.
 * @param botToken - The Telegram bot token.
 * @param objectId - The ID of the file.
 * @param chunkIndex - The index of the chunk.
 * @param chunkId - The ID of the chunk.
 * @returns A promise that resolves to the URL of the chunk.
 */
export async function getChunkUrl(env: Env, botToken: string, objectId: string, chunkIndex: number, chunkId: string): Promise<string> {
  console.log(`Getting chunk URL for object ${objectId}, chunk ${chunkIndex}`);

  // Check for cached URL in KV storage
  // if there is a hit, you need to first check if the url is valid, if not, then fetch the url from telegram. you need to do this because the url might be expired.
  // the most efficient way is to make a HEAD request to the url, if it fails, then fetch the url from telegram.

  const cachedUrl = await getCachedChunkUrl(env, objectId, chunkIndex);
  if (cachedUrl) {
    console.log(`KV cache hit for URL of object ${objectId}, chunk ${chunkIndex}`);
    const urlValidityResponse = await fetch(cachedUrl, { method: 'HEAD' });
    if (!urlValidityResponse.ok) {
      console.log(`Cached URL is invalid. Fetching new URL from Telegram.`);
      const newUrl = await fetchChunkUrlFromTelegram(env, botToken, chunkId);
      console.log(`New URL obtained for object ${objectId}, chunk ${chunkIndex}: ${newUrl}`);
      await cacheChunkUrl(env, objectId, chunkIndex, newUrl);
      return newUrl;
    }
    return cachedUrl;
  }

  console.log(`Cache miss for object ${objectId}, chunk ${chunkIndex}. Fetching new URL from Telegram.`);
  
  try {
    const newUrl = await fetchChunkUrlFromTelegram(env, botToken, chunkId);
    console.log(`New URL obtained for object ${objectId}, chunk ${chunkIndex}: ${newUrl}`);
    
    // Cache the new URL in KV storage
    await cacheChunkUrl(env, objectId, chunkIndex, newUrl);
    
    return newUrl;
  } catch (error) {
    console.error(`Failed to get chunk URL for object ${objectId}, chunk ${chunkIndex}:`, error);
    throw error;
  }
}

/**
 * Retrieves the data of a chunk.
 * This function checks the cache for the data of a chunk and fetches it from Telegram if not found.
 * @param env - The environment object containing configuration and bindings.
 * @param botToken - The Telegram bot token.
 * @param objectId - The ID of the file.
 * @param chunkIndex - The index of the chunk.
 * @returns A promise that resolves to the data of the chunk.
 */
export async function getChunkData(env: Env, botToken: string, objectId: string, chunkIndex: number): Promise<ArrayBuffer> {
  console.log(`Getting chunk data for object ${objectId}, chunk ${chunkIndex}`);

  // First, check if the chunk data is cached in the edge cache
  const cachedChunk = await getCachedChunk(env, objectId, chunkIndex);
  if (cachedChunk) {
    console.log(`Edge cache hit for object ${objectId}, chunk ${chunkIndex}`);
    return cachedChunk;
  }

  // If not in edge cache, get the chunk URL and fetch the data
  const metadata = await getObjectMetadata(env.FILES, objectId);
  if (!metadata) {
    throw new Error(`Metadata not found for object ${objectId}`);
  }

  const chunkId = metadata.chunkIds[chunkIndex];
  if (!chunkId) {
    throw new Error(`Chunk ID not found for object ${objectId}, chunk ${chunkIndex}`);
  }

  const chunkUrl = await getChunkUrl(env, botToken, objectId, chunkIndex, chunkId);
  
  console.log(`Fetching chunk data from URL: ${chunkUrl}`);
  const response = await fetch(chunkUrl, {
    headers: {
      'Accept-Encoding': 'br, gzip',
      'User-Agent': TG_USER_AGENT(env)
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch chunk data: ${response.statusText}`);
  }

  const chunkData = await response.arrayBuffer();

  // Cache the chunk data
  await cacheChunk(env, objectId, chunkIndex, chunkData, metadata.type);

  return chunkData;
}

/**
 * Pre-caches the URL of a single chunk.
 * This function pre-caches the URL of a single chunk to improve performance.
 * @param env - The environment object containing configuration and bindings.
 * @param objectId - The ID of the file.
 * @param chunkIndex - The index of the chunk.
 */
export async function preCacheSingleChunkUrl(env: Env, objectId: string, chunkIndex: number) {
  console.log(`Pre-caching single chunk URL for object ID: ${objectId}, chunk index: ${chunkIndex}`);
  try {
    const metadata = await getObjectMetadata(env.FILES, objectId);
    if (!metadata) {
      console.error(`Metadata not found for object ${objectId}`);
      return;
    }

    const chunkId = metadata.chunkIds[chunkIndex];
    if (!chunkId) {
      console.error(`Chunk index ${chunkIndex} not found for object ${objectId}`);
      return;
    }

    await getChunkUrl(env, env.BOT_TOKEN, objectId, chunkIndex, chunkId);
    console.log(`Pre-cached URL for object ${objectId}, chunk ${chunkIndex}`);
  } catch (error) {
    console.error(`Error pre-caching URL for object ${objectId}, chunk ${chunkIndex}:`, error);
  }
}

/**
 * Pre-caches the URLs of multiple chunks.
 * This function pre-caches the URLs of multiple chunks to improve performance.
 * @param env - The environment object containing configuration and bindings.
 * @param objectId - The ID of the file.
 * @param chunkIndices - The indices of the chunks to pre-cache.
 */
export async function preCacheMultipleChunkUrls(env: Env, objectId: string, chunkIndices: number[]): Promise<void> {
  console.log(`Pre-caching multiple chunk URLs for object ID: ${objectId}`);
  const preCachePromises = chunkIndices.map(index => preCacheSingleChunkUrl(env, objectId, index));
  await Promise.all(preCachePromises);
}

/**
 * Initiates the pre-caching of chunk URLs for a file.
 * This function initiates the pre-caching of chunk URLs for a file to improve performance.
 * @param env - The environment object containing configuration and bindings.
 * @param objectId - The ID of the file.
 */
export async function initiatePreCaching(env: Env, objectId: string) {
  console.log(`Initiating pre-caching for object ID: ${objectId}`);
  try {
    const metadata = await getObjectMetadata(env.FILES, objectId);
    if (!metadata) {
      console.error(`Metadata not found for object ${objectId}`);
      return;
    }

    const chunksToPreCache = Math.min(5, metadata.chunkIds.length);
    const chunkIndices = Array.from({length: chunksToPreCache}, (_, i) => i);
    await preCacheMultipleChunkUrls(env, objectId, chunkIndices);
    console.log(`Pre-caching completed for object ID: ${objectId}`);
  } catch (error) {
    console.error(`Error initiating pre-caching for object ID: ${objectId}:`, error);
  }
}

/**
 * Caches the URL of a chunk.
 * This function caches the URL of a chunk in KV storage.
 * @param env - The environment object containing configuration and bindings.
 * @param objectId - The ID of the file.
 * @param chunkIndex - The index of the chunk.
 * @param url - The URL of the chunk.
 */
async function cacheChunkUrl(env: Env, objectId: string, chunkIndex: number, url: string): Promise<void> {
  const key = `chunkUrl:${objectId}:${chunkIndex}`;
  await env.FILE_DOWNLOAD_INFO.put(key, url, { expirationTtl: 86400 }); // Cache for 24 hours
}

/**
 * Retrieves the cached URL of a chunk.
 * This function retrieves the cached URL of a chunk from KV storage.
 * @param env - The environment object containing configuration and bindings.
 * @param objectId - The ID of the file.
 * @param chunkIndex - The index of the chunk.
 * @returns A promise that resolves to the cached URL of the chunk, or null if not found.
 */
async function getCachedChunkUrl(env: Env, objectId: string, chunkIndex: number): Promise<string | null> {
  const key = `chunkUrl:${objectId}:${chunkIndex}`;
  return await env.FILE_DOWNLOAD_INFO.get(key);
}

export async function deleteMessageFromTelegram(botToken: string, chatId: string, messageId: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
    }),
  })
  if (!response.ok) {
    const error: any = await response.json()
    throw new Error(`Failed to delete message from Telegram: ${error.description}`)
  }
}
