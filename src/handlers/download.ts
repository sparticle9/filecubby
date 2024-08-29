import { Context } from 'hono'
import { Env } from '../index'
import { getFileMetadata } from '../db'
import { writeAnalytics } from '../utils/analytics'

export async function downloadFile(c: Context<{ Bindings: Env }>) {
  const startTime = Date.now();
  const fileId = c.req.param('fileId')
  const forceDownload = c.req.query('dl') === 'true'

  try {
    const metadata = await getFileMetadata(c.env.METADB, fileId)
    if (!metadata) {
      return c.json({ Code: 0, Message: 'File not found' }, 404)
    }

    const isInlineViewable = ['audio', 'video', 'image', 'application/pdf'].some(type => metadata.fileType.startsWith(type))

    const headers: HeadersInit = {
      'Content-Type': metadata.fileType || 'application/octet-stream',
      'Content-Length': metadata.size.toString(),
    }

    if (forceDownload || !isInlineViewable) {
      headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(metadata.filename)}"`
    } else {
      headers['Content-Disposition'] = `inline; filename="${encodeURIComponent(metadata.filename)}"`
    }

    let response: Response;

    if (metadata.chunks > 1) {
      // Handle chunked file
      response = await streamChunkedFile(c.env.BOT_TOKEN, metadata, parseInt(c.env.MAX_RETRY_FROM_TG))
    } else {
      // Handle single file
      const fileUrl = await getFileUrl(c.env.BOT_TOKEN, metadata.chunkIds[0])
      response = await fetch(fileUrl)
    }

    const responseTime = Date.now() - startTime;
    await writeAnalytics(c.env.ANALYTICS_ENGINE, {
      action: 'download',
      fileType: metadata.fileType,
      fileSize: metadata.size,
      responseTime,
      isChunked: metadata.chunks > 1
    });

    return new Response(response.body, {
      status: 200,
      headers: { ...headers, ...response.headers }
    })
  } catch (error) {
    console.error('Error in downloadFile:', error);
    const responseTime = Date.now() - startTime;
    await writeAnalytics(c.env.ANALYTICS_ENGINE, {
      action: 'error',
      errorType: 'download_error',
      responseTime
    });
    return c.json({ Code: 0, Message: `Failed to download file: ${error.message}` }, 500);
  }
}

async function getFileUrl(botToken: string, fileId: string): Promise<string> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`)
  const result = await response.json()
  if (!result.ok) {
    throw new Error(`Failed to get file from Telegram: ${result.description}`)
  }
  return `https://api.telegram.org/file/bot${botToken}/${result.result.file_path}`
}

async function streamChunkedFile(botToken: string, metadata: any, maxRetries: number): Promise<Response> {
  let bytesStreamed = 0;
  const totalSize = metadata.size;
  let currentChunkIndex = 0;

  const stream = new ReadableStream({
    async pull(controller) {
      if (bytesStreamed >= totalSize || currentChunkIndex >= metadata.chunkIds.length) {
        controller.close();
        return;
      }

      const chunkId = metadata.chunkIds[currentChunkIndex];
      let retries = 0;
      while (retries < maxRetries) {
        try {
          const chunkUrl = await getFileUrl(botToken, chunkId);
          const response = await fetch(chunkUrl);
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
          const reader = response.body!.getReader();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            if (bytesStreamed + value.length <= totalSize) {
              controller.enqueue(value);
              bytesStreamed += value.length;
            } else {
              const remainingBytes = totalSize - bytesStreamed;
              controller.enqueue(value.slice(0, remainingBytes));
              bytesStreamed = totalSize;
              break;
            }

            if (bytesStreamed >= totalSize) {
              controller.close();
              return;
            }
          }

          currentChunkIndex++;
          break; // Success, move to next chunk
        } catch (error) {
          console.error(`Error streaming chunk ${currentChunkIndex} (attempt ${retries + 1}):`, error);
          retries++;
          if (retries >= maxRetries) {
            throw new Error(`Failed to stream chunk ${currentChunkIndex} after ${maxRetries} attempts`);
          }
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retrying
        }
      }
    }
  });

  return new Response(stream);
}