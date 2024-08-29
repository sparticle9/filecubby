import { Context } from 'hono'
import { Env } from '../index'
import { FileMetadata } from '../types'

export async function uploadPic(c: Context<{ Bindings: Env }>) {
  const { BOT_TOKEN, CHANNEL_ID, FILE_METADATA, PIC_MAX_SIZE } = c.env
  const formData = await c.req.formData()
  const file = formData.get('image') as File

  if (!file) {
    return c.json({ error: 'No file uploaded' }, 400)
  }

  const fileName = file.name
  const fileSize = file.size
  const maxSize = parseInt(PIC_MAX_SIZE || '31457280', 10) // Default to 30MB if not set

  if (fileSize > maxSize) {
    return c.json({ error: `File size exceeds ${maxSize / 1024 / 1024}MB limit` }, 400)
  }

  const fileId = await uploadToTelegram(BOT_TOKEN, CHANNEL_ID, file, fileName)
  const metadata: FileMetadata = {
    fileName,
    fileSize,
    isChunked: false,
    uploadTime: Date.now(),
    expiryTime: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days expiry
  }
  await storeFileMetadata(FILE_METADATA, fileId, metadata)

  const downloadUrl = `${c.req.url.split('/api/pic')[0]}/d/${fileId}`
  return c.json({ url: downloadUrl })
}

async function uploadToTelegram(botToken: string, channelId: string, file: File, fileName: string): Promise<string> {
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