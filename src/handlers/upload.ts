import { Context } from 'hono'
import { Env } from '../index'
import { User } from '../db'
import { fileTypeFromBuffer } from 'file-type'
import { handleChunkUpload, initializeUpload, finalizeUpload, getUploadStatus } from '../utils/uploadUtils'
import { generateFileId } from '../utils' // Import the generateFileId function

/**
 * Handles file upload requests.
 * This function determines whether the upload is a single file upload or a chunked upload.
 * For single file uploads, it generates a unique file ID and handles the upload.
 * For chunked uploads, it either initializes the upload or handles individual chunks.
 * @param c - The context object containing request and environment information.
 * @returns A JSON response indicating the result of the upload.
 */
export async function uploadHandler(c: Context<{ Bindings: Env, Variables: { user: User } }>) {
  try {
    const user = c.get('user');
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    const isChunk = formData.get('isChunk') === 'true';
    const fileId = formData.get('fileId') as string | null;

    if (isChunk) {
      // Chunked upload
      if (!fileId) {
        return c.json({ Code: 0, Message: 'File ID is required for chunk uploads' }, 400);
      }
      if (!file) {
        return c.json({ Code: 0, Message: 'No file chunk uploaded' }, 400);
      }
      const fileType = formData.get('fileType') as string;
      const expiryHours = formData.get('expiryHours') ? parseInt(formData.get('expiryHours') as string) : null;
      return handleChunkUpload(c, user, file, expiryHours, fileId);
    } else if (file) {
      // Single file upload
      const fileType = await determineFileType(file);
      const expiryHours = formData.get('expiryHours') ? parseInt(formData.get('expiryHours') as string) : null;
      const maxSize = parseInt(c.env.MAX_CHUNK_SIZE, 10);
      if (file.size > maxSize) {
        return c.json({ Code: 0, Message: 'File size exceeds the maximum limit' }, 400);
      }
      const uniqueFileId = await generateFileId(c.env.FILES); // Generate a unique fileId
      return handleChunkUpload(c, user, file, expiryHours, uniqueFileId);
    } else {
      // Chunked upload initialization
      return initializeUpload(c, user, formData);
    }
  } catch (error) {
    console.error('Error in uploadHandler:', error);
    return c.json({ Code: 0, Message: 'Failed to process upload' }, 500);
  }
}

/**
 * Finalizes the upload process.
 * This function is called after all chunks of a chunked upload have been uploaded.
 * It validates the metadata and performs any additional final processing.
 * @param c - The context object containing request and environment information.
 * @returns A JSON response indicating the result of the finalization.
 */
export async function finalizeUploadHandler(c: Context<{ Bindings: Env, Variables: { user: User } }>) {
  const fileId = c.req.param('fileId');
  return finalizeUpload(c, fileId);
}

/**
 * Retrieves the upload status.
 * This function checks the metadata to determine the number of uploaded chunks and the overall status of the upload.
 * @param c - The context object containing request and environment information.
 * @returns A JSON response indicating the upload status.
 */
export async function getUploadStatusHandler(c: Context<{ Bindings: Env, Variables: { user: User } }>) {
  const fileId = c.req.param('fileId');
  return getUploadStatus(c, fileId);
}

/**
 * Determines the MIME type of a file.
 * This function reads the file's content and uses the file-type library to determine the MIME type.
 * @param file - The file to determine the MIME type for.
 * @returns A promise that resolves to the MIME type of the file.
 */
async function determineFileType(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const fileTypeResult = await fileTypeFromBuffer(buffer);
  return fileTypeResult ? fileTypeResult.mime : 'application/octet-stream';
}