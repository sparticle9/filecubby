import { Env } from '../index'
import { fileTypeFromBuffer as detectFileTypeFromBuffer } from 'file-type'
import { handleChunkUpload, initializeUpload, finalizeUpload, getUploadStatus } from '../utils/uploadUtils'
import { generateObjectId } from '../utils'
import { effectiveMaxChunkSize } from '../utils/metadata'

export async function uploadHandler(c: any) {
  try {
    const user = c.get('user');
    const formData = await c.req.formData();
    const objectBlob = formData.get('file') as File | null;
    const isChunk = formData.get('isChunk') === 'true';
    const objectId = formData.get('objectId') as string | null;

    if (isChunk) {
      if (!objectId) {
        return c.json({ Code: 0, Message: 'Object ID is required for chunk uploads' }, 400);
      }
      if (!objectBlob) {
        return c.json({ Code: 0, Message: 'No object chunk uploaded' }, 400);
      }
      const expiryHours = formData.get('expiryHours') ? parseInt(formData.get('expiryHours') as string) : null;
      return handleChunkUpload(c, user, objectBlob, expiryHours, objectId, formData);
    } else if (objectBlob) {
      const objectType = await determineObjectType(objectBlob);
      const expiryHours = formData.get('expiryHours') ? parseInt(formData.get('expiryHours') as string) : null;
      const maxSize = effectiveMaxChunkSize(c.env);
      if (objectBlob.size > maxSize) {
        return c.json({ Code: 0, Message: `Object size exceeds the public Bot API chunk limit of ${maxSize} bytes; use chunked upload` }, 400);
      }
      formData.set('objectType', formData.get('objectType') as string || objectType);
      formData.set('objectName', formData.get('objectName') as string || objectBlob.name || 'object');
      formData.set('objectSize', String(objectBlob.size));
      const uniqueObjectId = await generateObjectId(c.env.FILES);
      return handleChunkUpload(c, user, objectBlob, expiryHours, uniqueObjectId, formData);
    } else {
      return initializeUpload(c, user, formData);
    }
  } catch (error) {
    console.error('Error in uploadHandler:', error);
    return c.json({ Code: 0, Message: 'Failed to process upload' }, 500);
  }
}

export async function finalizeUploadHandler(c: any) {
  const objectId = c.req.param('objectId');
  return finalizeUpload(c, objectId);
}

export async function getUploadStatusHandler(c: any) {
  const objectId = c.req.param('objectId');
  return getUploadStatus(c, objectId);
}

async function determineObjectType(objectBlob: File): Promise<string> {
  const buffer = await objectBlob.arrayBuffer();
  const detectedType = await detectFileTypeFromBuffer(buffer);
  return detectedType ? detectedType.mime : 'application/octet-stream';
}
