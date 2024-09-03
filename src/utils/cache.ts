import { Env } from '../index';

const ALLOWED_MIME_TYPES_FOR_CACHING = [
  'video/mp4',
  'audio/mpeg',
  'audio/mp3',
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/json',
  'application/pdf',
  'text/plain',
  // Add more content types as needed
];

const CACHE_DOMAIN = 'https://worker.domain';

export async function cacheChunk(env: Env, fileId: string, chunkIndex: number, chunkData: ArrayBuffer, mimeType: string): Promise<void> {
  const cacheKey = `${CACHE_DOMAIN}/chunk/${fileId}/${chunkIndex}`;
  const cache = caches.default;
  
  const ttl = (parseInt(env.EDGE_CACHE_CHUNK_TTL, 10) * 3600) || 86400;
  const maxChunkSize = parseInt(env.EDGE_CACHE_MAX_CHUNK_SIZE, 10) * 1024 * 1024 || 52428800; // Default to 50MB if not set
  
  console.log(`Attempting to cache chunk: ${fileId}:${chunkIndex}, size: ${chunkData.byteLength}, MIME type: ${mimeType}`);
  console.log(`Cache key: ${cacheKey}`);

  // Check if the chunk size is below the maximum threshold
  if (chunkData.byteLength > maxChunkSize) {
    console.log(`Chunk too large to cache for file ID: ${fileId}, chunk index: ${chunkIndex}`);
    return;
  }

  // Check if the MIME type is allowed for caching
  if (!ALLOWED_MIME_TYPES_FOR_CACHING.includes(mimeType)) {
    console.log(`MIME type not allowed for caching: ${mimeType}`);
    return;
  }

  const response = new Response(chunkData, {
    headers: {
      'Cache-Control': `public, max-age=${ttl}`,
      'Content-Type': 'application/octet-stream'
    }
  });
  
  await cache.put(cacheKey, response);
  console.log(`Cached chunk: ${fileId}:${chunkIndex} with TTL: ${ttl} seconds`);
}

export async function getCachedChunk(env: Env, fileId: string, chunkIndex: number): Promise<ArrayBuffer | null> {
  const cacheKey = `${CACHE_DOMAIN}/chunk/${fileId}/${chunkIndex}`;
  const cache = caches.default;
  console.log(`Attempting to retrieve cached chunk with key: ${cacheKey}`);
  const response = await cache.match(cacheKey);
  
  if (response) {
    console.log(`Cache hit for chunk: ${fileId}:${chunkIndex}`);
    return await response.arrayBuffer();
  }
  
  console.log(`Cache miss for chunk: ${fileId}:${chunkIndex}`);
  return null;
}

export async function clearAllCache(): Promise<void> {
  const cache = caches.default;
  const keys = await cache.keys();
  for (const key of keys) {
    await cache.delete(key);
  }
  console.log('All cache cleared');
}

export async function getAllCacheKeys(): Promise<string[]> {
  const cache = caches.default;
  const keys = await cache.keys();
  return keys.map(key => key.url);
}

export async function getCacheKeyCount(): Promise<number> {
  const cache = caches.default;
  const keys = await cache.keys();
  return keys.length;
}

export async function checkGlobalCacheStatus(env: Env, fileId: string): Promise<void> {
    const cache = caches.default;
    const chunkCount = 10; // Adjust based on your typical file chunk count
  
    for (let i = 0; i < chunkCount; i++) {
      const cacheKey = new Request(`${CACHE_DOMAIN}/chunk/${fileId}/${i}`);
      const response = await cache.match(cacheKey);
      if (response) {
        const data = await response.arrayBuffer();
        console.log(`Global cache hit for chunk ${i}, size: ${data.byteLength}`);
      } else {
        console.log(`Global cache miss for chunk ${i}`);
      }
    }
  }