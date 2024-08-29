import { Context } from 'hono'
import { Env } from '../index'
import { determineFileType } from '../utils/fileUtils'

export async function uploadPic(c: Context<{ Bindings: Env }>) {
  const { BOT_TOKEN, CHANNEL_ID, FILE_METADATA, PIC_MAX_SIZE } = c.env
  const maxSize = parseInt(PIC_MAX_SIZE, 10)

  // Handle multipart/form-data
  const formData = await c.req.formData()
  const file = formData.get('image') as File | null

  if (!file) {
    return c.json({ Code: 0, Message: 'No file uploaded' })
  }

  console.log('File object:', file)
  console.log('File name:', file.name)
  console.log('File type from File object:', file.type)

  const fileType = await determineFileType(file)
  console.log('Determined file type:', fileType)

  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

  if (!allowedTypes.includes(fileType)) {
    console.warn(`Warning: Invalid file type uploaded - ${fileType}`)
    return c.json({ Code: 0, Message: `Invalid file type. Allowed types are: ${allowedTypes.join(', ')}. Detected type: ${fileType}` })
  }

  if (file.size > maxSize) {
    return c.json({ Code: 0, Message: `File size exceeds the maximum allowed size of ${maxSize} bytes` })
  }

  // Generate a unique filename
  const fileName = `pic_${Date.now()}.${fileType.split('/')[1]}`

  try {
    const fileId = await uploadToTelegram(BOT_TOKEN, CHANNEL_ID, file, fileName)
    const metadata = {
      fileName,
      fileSize: file.size,
      fileType,
      isChunked: false,
      uploadTime: Date.now(),
      expiryTime: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days expiry
    }
    await storeFileMetadata(FILE_METADATA, fileId, metadata)
    
    // Get the host from the request headers
    const host = c.req.header('Host') || ''
    const protocol = c.req.header('X-Forwarded-Proto') || 'https'
    const fullUrl = `${protocol}://${host}/d/${fileId}`
    
    return c.json({ Code: 1, Message: 'File uploaded successfully', url: fullUrl })
  } catch (error) {
    console.error('Error uploading file:', error)
    return c.json({ Code: 0, Message: 'Failed to upload file' })
  }
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
