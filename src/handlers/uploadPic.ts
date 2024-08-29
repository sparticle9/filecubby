import { Context } from 'hono'
import { Env } from '../index'
import { determineFileType } from '../utils/fileUtils'
import { uploadFile } from '../utils/fileUpload'
import { User, getUser } from '../db'

export async function uploadPic(c: Context<{ Bindings: Env, Variables: { user: User } }>) {
  console.log('uploadPic: Starting picture upload process')
  const { PIC_MAX_SIZE, METADB } = c.env

  let token: string | null = null

  // Check for Authorization header first
  const authHeader = c.req.header('Authorization')
  if (authHeader) {
    const [authType, authToken] = authHeader.split(' ')
    if (authType.toLowerCase() === 'bearer' && authToken) {
      token = authToken
    }
  }

  // If no valid token in header, check query parameter
  if (!token) {
    token = c.req.query('token')
  }

  if (!token) {
    console.error('uploadPic: No token provided')
    return c.json({ Code: 0, Message: 'Token is required' }, 401)
  }

  const user = await getUser(METADB, token)
  if (!user) {
    console.error('uploadPic: Invalid token or user not found')
    return c.json({ Code: 0, Message: 'Unauthorized' }, 401)
  }

  const maxSize = parseInt(PIC_MAX_SIZE, 10)

  try {
    const formData = await c.req.formData()
    const file = formData.get('image') as File | null
    const expiryHours = formData.get('expiryHours') ? parseInt(formData.get('expiryHours') as string) : null

    console.log('uploadPic: Received file:', file?.name, file?.size, file?.type)
    console.log('uploadPic: Expiry hours:', expiryHours)

    if (!file) {
      console.error('uploadPic: No file uploaded')
      return c.json({ Code: 0, Message: 'No file uploaded' })
    }

    const fileType = await determineFileType(file)
    console.log('uploadPic: Determined file type:', fileType)
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

    if (!allowedTypes.includes(fileType)) {
      console.error('uploadPic: Invalid file type:', fileType)
      return c.json({ Code: 0, Message: `Invalid file type. Allowed types are: ${allowedTypes.join(', ')}. Detected type: ${fileType}` })
    }

    if (file.size > maxSize) {
      console.error('uploadPic: File size exceeds maximum:', file.size, '>', maxSize)
      return c.json({ Code: 0, Message: `File size exceeds the maximum allowed size of ${maxSize} bytes` })
    }

    console.log('uploadPic: Uploading file')
    const host = c.req.header('Host') || ''
    const protocol = c.req.header('X-Forwarded-Proto') || 'https'
    const result = await uploadFile(c.env, user.id, file, fileType, expiryHours, false, uploadToTelegram, host, protocol)
    
    console.log('uploadPic: Upload successful, returning result')
    return c.json({
      Code: 1,
      Message: 'Image uploaded successfully',
      url: result.fullUrl,  // Use fullUrl as the value for url
      filename: result.filename,
      size: file.size,
      fileId: result.fileId
    })
  } catch (error) {
    console.error('Error uploading image:', error)
    return c.json({ Code: 0, Message: 'Failed to upload image' }, 500)
  }
}

async function uploadToTelegram(botToken: string, channelId: string, file: File, fileName: string): Promise<string> {
  console.log('uploadToTelegram: Starting upload to Telegram')
  const formData = new FormData()
  formData.append('chat_id', channelId)
  formData.append('document', file, fileName)  // Changed from 'photo' to 'document'

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {  // Changed from 'sendPhoto' to 'sendDocument'
    method: 'POST',
    body: formData,
  })

  const result = await response.json()
  console.log('uploadToTelegram: Telegram API response:', JSON.stringify(result, null, 2))

  if (!result.ok) {
    console.error('Failed to upload to Telegram:', result.description)
    throw new Error('Failed to upload to Telegram')
  }

  const fileId = result.result.document.file_id  // Changed from result.result.photo[result.result.photo.length - 1].file_id
  if (!fileId) {
    console.error('Unexpected response format:', result)
    throw new Error('Failed to get file ID from Telegram')
  }

  console.log('uploadToTelegram: Upload successful, file ID:', fileId)
  return fileId
}
