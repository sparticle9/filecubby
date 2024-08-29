import { Context } from 'hono'
import { Env } from '../index'
import { determineFileType } from '../utils/fileUtils'
import { uploadFile, uploadToTelegramDocument } from '../utils/fileUpload'
import { User } from '../db'
import { saveFileMetadata, getFileMetadata } from '../db'
import { generateFileId } from '../utils'
import { writeAnalytics } from '../utils/analytics'
import { getChunkSize } from '../config'

export async function uploadHandler(c: Context<{ Bindings: Env, Variables: { user: User } }>) {
  const user = c.get('user')
  if (!user) {
    return c.json({ Code: 0, Message: 'Unauthorized' }, 401)
  }

  const startTime = Date.now();

  try {
    const formData = await c.req.formData()
    const file = formData.get('file') as File | null
    const expiryHours = formData.get('expiryHours') ? parseInt(formData.get('expiryHours') as string) : null
    const isChunk = formData.get('isChunk') === 'true'
    const isManifest = formData.get('isManifest') === 'true'

    if (!file) {
      return c.json({ Code: 0, Message: 'No file uploaded' })
    }

    const fileType = await determineFileType(file)
    const host = c.req.header('Host') || ''
    const protocol = c.req.header('X-Forwarded-Proto') || 'https'
    
    const chunkSize = getChunkSize(c.env)

    if (isChunk) {
      // Handle chunk upload
      const result = await uploadFile(c.env, user.id, file, fileType, expiryHours, true, uploadToTelegramDocument, host, protocol);
      return c.json({ 
        Code: 1, 
        Message: 'Chunk uploaded successfully', 
        chunkId: result.chunkId,
        fileType: fileType,
        isChunked: true
      });
    } else if (isManifest) {
      // Handle manifest upload
      const manifestContent = await file.text();
      const manifest = JSON.parse(manifestContent);
      
      let fileId = generateFileId();
      while (await getFileMetadata(c.env.METADB, fileId)) {
        fileId = generateFileId();
      }
      
      const metadata = {
        id: fileId,
        userId: user.id,
        filename: manifest.fileName,
        size: manifest.fileSize,
        chunks: manifest.chunkIds.length,
        chunkIds: manifest.chunkIds,
        expiresAt: expiryHours ? new Date(Date.now() + expiryHours * 60 * 60 * 1000) : null,
        fileType: manifest.fileType,
        uploadedAt: new Date()
      };
      
      await saveFileMetadata(c.env.METADB, metadata);
      
      const fullUrl = `${protocol}://${host}/d/${fileId}`;
      
      return c.json({ 
        Code: 1, 
        Message: 'File uploaded successfully', 
        fileId: fileId,
        url: fullUrl,
        filename: manifest.fileName,
        isChunked: true
      });
    } else {
      // Handle single file upload
      const result = await uploadFile(c.env, user.id, file, fileType, expiryHours, false, uploadToTelegramDocument, host, protocol);
      const fullUrl = `${protocol}://${host}/d/${result.fileId}`;

      const responseTime = Date.now() - startTime;
      await writeAnalytics(c.env.ANALYTICS_ENGINE, {
        action: 'upload',
        fileType: fileType,
        fileSize: file.size,
        responseTime,
        isChunked: false
      });

      return c.json({ 
        Code: 1, 
        Message: 'File uploaded successfully', 
        fileId: result.fileId,
        url: fullUrl,
        filename: file.name,
        isChunked: false
      });
    }
  } catch (error) {
    console.error('Error in uploadHandler:', error);
    const responseTime = Date.now() - startTime;
    await writeAnalytics(c.env.ANALYTICS_ENGINE, {
      action: 'error',
      errorType: 'upload_handler_error',
      responseTime
    });
    return c.json({ Code: 0, Message: `Failed to upload file: ${error.message}` }, 500);
  }
}

async function uploadToTelegramDocument(botToken: string, channelId: string, file: File, fileName: string): Promise<string> {
  const formData = new FormData()
  formData.append('chat_id', channelId)
  
  // Use the original file name instead of the generated one
  const originalFileName = file.name || fileName
  
  console.log('uploadToTelegramDocument: Uploading file with name:', originalFileName)
  formData.append('document', file, originalFileName)

  console.log('uploadToTelegramDocument: Sending request to Telegram API')
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
    method: 'POST',
    body: formData,
  })

  const result = await response.json()
  console.log('uploadToTelegramDocument: Telegram API response:', JSON.stringify(result, null, 2))

  if (!result.ok) {
    console.error('Failed to upload to Telegram:', result.description)
    throw new Error(`Failed to upload to Telegram: ${result.description}`)
  }

  let fileId: string | undefined

  if (result.result.document) {
    fileId = result.result.document.file_id
  } else if (result.result.audio) {
    fileId = result.result.audio.file_id
  } else {
    console.error('Unexpected response format:', result)
    throw new Error('Failed to get file ID from Telegram: Unexpected response format')
  }

  if (!fileId) {
    console.error('File ID not found in response:', result)
    throw new Error('Failed to get file ID from Telegram: File ID not found')
  }

  console.log('uploadToTelegramDocument: File ID received:', fileId)
  return fileId
}