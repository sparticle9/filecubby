import { Context } from 'hono'
import { Env } from '../index'
import { User, FileMetadata } from '../db'
import { saveFileMetadata, getFileMetadata, updateFileMetadata } from '../db'
import { generateFileId, generateSecureToken } from '../utils'
import { uploadToTelegramDocument, preCacheChunkUrls } from './tgFileOps'
import { writeAnalytics } from './analytics'

export async function initializeUpload(
  c: Context<{ Bindings: Env }>,
  user: User,
  formData: FormData
) {
  try {
    const fileName = formData.get('fileName') as string;
    const fileSize = parseInt(formData.get('fileSize') as string);
    const fileType = formData.get('fileType') as string;
    const totalChunks = parseInt(formData.get('totalChunks') as string);
    const chunkSize = parseInt(formData.get('chunkSize') as string);
    const expiryHours = formData.get('expiryHours') ? parseInt(formData.get('expiryHours') as string) : null;

    console.log(`Initializing upload: ${fileName}, size: ${fileSize}, type: ${fileType}, chunks: ${totalChunks}`);

    if (chunkSize > parseInt(c.env.CHUNK_SIZE)) {
      console.error(`Chunk size (${chunkSize}) exceeds maximum allowed (${c.env.CHUNK_SIZE})`);
      return c.json({ Code: 0, Message: 'Chunk size exceeds maximum allowed' }, 400);
    }

    const fileId = generateFileId();
    const sessionId = generateSecureToken();

    const metadata: FileMetadata = {
      id: fileId,
      userId: user.id,
      filename: fileName,
      size: fileSize,
      chunks: totalChunks,
      chunkIds: new Array(totalChunks).fill(null),
      expiresAt: expiryHours ? new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString() : null,
      fileType: fileType,
      uploadedAt: new Date().toISOString(),
      status: 'uploading'
    };

    await saveFileMetadata(c.env.FILES, `file:${fileId}`, metadata, true);
    console.log(`Upload initialized. FileID: ${fileId}, SessionID: ${sessionId}`);

    return c.json({
      Code: 1,
      Message: 'Upload initialized',
      fileId: fileId,
      sessionId: sessionId
    });
  } catch (error) {
    console.error('Error in initializeUpload:', error);
    return c.json({ Code: 0, Message: `Failed to initialize upload: ${error.message}` }, 500);
  }
}

export async function handleChunkUpload(
  c: Context<{ Bindings: Env }>,
  user: User,
  file: File,
  fileType: string,
  expiryHours: number | null,
  sessionId: string
) {
  const formData = await c.req.formData();
  const chunkIndex = parseInt(formData.get('chunkIndex') as string || '0', 10);
  const totalChunks = parseInt(formData.get('totalChunks') as string || '1', 10);
  const fileId = formData.get('fileId') as string;

  console.log(`Processing chunk ${chunkIndex + 1}/${totalChunks} for file ${fileId}`);

  try {
    let metadata = await getFileMetadata(c.env.FILES, `file:${fileId}`);
    if (!metadata) {
      console.error(`Metadata not found for file ${fileId}`);
      return c.json({ Code: 0, Message: 'Invalid file ID' }, 400);
    }

    console.log(`Metadata found for file ${fileId}:`, JSON.stringify(metadata, null, 2));

    console.log(`Uploading chunk to Telegram. File: ${fileId}, Chunk: ${chunkIndex}`);
    const chunkId = await uploadToTelegramDocument(c.env.BOT_TOKEN, c.env.CHANNEL_ID, file, `${metadata.id}_chunk${chunkIndex}`);
    console.log(`Chunk uploaded to Telegram. File: ${fileId}, Chunk: ${chunkIndex}, ChunkId: ${chunkId}`);

    metadata.chunkIds[chunkIndex] = chunkId;
    metadata.size += file.size;

    if (metadata.chunkIds.every(id => id !== null)) {
      metadata.status = 'completed';
    }

    console.log(`Updating metadata. File: ${fileId}, Chunk: ${chunkIndex}`);
    await updateFileMetadata(c.env.FILES, `file:${fileId}`, metadata);
    console.log(`Metadata updated. File: ${fileId}, Chunk: ${chunkIndex}`);

    // Trigger pre-caching asynchronously
    c.executionCtx.waitUntil(preCacheChunkUrls(c.env, fileId, [chunkIndex]));

    if (metadata.status === 'completed') {
      const host = c.req.header('Host') || '';
      const protocol = c.req.header('X-Forwarded-Proto') || 'https';
      const fullUrl = `${protocol}://${host}/d/${metadata.id}`;

      console.log(`File upload completed. URL: ${fullUrl}`);
      return c.json({
        Code: 1,
        Message: 'File upload completed',
        url: fullUrl,
        filename: metadata.filename
      });
    }

    return c.json({
      Code: 1,
      Message: 'Chunk uploaded successfully',
      chunkIndex: chunkIndex
    });
  } catch (error) {
    console.error(`Error in handleChunkUpload. File: ${fileId}, Chunk: ${chunkIndex}`, error);
    return c.json({ Code: 0, Message: `Failed to upload chunk: ${error.message}` }, 500);
  }
}

export async function handleFileUpload(
  c: Context<{ Bindings: Env }>,
  user: User,
  file: File,
  fileType: string,
  expiryHours: number | null,
  maxSize: number
) {
  const startTime = Date.now();

  console.log(`Starting file upload for user ${user.id}, file type: ${fileType}, size: ${file.size} bytes`);

  if (file.size > maxSize) {
    console.log(`File size exceeds limit - ${file.size} > ${maxSize}`);
    return c.json({ Code: 0, Message: `File size exceeds the maximum limit of ${maxSize} bytes` }, 400);
  }

  const fileId = generateFileId();
  console.log(`Generated file ID - ${fileId}`);

  console.log('Uploading to Telegram');
  const chunkId = await uploadToTelegramDocument(c.env.BOT_TOKEN, c.env.CHANNEL_ID, file, file.name || `${fileId}.${fileType.split('/')[1]}`);
  console.log(`Uploaded to Telegram, chunk ID: ${chunkId}`);

  const metadata: FileMetadata = {
    id: fileId,
    userId: user.id,
    filename: file.name || `${fileId}.${fileType.split('/')[1]}`,
    size: file.size,
    chunks: 1,
    chunkIds: [chunkId],
    expiresAt: expiryHours ? new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString() : null,
    fileType: fileType,
    uploadedAt: new Date().toISOString(),
    status: 'completed'
  };

  console.log('Saving file metadata');
  await saveFileMetadata(c.env.FILES, `file:${fileId}`, metadata);

  const host = c.req.header('Host') || '';
  const protocol = c.req.header('X-Forwarded-Proto') || 'https';
  const fullUrl = `${protocol}://${host}/d/${fileId}`;
  console.log(`Download URL generated - ${fullUrl}`);

  const totalTime = Date.now() - startTime;
  console.log(`Total processing time - ${totalTime}ms`);

  await writeAnalytics(c.env.ANALYTICS_ENGINE, {
    action: 'upload',
    fileType: fileType,
    fileSize: file.size,
    isChunked: false,
    totalTime: totalTime
  });

  // Trigger pre-caching asynchronously
  c.executionCtx.waitUntil(preCacheChunkUrls(c.env, fileId));

  return c.json({
    Code: 1,
    Message: 'File uploaded successfully',
    url: fullUrl,
    filename: metadata.filename
  });
}