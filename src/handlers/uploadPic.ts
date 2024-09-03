import { Context } from 'hono'
import { Env } from '../index'
import { getUser } from '../db'
import { fileTypeFromBuffer } from 'file-type'
import { handleChunkUpload } from '../utils/uploadUtils'

export async function uploadPic(c: Context<{ Bindings: Env }>) {
  try {
    let token = c.req.query('token');
    if (!token) {
      const authHeader = c.req.header('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }
    }

    if (!token) {
      return c.json({ Code: 0, Message: 'Token is required' }, 400);
    }

    const user = await getUser(c.env.USERS, token);
    if (!user) {
      return c.json({ Code: 0, Message: 'Invalid token' }, 401);
    }

    const formData = await c.req.formData();
    const file = formData.get('image') as File | null;
    if (!file) {
      return c.json({ Code: 0, Message: 'No file uploaded' }, 400);
    }

    let fileType = formData.get('fileType') as string | null;
    if (!fileType) {
      fileType = await determineFileType(file);
    }

    const maxSize = parseInt(c.env.MAX_IMAGE_SIZE, 10);
    if (file.size > maxSize) {
      return c.json({ Code: 0, Message: 'File size exceeds the maximum limit' }, 400);
    }

    return handleChunkUpload(c, user, file, fileType, null, 'single');
  } catch (error) {
    console.error('Error in uploadPic:', error);
    return c.json({ Code: 0, Message: 'Failed to upload picture' }, 500);
  }
}

async function determineFileType(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const fileTypeResult = await fileTypeFromBuffer(buffer);
  return fileTypeResult ? fileTypeResult.mime : 'application/octet-stream';
}