import { Context } from 'hono'
import { Env } from '../index'
import { getUser } from '../db'
import { fileTypeFromBuffer as detectFileTypeFromBuffer } from 'file-type'
import { handleChunkUpload } from '../utils/uploadUtils'
import { generateObjectId } from '../utils'

export async function uploadImage(c: Context<{ Bindings: Env }>) {
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
    const objectBlob = formData.get('image') as File | null;
    if (!objectBlob) {
      return c.json({ Code: 0, Message: 'No image uploaded' }, 400);
    }

    let objectType = formData.get('objectType') as string | null;
    if (!objectType) {
      objectType = await determineObjectType(objectBlob);
    }

    const maxSize = parseInt(String(c.env.MAX_IMAGE_SIZE), 10);
    if (objectBlob.size > maxSize) {
      return c.json({ Code: 0, Message: 'Image size exceeds the maximum limit' }, 400);
    }

    const expiryHours = formData.get('expiryHours') ? parseInt(formData.get('expiryHours') as string, 10) : null;
    const objectId = await generateObjectId(c.env.FILES);
    formData.set('objectType', objectType);
    formData.set('objectName', objectBlob.name || 'image');
    formData.set('objectSize', String(objectBlob.size));
    formData.set('totalChunks', '1');
    return handleChunkUpload(c, user, objectBlob, expiryHours, objectId, formData);
  } catch (error) {
    console.error('Error in uploadImage:', error);
    return c.json({ Code: 0, Message: 'Failed to upload image' }, 500);
  }
}

async function determineObjectType(objectBlob: File): Promise<string> {
  const buffer = await objectBlob.arrayBuffer();
  const detectedType = await detectFileTypeFromBuffer(buffer);
  return detectedType ? detectedType.mime : 'application/octet-stream';
}
