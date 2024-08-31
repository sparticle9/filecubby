import { Context } from 'hono'
import { Env } from '../index'
import { getFileMetadata } from '../db'
import { writeAnalytics } from '../utils/analytics'
import { getCachedChunkUrl, cacheChunkUrl } from '../db'
import { isValidDownloadUrl } from '../utils/urlValidator';
import { fetchChunkUrlWithRetry } from '../utils/tgFileOps';

export async function downloadFile(c: Context<{ Bindings: Env }>) {
  const startTime = Date.now();
  const fileId = c.req.param('fileId')
  const forceDownload = c.req.query('dl') === 'true'

  console.log(`Download process started for file ID: ${fileId}`);

  try {
    const metadataStartTime = Date.now();
    const metadata = await getFileMetadata(c.env.FILES, `file:${fileId}`);
    const metadataTime = Date.now() - metadataStartTime;
    console.log(`Time to get metadata: ${metadataTime}ms`);

    if (!metadata) {
      console.log(`File not found: ${fileId}`);
      return c.json({ Code: 0, Message: 'File not found' }, 404);
    }

    console.log(`File metadata retrieved:`, JSON.stringify(metadata, null, 2));

    // Check metadata consistency
    if (metadata.status !== 'completed' || metadata.chunkIds.some(id => id === null)) {
      console.log(`Incomplete upload for file: ${fileId}`);
      return c.json({ Code: 0, Message: 'File upload is incomplete', Status: metadata.status }, 405);
    }

    const { chunkIds, fileType, filename, size } = metadata;

    const headersPrepStartTime = Date.now();
    const headers: HeadersInit = {
      'Content-Type': fileType || 'application/octet-stream',
      'Content-Length': size.toString(),
      'Content-Disposition': forceDownload || !['audio', 'video', 'image', 'application/pdf'].some(type => fileType.startsWith(type))
        ? `attachment; filename="${encodeURIComponent(filename)}"`
        : `inline; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'public, max-age=31536000',
    }
    const headersPrepTime = Date.now() - headersPrepStartTime;
    console.log(`Time to prepare headers: ${headersPrepTime}ms`);

    const ttl = parseInt(c.env.CACHE_CHUNK_TTL, 10) * 3600 || 259200; // Default to 3 days in seconds

    let totalChunkUrlTime = 0;
    let totalFetchTime = 0;
    const streamSetupStartTime = Date.now();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for (let i = 0; i < chunkIds.length; i++) {
            const chunkStartTime = Date.now();
            console.log(`Processing chunk ${i + 1}/${chunkIds.length}`);
            const chunkUrlStartTime = Date.now();
            let chunkUrl;
            try {
              chunkUrl = await getChunkUrl(c.env.BOT_TOKEN, c.env.FILE_DOWNLOAD_INFO, fileId, i, chunkIds[i], ttl);
            } catch (error) {
              console.error(`Failed to get chunk URL for file ${fileId}, chunk ${i}:`, error);
              throw new Error(`Failed to get chunk URL for file ${fileId}, chunk ${i}`);
            }
            const chunkUrlTime = Date.now() - chunkUrlStartTime;
            totalChunkUrlTime += chunkUrlTime;
            console.log(`Time to get chunk URL: ${chunkUrlTime}ms`);

            const fetchStartTime = Date.now();
            let response;
            try {
              response = await fetchWithRetry(chunkUrl);
            } catch (error) {
              console.error(`Failed to fetch chunk for file ${fileId}, chunk ${i}:`, error);
              throw new Error(`Failed to fetch chunk for file ${fileId}, chunk ${i}`);
            }
            const fetchTime = Date.now() - fetchStartTime;
            totalFetchTime += fetchTime;
            console.log(`Time to fetch chunk: ${fetchTime}ms`);

            const reader = response.body!.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
          }
          controller.close();
        } catch (error) {
          console.error(`Error in stream processing: ${error}`);
          controller.error(error);
        }
      }
    });
    const streamSetupTime = Date.now() - streamSetupStartTime;
    console.log(`Time to set up stream: ${streamSetupTime}ms`);

    const response = new Response(stream, { status: 200, headers: headers });

    // Log summary after stream processing
    const totalTime = Date.now() - startTime;
    const processingTime = totalTime - totalFetchTime;
    const downloadSpeed = totalFetchTime > 0 ? (size / totalFetchTime) * 1000 : 0; // bytes per second

    console.log(`
Download Task Summary:
- File ID: ${fileId}
- File Size: ${size} bytes
- File Type: ${fileType}
- Number of Chunks: ${chunkIds.length}
- Metadata Retrieval Time: ${metadataTime}ms
- Headers Preparation Time: ${headersPrepTime}ms
- Total Chunk URL Retrieval Time: ${totalChunkUrlTime}ms
- Total Chunk Fetch Time: ${totalFetchTime}ms
- Stream Setup Time: ${streamSetupTime}ms
- Total Processing Time: ${processingTime}ms
- Total Download Time: ${totalFetchTime}ms
- Average Download Speed: ${downloadSpeed.toFixed(2)} bytes/second
- Total Request Time: ${totalTime}ms
    `);

    await writeAnalytics(c.env.ANALYTICS_ENGINE, {
      action: 'download',
      fileId: fileId,
      fileType: fileType,
      fileSize: size,
      chunkCount: chunkIds.length,
      metadataTime: metadataTime,
      headersPrepTime: headersPrepTime,
      chunkUrlTime: totalChunkUrlTime,
      chunkFetchTime: totalFetchTime,
      streamSetupTime: streamSetupTime,
      totalTime: totalTime
    });

    return response;
  } catch (error) {
    console.error(`Error in downloadFile for file ID ${fileId}:`, error);
    const totalTime = Date.now() - startTime;
    await writeAnalytics(c.env.ANALYTICS_ENGINE, {
      action: 'error',
      errorType: 'download_error',
      fileId: fileId,
      totalTime: totalTime
    });
    return c.json({ Code: 0, Message: `Failed to download file: ${error.message}` }, 500);
  }
}

async function getChunkUrl(botToken: string, fileDownloadInfo: KVNamespace, fileId: string, chunkIndex: number, chunkId: string, ttl: number): Promise<string> {
  console.log(`Getting chunk URL for file ${fileId}, chunk ${chunkIndex}`);
  
  try {
    const cachedUrl = await getCachedChunkUrl(fileDownloadInfo, fileId, chunkIndex);
    if (cachedUrl) {
      console.log(`Using cached URL for file ${fileId}, chunk ${chunkIndex}`);
      return cachedUrl;
    }
  } catch (error) {
    console.error(`Error retrieving cached URL for file ${fileId}, chunk ${chunkIndex}:`, error);
  }

  console.log(`Cached URL not found or invalid for file ${fileId}, chunk ${chunkIndex}. Fetching new URL.`);
  
  try {
    const newUrl = await fetchChunkUrlWithRetry(botToken, chunkId);
    if (!newUrl) {
      throw new Error(`Failed to get a valid URL for chunk ${chunkIndex}`);
    }
    console.log(`New URL obtained for file ${fileId}, chunk ${chunkIndex}: ${newUrl}`);
    
    try {
      await cacheChunkUrl(fileDownloadInfo, fileId, chunkIndex, newUrl, ttl);
      console.log(`Cached new URL for file ${fileId}, chunk ${chunkIndex}`);
    } catch (cacheError) {
      console.error(`Failed to cache URL for file ${fileId}, chunk ${chunkIndex}:`, cacheError);
      // Even if caching fails, we can still return the URL
    }
    
    return newUrl;
  } catch (error) {
    console.error(`Failed to get chunk URL for file ${fileId}, chunk ${chunkIndex}:`, error);
    throw error;
  }
}

async function fetchWithRetry(url: string, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log(`Fetching URL (attempt ${attempt + 1}): ${url}`);
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
      
      console.log(`HTTP error: ${response.status}. Attempt ${attempt + 1} of ${maxRetries}`);
      
      if (attempt === maxRetries - 1) {
        throw new Error(`Failed to fetch after ${maxRetries} attempts. Last status: ${response.status}`);
      }
    } catch (error) {
      console.error(`Network error on attempt ${attempt + 1}:`, error);
      if (attempt === maxRetries - 1) {
        throw error;
      }
    }
    
    const delay = 1000 * Math.pow(2, attempt);
    console.log(`Retrying in ${delay}ms...`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  throw new Error('Max retries reached');
}