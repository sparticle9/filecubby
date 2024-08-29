import { Context } from 'hono'
import { Env } from '../index'
import { getChunkSize } from '../config'
import { FileMetadata } from '../types'
import { determineFileType } from '../utils/fileUtils'

export async function uploadFile(c: Context<{ Bindings: Env }>) {
  const { BOT_TOKEN, CHANNEL_ID, FILE_METADATA } = c.env
  const formData = await c.req.formData()
  const file = formData.get('file') as File
  const CHUNK_SIZE = getChunkSize(c.env)

  if (!file) {
    return c.json({ Code: 0, Message: 'No file uploaded' })
  }

  const fileName = file.name
  const fileSize = file.size
  const fileType = await determineFileType(file)

  // Get the host from the request headers
  const host = c.req.header('Host') || ''
  const protocol = c.req.header('X-Forwarded-Proto') || 'https'

  if (fileSize <= CHUNK_SIZE) {
    // Single file upload
    const fileId = await uploadToTelegram(BOT_TOKEN, CHANNEL_ID, file, fileName)
    const metadata: FileMetadata = {
      fileName,
      fileSize,
      fileType,
      isChunked: false,
      uploadTime: Date.now(),
      expiryTime: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days expiry
    }
    await storeFileMetadata(FILE_METADATA, fileId, metadata)
    const fullUrl = `${protocol}://${host}/d/${fileId}`
    return c.json({ Code: 1, Message: 'File uploaded successfully', url: fullUrl })
  } else {
    // Chunked upload
    const chunks = Math.ceil(fileSize / CHUNK_SIZE)
    const chunkIds = []

    for (let i = 0; i < chunks; i++) {
      const start = i * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, fileSize)
      const chunk = file.slice(start, end)
      const chunkName = `${fileName}.part${i + 1}`
      const chunkId = await uploadToTelegram(BOT_TOKEN, CHANNEL_ID, chunk, chunkName)
      chunkIds.push(chunkId)
    }

    // Create manifest file
    const manifestContent = `tgstate-blob\n${fileName}\nsize${fileSize}\n${chunkIds.join('\n')}`
    const manifestFile = new File([manifestContent], 'manifest.txt', { type: 'text/plain' })
    const manifestId = await uploadToTelegram(BOT_TOKEN, CHANNEL_ID, manifestFile, 'manifest.txt')

    const metadata: FileMetadata = {
      fileName,
      fileSize,
      fileType,
      isChunked: true,
      chunkIds,
      uploadTime: Date.now(),
      expiryTime: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days expiry
    }
    await storeFileMetadata(FILE_METADATA, manifestId, metadata)
    const fullUrl = `${protocol}://${host}/d/${manifestId}`
    return c.json({ Code: 1, Message: 'File uploaded successfully', url: fullUrl })
  }
}

async function uploadToTelegram(botToken: string, channelId: string, file: File | Blob, fileName: string): Promise<string> {
  const formData = new FormData()
  formData.append('chat_id', channelId)
  formData.append('document', file, fileName)

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
    method: 'POST',
    body: formData,
  })

  const result = await response.json()
  if (!result.ok) {
    console.error('Failed to upload to Telegram:', result.description)
    throw new Error('Failed to upload to Telegram')
  }

  if (!result.result.document || !result.result.document.file_id) {
    console.error('Unexpected response format:', result)
    throw new Error('Failed to get file ID from Telegram')
  }

  return result.result.document.file_id
}

async function storeFileMetadata(KV: KVNamespace, fileId: string, metadata: FileMetadata) {
  await KV.put(`file:${fileId}`, JSON.stringify(metadata))
}