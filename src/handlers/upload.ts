import { Context } from 'hono'
import { Env } from '../index'
import { User } from '../db'
import { determineFileType } from '../utils/fileUtils'
import { handleFileUpload, handleChunkUpload, initializeUpload } from '../utils/uploadUtils'

export async function uploadHandler(c: Context<{ Bindings: Env, Variables: { user: User } }>) {
  const user = c.get('user')
  if (!user) {
    console.error('Upload attempted without authentication');
    return c.json({ Code: 0, Message: 'Unauthorized' }, 401)
  }

  try {
    const formData = await c.req.formData()
    const file = formData.get('file') as File | null
    const expiryHours = formData.get('expiryHours') ? parseInt(formData.get('expiryHours') as string) : null
    const isInit = formData.get('isInit') === 'true'
    const isChunk = formData.get('isChunk') === 'true'
    const sessionId = formData.get('sessionId') as string | null

    if (!file && !isInit) {
      console.error('Upload attempted without file');
      return c.json({ Code: 0, Message: 'No file uploaded' })
    }

    if (isInit) {
      console.log('Initializing upload');
      return initializeUpload(c, user, formData);
    }

    const fileType = file ? await determineFileType(file) : 'application/octet-stream'
    const maxSize = parseInt(c.env.CHUNK_SIZE, 10);

    if (isChunk) {
      if (!sessionId) {
        console.error('Chunk upload attempted without sessionId');
        return c.json({ Code: 0, Message: 'sessionId is required for chunk uploads' }, 400);
      }
      console.log(`Processing chunk upload for session ${sessionId}`);
      return handleChunkUpload(c, user, file!, fileType, expiryHours, sessionId);
    } else {
      if (file!.size > maxSize) {
        console.error(`File size (${file!.size}) exceeds maximum limit (${maxSize})`);
        return c.json({ Code: 0, Message: `File size exceeds the maximum limit of ${maxSize} bytes` }, 400);
      }
      console.log('Processing single file upload');
      return handleFileUpload(c, user, file!, fileType, expiryHours, maxSize);
    }
  } catch (error) {
    console.error('Error in uploadHandler:', error);
    return c.json({ Code: 0, Message: `Failed to upload file: ${error.message}` }, 500);
  }
}