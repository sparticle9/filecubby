import { Context } from 'hono'
import { Env } from '../index'
import { getObjectMetadata } from '../db'
import { getChunkData, getChunkUrl } from '../utils/tgFileOps'
import { getCachedChunk, cacheChunk } from '../utils/cache'

const INLINE_CONTENT_TYPES = [
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/mp3',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/json',
  'application/pdf',
  'text/plain',
  // Add more content types as needed
];

export async function handleFileDownload(c: Context<{ Bindings: Env }>) {
  const objectId = c.req.param('objectId');
  const dlParam = c.req.query('dl');
  
  if (typeof objectId !== 'string' || objectId.length === 0) {
    console.error('Invalid object ID:', objectId);
    return c.json({ Code: 0, Message: 'Invalid object ID' }, 400);
  }

  console.log(`Handling object download for object ID: ${objectId}`);

  try {
    const metadata = await getObjectMetadata(c.env.FILES, objectId);
    if (!metadata) {
      console.error(`Object metadata not found or invalid for object ID: ${objectId}`);
      return c.json({ Code: 0, Message: 'Object not found or metadata is invalid' }, 404);
    }

    // Determine if the content should be displayed inline
    const shouldDisplayInline = INLINE_CONTENT_TYPES.includes(metadata.type) && dlParam !== '1';
    const disposition = shouldDisplayInline ? 'inline' : 'attachment';

    if (c.req.header('Range')) {
      return streamRange(c, objectId, metadata, disposition);
    }

    setDownloadHeaders(c, metadata, disposition);

    // Create a ReadableStream to stream the file chunks
    const stream = new ReadableStream({
      async start(controller) {
        for (let i = 0; i < metadata.chunks; i++) {
          // Try to get cached chunk data first
          const cachedChunk = await getCachedChunk(c.env, objectId, i);
          if (cachedChunk) {
            console.log(`Using cached chunk for object ${objectId}, chunk ${i}`);
            controller.enqueue(new Uint8Array(cachedChunk));
            continue;
          }

          console.log(`Cache miss for object ${objectId}, chunk ${i}. Fetching from Telegram.`);
          // If not cached, get the chunk URL from the separate KV
          const chunkUrl = await getChunkUrl(c.env, c.env.BOT_TOKEN, objectId, i, metadata.chunkIds[i]);
          
          // Fetch the chunk data using the URL
          const response = await fetch(chunkUrl);
          if (!response.ok) {
            throw new Error(`Failed to fetch chunk data: ${response.statusText}`);
          }
          const chunkData = await response.arrayBuffer();
          controller.enqueue(new Uint8Array(chunkData));

          // Cache the fetched chunk data
          await cacheChunk(c.env, objectId, i, chunkData, metadata.type);          
        }
        controller.close();
      },
    });

    return c.body(stream);
  } catch (error) {
    console.error('Error handling object download:', error);
    return c.json({ Code: 0, Message: 'Failed to download object', Error: error.message }, 500);
  }
}

export async function handleFileHead(c: Context<{ Bindings: Env }>) {
  const objectId = c.req.param('objectId');
  const dlParam = c.req.query('dl');

  if (typeof objectId !== 'string' || objectId.length === 0) {
    return c.body(null, 400);
  }

  const metadata = await getObjectMetadata(c.env.FILES, objectId);
  if (!metadata) {
    return c.body(null, 404);
  }

  const shouldDisplayInline = INLINE_CONTENT_TYPES.includes(metadata.type) && dlParam !== '1';
  setDownloadHeaders(c, metadata, shouldDisplayInline ? 'inline' : 'attachment');
  return c.body(null, 200);
}

function setDownloadHeaders(c: Context<{ Bindings: Env }>, metadata: any, disposition: string) {
  c.header('Content-Type', metadata.type || 'application/octet-stream');
  c.header('Cache-Control', 'public, max-age=3600');
  c.header('Content-Disposition', `${disposition}; filename="${encodeURIComponent(metadata.name)}"`);
  c.header('Content-Length', metadata.size.toString());
  c.header('Accept-Ranges', 'bytes');
}

