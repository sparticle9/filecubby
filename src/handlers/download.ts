import { Context } from 'hono'
import { Env } from '../index'
import { getFileMetadata } from '../db'
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
  const fileId = c.req.param('fileId');
  const dlParam = c.req.query('dl');
  
  if (typeof fileId !== 'string' || fileId.length === 0) {
    console.error('Invalid file ID:', fileId);
    return c.json({ Code: 0, Message: 'Invalid file ID' }, 400);
  }

  console.log(`Handling file download for file ID: ${fileId}`);

  try {
    const metadata = await getFileMetadata(c.env.FILES, `file:${fileId}`);
    if (!metadata) {
      console.error(`File metadata not found or invalid for file ID: ${fileId}`);
      return c.json({ Code: 0, Message: 'File not found or metadata is invalid' }, 404);
    }

    // Determine if the content should be displayed inline
    const shouldDisplayInline = INLINE_CONTENT_TYPES.includes(metadata.type) && dlParam !== '1';

    // Set appropriate headers
    c.header('Content-Type', metadata.type);
    c.header('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    if (shouldDisplayInline) {
      c.header('Content-Disposition', `inline; filename="${encodeURIComponent(metadata.name)}"`);
    } else {
      c.header('Content-Disposition', `attachment; filename="${encodeURIComponent(metadata.name)}"`);
    }

    // Create a ReadableStream to stream the file chunks
    const stream = new ReadableStream({
      async start(controller) {
        for (let i = 0; i < metadata.chunks; i++) {
          // Try to get cached chunk data first
          const cachedChunk = await getCachedChunk(c.env, fileId, i);
          if (cachedChunk) {
            console.log(`Using cached chunk for file ${fileId}, chunk ${i}`);
            controller.enqueue(new Uint8Array(cachedChunk));
            continue;
          }

          console.log(`Cache miss for file ${fileId}, chunk ${i}. Fetching from Telegram.`);
          // If not cached, get the chunk URL from the separate KV
          const chunkUrl = await getChunkUrl(c.env, c.env.BOT_TOKEN, fileId, i, metadata.chunkIds[i]);
          
          // Fetch the chunk data using the URL
          const response = await fetch(chunkUrl);
          if (!response.ok) {
            throw new Error(`Failed to fetch chunk data: ${response.statusText}`);
          }
          const chunkData = await response.arrayBuffer();
          controller.enqueue(new Uint8Array(chunkData));

          // Cache the fetched chunk data
          await cacheChunk(c.env, fileId, i, chunkData, metadata.type);          
        }
        controller.close();
      },
    });

    return c.body(stream);
  } catch (error) {
    console.error('Error handling file download:', error);
    return c.json({ Code: 0, Message: 'Failed to download file', Error: error.message }, 500);
  }
}

export async function handlePartialDownload(c: Context<{ Bindings: Env }>, fileId: string) {
  console.log(`Handling partial file download for file ID: ${fileId}`);

  try {
    // Retrieve file metadata
    const metadata = await getFileMetadata(c.env.FILES, `file:${fileId}`);
    if (!metadata) {
      console.error(`File metadata not found for file ID: ${fileId}`);
      return c.json({ Code: 0, Message: 'File not found' }, 404);
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
            const chunkData = await getChunkData(c.env, c.env.BOT_TOKEN, fileId, i);
            const chunkStart = i === startChunk ? start % (metadata.size / metadata.chunks) : 0;
            const chunkEnd = i === endChunk ? (end % (metadata.size / metadata.chunks)) + 1 : chunkData.byteLength;
            controller.enqueue(new Uint8Array(chunkData.slice(chunkStart, chunkEnd)));
          } catch (error) {
            console.error(`Error fetching chunk ${i} for file ${fileId}:`, error);
            controller.error(error);
            return;
          }
        }
        controller.close();
      }
    });

    // Log partial download analytics
    console.log(`Partial file download initiated for file ID: ${fileId}, range: ${start}-${end}`);

    // Return the stream as the response
    return c.newResponse(stream);

  } catch (error) {
    console.error(`Error handling partial file download for file ID ${fileId}:`, error);
    return c.json({ Code: 0, Message: 'Failed to download file' }, 500);
  }
}