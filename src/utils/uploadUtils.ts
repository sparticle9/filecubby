import { Context } from 'hono'
import { Env } from '../index'
import { User, FileMetadata } from '../db'
import { saveFileMetadata, updateFileMetadata, getFileMetadata } from '../db'
import { generateFileId } from '../utils'
import { uploadToTelegramDocument, preCacheSingleChunkUrl } from './tgFileOps'
import { cacheChunk, getCachedChunk } from './cache'
import { validateFileMetadata } from '../db';

/**
 * Initializes the upload process by generating a unique file ID and saving the initial metadata.
 * This function is called when a chunked upload is initialized.
 * @param c - The context object containing request and environment information.
 * @param user - The user initiating the upload.
 * @param formData - The form data containing file information.
 * @returns A JSON response indicating the result of the initialization.
 */
export async function initializeUpload(c: Context<{ Bindings: Env }>, user: User, formData: FormData) {
  console.log(`Initializing upload for user ${user.id}`);
  try {
    const fileId = await generateFileId(c.env.FILES);
    const fileName = formData.get('fileName') as string;
    const fileSize = parseInt(formData.get('fileSize') as string, 10);
    const fileType = formData.get('fileType') as string;
    const totalChunks = parseInt(formData.get('totalChunks') as string, 10);
    const expiryHours = formData.get('expiryHours') ? parseInt(formData.get('expiryHours') as string, 10) : null;

    const metadata: FileMetadata = {
      id: fileId,
      userId: user.id,
      name: fileName,
      size: fileSize,
      type: fileType,
      chunks: totalChunks,
      chunkIds: new Array(totalChunks).fill(null),
      uploadedAt: new Date().toISOString(),
      expiresAt: expiryHours ? new Date(Date.now() + expiryHours * 3600000).toISOString() : null,
    };

    // Save the metadata
    await saveFileMetadata(c.env.FILES, `file:${fileId}`, metadata, true);

    console.log(`Upload initialized for file ${fileId}. Metadata saved:`, JSON.stringify(metadata, null, 2));
    return c.json({ 
      Code: 1, 
      Message: 'Upload initialized successfully', 
      fileId, 
      totalChunks 
    });
  } catch (error) {
    console.error('Error initializing upload:', error);
    return c.json({ Code: 0, Message: `Failed to initialize upload: ${error.message}` }, 500);
  }
}

/**
 * Handles the upload of a file chunk or a single file.
 * This function is called for both single file uploads and chunked uploads.
 * It saves the file metadata and caches the chunk data if enabled.
 * @param c - The context object containing request and environment information.
 * @param user - The user uploading the file.
 * @param file - The file or file chunk being uploaded.
 * @param expiryHours - The number of hours after which the file should expire.
 * @param fileId - The unique ID of the file being uploaded.
 * @returns A JSON response indicating the result of the upload.
 */
