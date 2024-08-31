import { Env } from '../index'
import { saveFileMetadata, validateFileMetadata, getFileMetadata } from '../db'
import { generateFileId } from '../utils'
import { cacheChunkUrl } from '../db'

interface UploadResult {
  fileId: string
  url: string
  fullUrl: string
  filename: string
  chunkId: string
}

export async function uploadToTelegramDocument(botToken: string, channelId: string, file: File, fileName: string): Promise<string> {
  console.log(`Uploading file to Telegram: ${fileName}, size: ${file.size} bytes`);
  const formData = new FormData()
  formData.append('chat_id', channelId)
  
  const originalFileName = file.name || fileName
  
  console.log('uploadToTelegramDocument: Uploading file with name:', originalFileName)
  formData.append('document', file, originalFileName)

  console.log('uploadToTelegramDocument: Sending request to Telegram API')
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
    method: 'POST',
    body: formData,
  })

  const result = await response.json()
  console.log('uploadToTelegramDocument: Telegram API response:', JSON.stringify(result, null, 2))

  if (!result.ok) {
    console.error('Failed to upload to Telegram:', result.description)
    throw new Error(`Failed to upload to Telegram: ${result.description}`)
  }

  let fileId: string | undefined

  if (result.result.document) {
    fileId = result.result.document.file_id
  } else if (result.result.audio) {
    fileId = result.result.audio.file_id
  } else if (result.result.sticker) {
    fileId = result.result.sticker.file_id
  } else {
    console.error('Unexpected response format:', result)
    throw new Error('Failed to get file ID from Telegram: Unexpected response format')
  }

  if (!fileId) {
    console.error('File ID not found in response:', result)
    throw new Error('Failed to get file ID from Telegram: File ID not found')
  }

  console.log(`File uploaded to Telegram successfully, file ID: ${fileId}`);
  return fileId;
}

export async function uploadFile(
  env: Env,
  userId: string,
  file: File,
  fileType: string,
  expiryHours: number | null,
  isChunk: boolean,
  uploadToTelegramFn: (botToken: string, channelId: string, file: File, fileName: string) => Promise<string>,
  host: string,
  protocol: string
): Promise<UploadResult> {
  console.log(`Starting file upload process for user: ${userId}, file type: ${fileType}, is chunk: ${isChunk}`);
  // ... existing implementation ...
  console.log(`File upload completed. File ID: ${fileId}, Chunk ID: ${chunkId}`);
  return { fileId, url, fullUrl, filename: fileName, chunkId };
}

export async function fetchChunkUrl(botToken: string, chunkId: string, timeout: number): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${chunkId}`, {
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const result = await response.json();
    if (!result.ok) throw new Error(`Telegram API error: ${result.description}`);

    return `https://api.telegram.org/file/bot${botToken}/${result.result.file_path}`;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchChunkUrlWithRetry(botToken: string, chunkId: string, env: Env): Promise<string> {
  console.log(`Fetching chunk URL for chunk ID: ${chunkId}`);
  const maxRetries = env.CACHE_CHUNK_URL_MAX_RETRY;
  const timeout = env.CACHE_CHUNK_URL_TIMEOUT;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const url = await fetchChunkUrl(botToken, chunkId, timeout);
      console.log(`Chunk URL fetched successfully for chunk ID: ${chunkId}`);
      return url;
    } catch (error) {
      console.error(`Error fetching chunk URL (attempt ${attempt + 1}):`, error);
      if (attempt === maxRetries - 1) {
        console.error(`Max retries (${maxRetries}) reached for chunk ID: ${chunkId}`);
        throw error;
      }
      const delay = 1000 * Math.pow(2, attempt);
      console.log(`Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error(`Failed to fetch chunk URL after ${maxRetries} attempts`);
}

export async function preCacheChunkUrls(env: Env, fileId: string, chunkIndices?: number[]) {
  console.log(`Starting pre-cache process for file ID: ${fileId}`);
  try {
    const metadata = await getFileMetadata(env.FILES, `file:${fileId}`);
    if (!metadata) {
      console.error(`Metadata not found for file ${fileId}`);
      return;
    }

    const ttl = parseInt(env.CACHE_CHUNK_TTL, 10) * 3600 || 259200; // Default to 3 days in seconds

    const indicesToCache = chunkIndices || metadata.chunkIds.map((_, index) => index);

    const preCachePromises = indicesToCache.map(async (index) => {
      const chunkId = metadata.chunkIds[index];
      if (!chunkId) return;
      try {
        const url = await fetchChunkUrlWithRetry(env.BOT_TOKEN, chunkId, env);
        await cacheChunkUrl(env.FILE_DOWNLOAD_INFO, fileId, index, url, ttl);
        console.log(`Pre-cached URL for file ${fileId}, chunk ${index}`);
      } catch (error) {
        console.error(`Error pre-caching URL for file ${fileId}, chunk ${index}:`, error);
      }
    });

    await Promise.all(preCachePromises);
    console.log(`Completed pre-cache for file ${fileId}`);
  } catch (error) {
    console.error(`Error in preCacheChunkUrls for file ${fileId}:`, error);
  }
}

// ... keep other existing functions ...