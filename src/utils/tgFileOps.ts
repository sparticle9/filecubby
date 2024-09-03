import { Env } from '../index'
import { getFileMetadata } from '../db'
import { cacheChunk, getCachedChunk } from './cache'

const TG_USER_AGENT = (env: Env) => env.TG_USER_AGENT || 'TGPan-Server/1.0';

/**
 * Uploads a file or chunk to Telegram.
 * This function sends a file or chunk to the Telegram API and returns the file ID.
 * @param env - The environment object containing configuration and bindings.
 * @param botToken - The Telegram bot token.
 * @param chatId - The Telegram chat ID.
 * @param file - The file or chunk to upload.
 * @param fileName - The name of the file.
 * @param mimeType - The MIME type of the file.
 * @returns A promise that resolves to the file ID.
 */
export async function uploadToTelegramDocument(env: Env, botToken: string, chatId: string, file: File | Blob, fileName: string, mimeType: string): Promise<string> {
  console.log(`Uploading file to Telegram: ${fileName}, size: ${file instanceof File ? file.size : 'unknown'} bytes, type: ${mimeType}`);
  const formData = new FormData()
  formData.append('chat_id', chatId)
  
  // Use the provided fileName instead of generating one
  formData.append('document', file, fileName);

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

  return result.result.document.file_id;
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
  const initialTimeout = parseInt(env.CACHE_CHUNK_URL_TIMEOUT, 10) || 10000;
  const maxRetries = parseInt(env.CACHE_CHUNK_URL_MAX_RETRY, 10) || 5;

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

      const result = await response.json();
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
 * @param fileId - The ID of the file.
 * @param chunkIndex - The index of the chunk.
 * @param chunkId - The ID of the chunk.
 * @returns A promise that resolves to the URL of the chunk.
 */
export async function getChunkUrl(env: Env, botToken: string, fileId: string, chunkIndex: number, chunkId: string): Promise<string> {
  console.log(`Getting chunk URL for file ${fileId}, chunk ${chunkIndex}`);

  // Check for cached URL in KV storage
  // if there is a hit, you need to first check if the url is valid, if not, then fetch the url from telegram. you need to do this because the url might be expired.
  // the most efficient way is to make a HEAD request to the url, if it fails, then fetch the url from telegram.

  const cachedUrl = await getCachedChunkUrl(env, fileId, chunkIndex);
  if (cachedUrl) {
    console.log(`KV cache hit for URL of file ${fileId}, chunk ${chunkIndex}`);
    const urlValidityResponse = await fetch(cachedUrl, { method: 'HEAD' });
    if (!urlValidityResponse.ok) {
      console.log(`Cached URL is invalid. Fetching new URL from Telegram.`);
      const newUrl = await fetchChunkUrlFromTelegram(env, botToken, chunkId);
      console.log(`New URL obtained for file ${fileId}, chunk ${chunkIndex}: ${newUrl}`);
      await cacheChunkUrl(env, fileId, chunkIndex, newUrl);
      return newUrl;
    }
    return cachedUrl;
  }

  console.log(`Cache miss for file ${fileId}, chunk ${chunkIndex}. Fetching new URL from Telegram.`);
  
  try {
    const newUrl = await fetchChunkUrlFromTelegram(env, botToken, chunkId);
    console.log(`New URL obtained for file ${fileId}, chunk ${chunkIndex}: ${newUrl}`);
    
    // Cache the new URL in KV storage
    await cacheChunkUrl(env, fileId, chunkIndex, newUrl);
    
    return newUrl;
  } catch (error) {
    console.error(`Failed to get chunk URL for file ${fileId}, chunk ${chunkIndex}:`, error);
    throw error;
  }
}

/**
 * Retrieves the data of a chunk.
 * This function checks the cache for the data of a chunk and fetches it from Telegram if not found.
 * @param env - The environment object containing configuration and bindings.
 * @param botToken - The Telegram bot token.
 * @param fileId - The ID of the file.
 * @param chunkIndex - The index of the chunk.
 * @returns A promise that resolves to the data of the chunk.
 */
export async function getChunkData(env: Env, botToken: string, fileId: string, chunkIndex: number): Promise<ArrayBuffer> {
  console.log(`Getting chunk data for file ${fileId}, chunk ${chunkIndex}`);

  // First, check if the chunk data is cached in the edge cache
  const cachedChunk = await getCachedChunk(env, fileId, chunkIndex);
  if (cachedChunk) {
    console.log(`Edge cache hit for file ${fileId}, chunk ${chunkIndex}`);
    return await cachedChunk.arrayBuffer();
  }

  // If not in edge cache, get the chunk URL and fetch the data
  const metadata = await getFileMetadata(env.FILES, `file:${fileId}`);
  if (!metadata) {
    throw new Error(`Metadata not found for file ${fileId}`);
  }

  const chunkId = metadata.chunkIds[chunkIndex];
  if (!chunkId) {
    throw new Error(`Chunk ID not found for file ${fileId}, chunk ${chunkIndex}`);
  }

  const chunkUrl = await getChunkUrl(env, botToken, fileId, chunkIndex, chunkId);
  
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
  await cacheChunk(env, fileId, chunkIndex, chunkData);

  return chunkData;
}

/**
 * Pre-caches the URL of a single chunk.
 * This function pre-caches the URL of a single chunk to improve performance.
 * @param env - The environment object containing configuration and bindings.
 * @param fileId - The ID of the file.
 * @param chunkIndex - The index of the chunk.
 */
export async function preCacheSingleChunkUrl(env: Env, fileId: string, chunkIndex: number) {
  console.log(`Pre-caching single chunk URL for file ID: ${fileId}, chunk index: ${chunkIndex}`);
  try {
    const metadata = await getFileMetadata(env.FILES, `file:${fileId}`);
    if (!metadata) {
      console.error(`Metadata not found for file ${fileId}`);
      return;
    }

    const chunkId = metadata.chunkIds[chunkIndex];
    if (!chunkId) {
      console.error(`Chunk index ${chunkIndex} not found for file ${fileId}`);
      return;
    }

    await getChunkUrl(env, env.BOT_TOKEN, fileId, chunkIndex, chunkId);
    console.log(`Pre-cached URL for file ${fileId}, chunk ${chunkIndex}`);
  } catch (error) {
    console.error(`Error pre-caching URL for file ${fileId}, chunk ${chunkIndex}:`, error);
  }
}

/**
 * Pre-caches the URLs of multiple chunks.
 * This function pre-caches the URLs of multiple chunks to improve performance.
 * @param env - The environment object containing configuration and bindings.
 * @param fileId - The ID of the file.
 * @param chunkIndices - The indices of the chunks to pre-cache.
 */
export async function preCacheMultipleChunkUrls(env: Env, fileId: string, chunkIndices: number[]): Promise<void> {
  console.log(`Pre-caching multiple chunk URLs for file ID: ${fileId}`);
  const preCachePromises = chunkIndices.map(index => preCacheSingleChunkUrl(env, fileId, index));
  await Promise.all(preCachePromises);
}

/**
 * Initiates the pre-caching of chunk URLs for a file.
 * This function initiates the pre-caching of chunk URLs for a file to improve performance.
 * @param env - The environment object containing configuration and bindings.
 * @param fileId - The ID of the file.
 */
export async function initiatePreCaching(env: Env, fileId: string) {
  console.log(`Initiating pre-caching for file ID: ${fileId}`);
  try {
    const metadata = await getFileMetadata(env.FILES, `file:${fileId}`);
    if (!metadata) {
      console.error(`Metadata not found for file ${fileId}`);
      return;
    }

    const chunksToPreCache = Math.min(5, metadata.chunkIds.length);
    const chunkIndices = Array.from({length: chunksToPreCache}, (_, i) => i);
    await preCacheMultipleChunkUrls(env, fileId, chunkIndices);
    console.log(`Pre-caching completed for file ID: ${fileId}`);
  } catch (error) {
    console.error(`Error initiating pre-caching for file ID: ${fileId}:`, error);
  }
}

/**
 * Caches the URL of a chunk.
 * This function caches the URL of a chunk in KV storage.
 * @param env - The environment object containing configuration and bindings.
 * @param fileId - The ID of the file.
 * @param chunkIndex - The index of the chunk.
 * @param url - The URL of the chunk.
 */
async function cacheChunkUrl(env: Env, fileId: string, chunkIndex: number, url: string): Promise<void> {
  const key = `chunkUrl:${fileId}:${chunkIndex}`;
  await env.FILE_DOWNLOAD_INFO.put(key, url, { expirationTtl: 86400 }); // Cache for 24 hours
}

/**
 * Retrieves the cached URL of a chunk.
 * This function retrieves the cached URL of a chunk from KV storage.
 * @param env - The environment object containing configuration and bindings.
 * @param fileId - The ID of the file.
 * @param chunkIndex - The index of the chunk.
 * @returns A promise that resolves to the cached URL of the chunk, or null if not found.
 */
async function getCachedChunkUrl(env: Env, fileId: string, chunkIndex: number): Promise<string | null> {
  const key = `chunkUrl:${fileId}:${chunkIndex}`;
  return await env.FILE_DOWNLOAD_INFO.get(key);
}