export async function handleChunkUpload(
  c: Context<{ Bindings: Env }>,
  user: User,
  file: File | Blob,
  expiryHours: number | null,
  fileId: string
) {
  try {
    const formData = await c.req.formData();
    const isChunk = formData.get('isChunk') === 'true';
    const chunkIndex = parseInt(formData.get('chunkIndex') as string || '0', 10);
    const totalChunks = parseInt(formData.get('totalChunks') as string || '1', 10);
    const fileType = formData.get('fileType') as string || (file instanceof File ? file.type : 'application/octet-stream');
    const fileName = formData.get('fileName') as string || (file instanceof File ? file.name : 'unknown');
    const fileSize = file instanceof File ? file.size : parseInt(formData.get('fileSize') as string || '0', 10);

    // Parse expiryHours as a number
    const expiryHoursStr = formData.get('expiryHours') as string;
    const expiryHoursParsed = expiryHoursStr ? parseInt(expiryHoursStr, 10) : null;
    if (expiryHoursParsed !== null && isNaN(expiryHoursParsed)) {
      throw new Error(`Invalid expiryHours value: ${expiryHoursStr}`);
    }

    if (isChunk && !fileId) {
      throw new Error('File ID is required for chunk uploads');
    }

    console.log(`Handling upload for user ${user.id}, file type: ${fileType}`);
    console.log(`Processing chunk ${chunkIndex + 1} of ${totalChunks} for file ${fileId} (${fileName})`);

    const chunkId = await uploadToTelegramDocument(c.env, c.env.BOT_TOKEN, c.env.CHAT_ID, file, fileName, fileType);

    let metadata: FileMetadata;

    if (!isChunk || chunkIndex === 0) {
      // First chunk or single file upload, create or update initial metadata
      metadata = await getFileMetadata(c.env.FILES, `file:${fileId}`) || {
        id: fileId,
        userId: user.id,
        name: fileName,
        size: fileSize,
        type: fileType,
        chunks: totalChunks,
        chunkIds: new Array(totalChunks).fill(null),
        uploadedAt: new Date().toISOString(),
        expiresAt: null,
      };

      // Validate and set the expiry date
      if (expiryHoursParsed !== null) {
        const expiresAt = new Date(Date.now() + expiryHoursParsed * 3600000);
        if (isNaN(expiresAt.getTime())) {
          console.error(`Invalid expiry date calculated for expiryHours: ${expiryHoursParsed}`);
          throw new RangeError('Invalid expiry date calculated');
        }
        metadata.expiresAt = expiresAt.toISOString();
      }

      metadata.chunkIds[chunkIndex] = chunkId;

      await saveFileMetadata(c.env.FILES, `file:${fileId}`, metadata, !isChunk);
      console.log(`File metadata created or updated:`, JSON.stringify(metadata, null, 2));
    } else {
      // Update existing metadata with new chunk ID
      metadata = await updateFileMetadata(c.env.FILES, `file:${fileId}`, (existingMetadata) => {
        existingMetadata.chunkIds[chunkIndex] = chunkId;
        return existingMetadata;
      });
    }

    // Cache chunk data if enabled
    if (c.env.CACHE_CHUNK_EDGE_ON_UPLOAD === 'true') {
      const cachedChunk = await getCachedChunk(c.env, fileId, chunkIndex);
      if (!cachedChunk) {
        const chunkData = await file.arrayBuffer();
        console.log(`Caching chunk for file ID: ${fileId}, chunk index: ${chunkIndex}, MIME type: ${fileType}`);
        await cacheChunk(c.env, fileId, chunkIndex, chunkData, fileType);
        
        // Verify the cache immediately after caching
        const verificationChunk = await getCachedChunk(c.env, fileId, chunkIndex);
        if (verificationChunk) {
          console.log(`Verified: Chunk successfully cached for file ID: ${fileId}, chunk index: ${chunkIndex}`);
        } else {
          console.error(`Verification failed: Chunk not found in cache immediately after caching for file ID: ${fileId}, chunk index: ${chunkIndex}`);
        }
      } else {
        console.log(`Chunk already cached for file ID: ${fileId}, chunk index: ${chunkIndex}`);
      }
    }

    // Pre-cache chunk URL asynchronously
    c.executionCtx.waitUntil(preCacheSingleChunkUrl(c.env, fileId, chunkIndex));
    
    console.log(`Chunk ${chunkIndex + 1} of ${totalChunks} processed successfully for file ${fileId}`);

    let response: any = {
      Code: 1,
      Message: 'Chunk uploaded successfully',
      fileId,
      chunkIndex,
      totalChunks
    };

    // If this is the last chunk or a single file upload, include the download URL
    if (chunkIndex === totalChunks - 1 || !isChunk) {
      console.log('Processing last chunk or single file upload, preparing to generate download URL');

      const host = c.req.header('Host') || '';
      const protocol = c.req.header('X-Forwarded-Proto') || 'https';

      if (!host) {
        console.error('Host header is missing');
        throw new Error('Unable to determine host for download URL');
      }

      const url = `${protocol}://${host}/d/${fileId}`;
      response.url = url;
    }

    return c.json(response);
  } catch (error) {
    console.error('Error handling chunk upload:', error);
    if (error instanceof TypeError) {
      console.error('TypeError details:', error.message, error.stack);
    }
    return c.json({ Code: 0, Message: `Failed to upload chunk: ${error.message}` }, 500);
  }
}

/**
 * Finalizes the upload process by validating the metadata and performing any additional final processing.
 * This function is called after all chunks of a chunked upload have been uploaded.
 * @param c - The context object containing request and environment information.
 * @param fileId - The unique ID of the file being uploaded.
 * @returns A JSON response indicating the result of the finalization.
 */
export async function finalizeUpload(c: Context<{ Bindings: Env }>, fileId: string) {
  console.log(`Finalizing upload for file ${fileId}`);
  try {
    const metadata = await getFileMetadata(c.env.FILES, `file:${fileId}`);
    if (!metadata) {
      throw new Error('Metadata not found');
    }

    // Check if all chunks have been uploaded
    if (metadata.chunkIds.some(id => id === null)) {
      throw new Error('Not all chunks have been uploaded');
    }

    // Perform final validation
    const validationResult = validateFileMetadata(metadata, false);
    if (!validationResult.isValid) {
      throw new Error(`Invalid metadata: ${validationResult.error}`);
    }

    // Perform any additional final processing here

    console.log(`Upload finalized successfully for file ${fileId}`);
    return c.json({ Code: 1, Message: 'Upload finalized successfully', fileId });
  } catch (error) {
    console.error('Error finalizing upload:', error);
    return c.json({ Code: 0, Message: `Failed to finalize upload: ${error.message}` }, 500);
  }
}

/**
 * Retrieves the upload status by checking the metadata and determining the number of uploaded chunks.
 * This function is called to get the current status of an upload.
 * @param c - The context object containing request and environment information.
 * @param fileId - The unique ID of the file being uploaded.
 * @returns A JSON response indicating the upload status.
 */
export async function getUploadStatus(c: Context<{ Bindings: Env }>, fileId: string) {
  console.log(`Getting upload status for file ${fileId}`);
  try {
    const metadata = await c.env.FILES.get(`file:${fileId}`, 'json');
    if (!metadata) {
      return c.json({ Code: 0, Message: 'File not found' }, 404);
    }

    const uploadedChunks = metadata.chunkIds.filter(Boolean).length;
    const status = uploadedChunks === metadata.chunks ? 'complete' : 'in progress';

    console.log(`Upload status retrieved for file ${fileId}: ${status}`);
    return c.json({
      Code: 1,
      Message: 'Upload status retrieved successfully',
      fileId,
      status,
      uploadedChunks,
      totalChunks: metadata.chunks
    });
  } catch (error) {
    console.error('Error getting upload status:', error);
    return c.json({ Code: 0, Message: 'Failed to get upload status' }, 500);
  }
}