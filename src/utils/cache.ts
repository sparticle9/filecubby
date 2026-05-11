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

export async function cacheChunk(env: Env, objectId: string, chunkIndex: number, chunkData: ArrayBuffer, mimeType: string): Promise<void> {
  const cacheKey = `${CACHE_DOMAIN}/chunk/${objectId}/${chunkIndex}`;
  const cache = (caches as any).default;
  
  const ttl = (parseInt(String(env.EDGE_CACHE_CHUNK_TTL), 10) * 3600) || 86400;
  const maxChunkSize = parseInt(String(env.EDGE_CACHE_MAX_CHUNK_SIZE), 10) * 1024 * 1024 || 52428800; // Default to 50MB if not set
  
  console.log(`Attempting to cache chunk: ${objectId}:${chunkIndex}, size: ${chunkData.byteLength}, MIME type: ${mimeType}`);
  console.log(`Cache key: ${cacheKey}`);

  // Check if the chunk size is below the maximum threshold
  if (chunkData.byteLength > maxChunkSize) {
    console.log(`Chunk too large to cache for object ID: ${objectId}, chunk index: ${chunkIndex}`);
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
  console.log(`Cached chunk: ${objectId}:${chunkIndex} with TTL: ${ttl} seconds`);
}

export async function getCachedChunk(env: Env, objectId: string, chunkIndex: number): Promise<ArrayBuffer | null> {
  const cacheKey = `${CACHE_DOMAIN}/chunk/${objectId}/${chunkIndex}`;
  const cache = (caches as any).default;
  console.log(`Attempting to retrieve cached chunk with key: ${cacheKey}`);
  const response = await cache.match(cacheKey);
  
  if (response) {
    console.log(`Cache hit for chunk: ${objectId}:${chunkIndex}`);
    return await response.arrayBuffer();
  }
  
  console.log(`Cache miss for chunk: ${objectId}:${chunkIndex}`);
  return null;
}

export async function clearAllCache(): Promise<void> {
  throw new Error('Cloudflare Cache API does not support listing all keys');
}

export async function getAllCacheKeys(): Promise<string[]> {
  return [];
}

export async function getCacheKeyCount(): Promise<number> {
  return 0;
}

export async function checkGlobalCacheStatus(env: Env, objectId: string): Promise<void> {
    const cache = (caches as any).default;
    const chunkCount = 10; // Adjust based on your typical file chunk count
  
    for (let i = 0; i < chunkCount; i++) {
      const response = await cache.match(`${CACHE_DOMAIN}/chunk/${objectId}/${i}`);
      if (response) {
        const data = await response.arrayBuffer();
        console.log(`Global cache hit for chunk ${i}, size: ${data.byteLength}`);
      } else {
        console.log(`Global cache miss for chunk ${i}`);
      }
    }
  }