async function streamRange(c: Context<{ Bindings: Env }>, objectId: string, metadata: any, disposition: string) {
  const rangeHeader = c.req.header('Range') || '';
  const range = parseRange(rangeHeader, metadata.size);
  if (!range) {
    return c.body(null, 416, {
      'Content-Range': `bytes */${metadata.size}`,
      'Accept-Ranges': 'bytes',
    });
  }

  const chunkSize = effectiveChunkSize(c.env, metadata);
  const startChunk = Math.floor(range.start / chunkSize);
  const endChunk = Math.floor(range.end / chunkSize);
  const contentLength = range.end - range.start + 1;

  const stream = new ReadableStream({
    async start(controller) {
      for (let i = startChunk; i <= endChunk; i++) {
        const chunkData = await getChunkData(c.env, c.env.BOT_TOKEN, objectId, i);
        const chunkStartByte = i * chunkSize;
        const sliceStart = Math.max(0, range.start - chunkStartByte);
        const sliceEnd = Math.min(chunkData.byteLength, range.end - chunkStartByte + 1);
        controller.enqueue(new Uint8Array(chunkData.slice(sliceStart, sliceEnd)));
      }
      controller.close();
    },
  });

  return c.body(stream, 206, {
    'Content-Type': metadata.type || 'application/octet-stream',
    'Content-Disposition': `${disposition}; filename="${encodeURIComponent(metadata.name)}"`,
    'Content-Range': `bytes ${range.start}-${range.end}/${metadata.size}`,
    'Content-Length': contentLength.toString(),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
  });
}

function parseRange(rangeHeader: string, size: number): { start: number; end: number } | null {
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || size <= 0) return null;

  let start: number;
  let end: number;

  if (match[1] === '' && match[2] !== '') {
    const suffixLength = parseInt(match[2], 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = parseInt(match[1], 10);
    end = match[2] ? parseInt(match[2], 10) : size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) {
    return null;
  }

  return { start, end: Math.min(end, size - 1) };
}

function effectiveChunkSize(env: Env, metadata: any): number {
  if (typeof metadata.chunkSize === 'number' && metadata.chunkSize > 0) {
    return metadata.chunkSize;
  }
  const configuredChunkSize = parseInt(String(env.MAX_CHUNK_SIZE), 10);
  if (Number.isFinite(configuredChunkSize) && configuredChunkSize > 0) {
    return configuredChunkSize;
  }
  return Math.ceil(metadata.size / metadata.chunks);
}

export async function handlePartialDownload(c: Context<{ Bindings: Env }>) {
  const objectId = c.req.param('objectId');
  console.log(`Handling partial object download for object ID: ${objectId}`);

  try {
    // Retrieve file metadata
    const metadata = await getObjectMetadata(c.env.FILES, objectId);
    if (!metadata) {
      console.error(`Object metadata not found for object ID: ${objectId}`);
      return c.json({ Code: 0, Message: 'Object not found' }, 404);
    }

    // Parse Range header
    const rangeHeader = c.req.header('Range');
    if (!rangeHeader) {
      console.error('Range header is missing');
      return c.json({ Code: 0, Message: 'Range header is required for partial download' }, 400);
    }

    const match = rangeHeader.match(/bytes=(\d+)-(\d+)?/);
    if (!match) {
      console.error('Invalid Range header format');
      return c.json({ Code: 0, Message: 'Invalid Range header format' }, 400);
    }

    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : metadata.size - 1;

    if (start >= metadata.size || end >= metadata.size || start > end) {
      console.error('Invalid range requested');
      return c.json({ Code: 0, Message: 'Invalid range' }, 416);
    }

    // Calculate which chunks are needed
    const startChunk = Math.floor(start / (metadata.size / metadata.chunks));
    const endChunk = Math.floor(end / (metadata.size / metadata.chunks));

    // Set response headers
    c.header('Content-Type', metadata.type || 'application/octet-stream');
    c.header('Content-Disposition', `attachment; filename="${encodeURIComponent(metadata.name)}"`);
    c.header('Content-Range', `bytes ${start}-${end}/${metadata.size}`);
    c.header('Content-Length', (end - start + 1).toString());
    c.header('Accept-Ranges', 'bytes');
    c.status(206); // Partial Content

    // Create a ReadableStream to stream the file chunks
    const stream = new ReadableStream({
      async start(controller) {
        for (let i = startChunk; i <= endChunk; i++) {
          try {
            const chunkData = await getChunkData(c.env, c.env.BOT_TOKEN, objectId, i);
            const chunkStart = i === startChunk ? start % (metadata.size / metadata.chunks) : 0;
            const chunkEnd = i === endChunk ? (end % (metadata.size / metadata.chunks)) + 1 : chunkData.byteLength;
            controller.enqueue(new Uint8Array(chunkData.slice(chunkStart, chunkEnd)));
          } catch (error) {
            console.error(`Error fetching chunk ${i} for object ${objectId}:`, error);
            controller.error(error);
            return;
          }
        }
        controller.close();
      }
    });

    // Log partial download analytics
    console.log(`Partial object download initiated for object ID: ${objectId}, range: ${start}-${end}`);

    // Return the stream as the response
    return c.newResponse(stream);

  } catch (error) {
    console.error(`Error handling partial object download for object ID ${objectId}:`, error);
    return c.json({ Code: 0, Message: 'Failed to download object' }, 500);
  }
}
