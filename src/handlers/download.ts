import { Context } from 'hono'
import { Env } from '../index'

export async function downloadFile(c: Context<{ Bindings: Env }>) {
  const { BOT_TOKEN, FILE_METADATA } = c.env
  const fileId = c.req.param('fileId')

  // Get file metadata from KV
  const metadata = await FILE_METADATA.get(`file:${fileId}`, 'json')
  if (!metadata) {
    return c.json({ error: 'File not found' }, 404)
  }

  if (!metadata.isChunked) {
    // Single file download
    const fileUrl = await getFileUrl(BOT_TOKEN, fileId)
    return streamFile(c, fileUrl, metadata.fileName)
  } else {
    // Chunked file download
    return streamChunkedFile(c, BOT_TOKEN, metadata)
  }
}

async function getFileUrl(botToken: string, fileId: string): Promise<string> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`)
  const result = await response.json()
  if (!result.ok) {
    throw new Error('Failed to get file from Telegram')
  }
  return `https://api.telegram.org/file/bot${botToken}/${result.result.file_path}`
}

async function streamFile(c: Context, fileUrl: string, fileName: string) {
  const response = await fetch(fileUrl)
  c.header('Content-Disposition', `attachment; filename="${fileName}"`)
  c.header('Content-Type', response.headers.get('Content-Type') || 'application/octet-stream')
  c.header('Content-Length', response.headers.get('Content-Length') || '0')
  return c.body(response.body)
}

async function streamChunkedFile(c: Context, botToken: string, metadata: any) {
  const fileName = metadata.fileName || 'downloaded_file'
  c.header('Content-Disposition', `attachment; filename="${fileName}"`)
  c.header('Content-Type', 'application/octet-stream')
  c.header('Content-Length', metadata.fileSize.toString())

  const readable = new ReadableStream({
    async start(controller) {
      for (const chunkId of metadata.chunkIds) {
        const chunkUrl = await getFileUrl(botToken, chunkId)
        const chunkResponse = await fetch(chunkUrl)
        const reader = chunkResponse.body.getReader()
        let done, value
        while ({ done, value } = await reader.read(), !done) {
          controller.enqueue(value)
        }
      }
      controller.close()
    }
  })

  return c.body(readable)
}