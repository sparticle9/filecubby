import { Context } from 'hono'
import { Env } from '../index'
import { DEFAULT_NAMESPACE_ID, ObjectMetadata, User } from '../db'
import { getObjectMetadata, saveObjectMetadata, updateObjectMetadata, validateObjectMetadata } from '../db'
import { generateObjectId } from '../utils'
import { buildChunkCaption, preCacheSingleChunkUrl, resolveTelegramChatId, sendTelegramManifest, shouldSendTelegramManifest, uploadToTelegramDocument } from './tgFileOps'
import { cacheChunk, getCachedChunk } from './cache'
import { applyMetadataInputs, effectiveMaxChunkSize, TELEGRAM_BACKEND } from './metadata'

export async function initializeUpload(c: Context<{ Bindings: Env }>, user: User, formData: FormData) {
  console.log(`Initializing upload for user ${user.id}`);
  try {
    const objectId = await generateObjectId(c.env.FILES);
    const objectName = formString(formData, 'objectName');
    const objectSize = parseInt(formString(formData, 'objectSize'), 10);
    const objectType = formString(formData, 'objectType') || 'application/octet-stream';
    const totalChunks = parseInt(formString(formData, 'totalChunks'), 10);
    const chunkSize = parseInt(formString(formData, 'chunkSize'), 10);
    const expiryHours = formData.get('expiryHours') ? parseInt(formString(formData, 'expiryHours'), 10) : null;
    const maxChunkSize = effectiveMaxChunkSize(c.env);

    if (!objectName) {
      return c.json({ Code: 0, Message: 'objectName is required' }, 400);
    }
    if (!Number.isFinite(objectSize) || objectSize < 0) {
      return c.json({ Code: 0, Message: 'objectSize must be a non-negative number' }, 400);
    }
    if (!Number.isFinite(totalChunks) || totalChunks <= 0) {
      return c.json({ Code: 0, Message: 'totalChunks must be a positive number' }, 400);
    }
    if (!Number.isFinite(chunkSize) || chunkSize <= 0 || chunkSize > maxChunkSize) {
      return c.json({ Code: 0, Message: `Chunk size must be at most ${maxChunkSize} bytes for the public Telegram Bot API backend` }, 400);
    }

    const metadata = createObjectMetadata({
      objectId,
      userId: user.id,
      objectName,
      objectSize,
      objectType,
      totalChunks,
      chunkSize,
      expiresAt: expiryHours ? new Date(Date.now() + expiryHours * 3600000).toISOString() : null,
    });

    applyMetadataInputs(metadata, {
      path: optionalFormValue(formData, 'path'),
      tags: optionalFormValue(formData, 'tags'),
      collectionIds: optionalFormValue(formData, 'collectionIds'),
      description: optionalFormValue(formData, 'description'),
    }, false);

    await saveObjectMetadata(c.env.FILES, metadata, true);

    console.log(`Upload initialized for object ${objectId}. Metadata saved:`, JSON.stringify(metadata, null, 2));
    return c.json({
      Code: 1,
      Message: 'Upload initialized successfully',
      objectId,
      totalChunks,
    });
  } catch (error) {
    console.error('Error initializing upload:', error);
    return c.json({ Code: 0, Message: `Failed to initialize upload: ${error.message}` }, 500);
  }
}

export async function handleChunkUpload(
  c: Context<{ Bindings: Env }>,
  user: User,
  objectBlob: File | Blob,
  expiryHours: number | null,
  objectId: string,
  providedFormData?: FormData
) {
  try {
    const formData = providedFormData ?? await c.req.formData();
    const isChunk = formData.get('isChunk') === 'true';
    const chunkIndex = parseInt(formString(formData, 'chunkIndex') || '0', 10);
    const totalChunks = parseInt(formString(formData, 'totalChunks') || '1', 10);
    const objectType = formString(formData, 'objectType') || (objectBlob instanceof File ? objectBlob.type : 'application/octet-stream');
    const objectName = formString(formData, 'objectName') || (objectBlob instanceof File ? objectBlob.name : 'unknown');
    const objectSize = objectBlob instanceof File ? objectBlob.size : parseInt(formString(formData, 'objectSize') || '0', 10);
    const chunkSize = parseInt(formString(formData, 'chunkSize') || '0', 10);
    const maxChunkSize = effectiveMaxChunkSize(c.env);

    if (objectBlob instanceof File && objectBlob.size > maxChunkSize) {
      return c.json({ Code: 0, Message: `Chunk size must be at most ${maxChunkSize} bytes for the public Telegram Bot API backend` }, 400);
    }
    if (Number.isFinite(chunkSize) && chunkSize > maxChunkSize) {
      return c.json({ Code: 0, Message: `Chunk size must be at most ${maxChunkSize} bytes for the public Telegram Bot API backend` }, 400);
    }

    const expiryHoursStr = formString(formData, 'expiryHours');
    const expiryHoursParsed = expiryHoursStr ? parseInt(expiryHoursStr, 10) : expiryHours;
    if (expiryHoursParsed !== null && expiryHoursParsed !== undefined && isNaN(expiryHoursParsed)) {
      throw new Error(`Invalid expiryHours value: ${expiryHoursStr}`);
    }

    if (isChunk && !objectId) {
      throw new Error('Object ID is required for chunk uploads');
    }

    console.log(`Handling upload for user ${user.id}, object type: ${objectType}`);
    console.log(`Processing chunk ${chunkIndex + 1} of ${totalChunks} for object ${objectId} (${objectName})`);
    const telegramChatId = await resolveTelegramChatId(c.env);

    let metadata: ObjectMetadata;

    if (!isChunk || chunkIndex === 0) {
      metadata = await getObjectMetadata(c.env.FILES, objectId) || createObjectMetadata({
        objectId,
        userId: user.id,
        objectName,
        objectSize,
        objectType,
        totalChunks,
        chunkSize,
        expiresAt: null,
      });

      applyMetadataInputs(metadata, {
        path: optionalFormValue(formData, 'path'),
        tags: optionalFormValue(formData, 'tags'),
        collectionIds: optionalFormValue(formData, 'collectionIds'),
        description: optionalFormValue(formData, 'description'),
      }, false);

      if (expiryHoursParsed !== null && expiryHoursParsed !== undefined) {
        const expiresAt = new Date(Date.now() + expiryHoursParsed * 3600000);
        if (isNaN(expiresAt.getTime())) {
          throw new RangeError('Invalid expiry date calculated');
        }
        metadata.expiresAt = expiresAt.toISOString();
      }

      const uploaded = await uploadToTelegramDocument(c.env, c.env.BOT_TOKEN, telegramChatId, objectBlob, objectName, objectType, {
        caption: buildChunkCaption(c.env, metadata, chunkIndex),
      });
      metadata.chunkIds[chunkIndex] = uploaded.chunkId;
      if (uploaded.messageId) {
        metadata.chunkMessageIds = metadata.chunkMessageIds || new Array(totalChunks).fill(null);
        metadata.chunkMessageIds[chunkIndex] = uploaded.messageId;
      }

      await saveObjectMetadata(c.env.FILES, metadata, !isChunk);
      console.log(`Object metadata created or updated:`, JSON.stringify(metadata, null, 2));
    } else {
      const existing = await getObjectMetadata(c.env.FILES, objectId);
      if (!existing) {
        throw new Error('Metadata not found');
      }
      const uploaded = await uploadToTelegramDocument(c.env, c.env.BOT_TOKEN, telegramChatId, objectBlob, objectName, objectType, {
        caption: buildChunkCaption(c.env, existing, chunkIndex),
      });
      metadata = await updateObjectMetadata(c.env.FILES, objectId, (existingMetadata) => {
        existingMetadata.chunkIds[chunkIndex] = uploaded.chunkId;
        if (uploaded.messageId) {
          existingMetadata.chunkMessageIds = existingMetadata.chunkMessageIds || new Array(existingMetadata.chunks).fill(null);
          existingMetadata.chunkMessageIds[chunkIndex] = uploaded.messageId;
        }
        existingMetadata.updatedAt = new Date().toISOString();
        return existingMetadata;
      });
    }

    if (c.env.CACHE_CHUNK_EDGE_ON_UPLOAD === 'true') {
      const cachedChunk = await getCachedChunk(c.env, objectId, chunkIndex);
      if (!cachedChunk) {
        const chunkData = await objectBlob.arrayBuffer();
        console.log(`Caching chunk for object ID: ${objectId}, chunk index: ${chunkIndex}, MIME type: ${objectType}`);
        await cacheChunk(c.env, objectId, chunkIndex, chunkData, objectType);
      } else {
        console.log(`Chunk already cached for object ID: ${objectId}, chunk index: ${chunkIndex}`);
      }
    }

    c.executionCtx.waitUntil(preCacheSingleChunkUrl(c.env, objectId, chunkIndex));

    console.log(`Chunk ${chunkIndex + 1} of ${totalChunks} processed successfully for object ${objectId}`);

    const response: any = {
      Code: 1,
      Message: 'Chunk uploaded successfully',
      objectId,
      chunkIndex,
      totalChunks,
    };

    if (chunkIndex === totalChunks - 1 || !isChunk) {
      console.log('Processing last chunk or single object upload, preparing to generate download URL');

      const host = c.req.header('Host') || '';
      const protocol = c.req.header('X-Forwarded-Proto') || 'https';

      if (!host) {
        throw new Error('Unable to determine host for download URL');
      }

      response.url = `${protocol}://${host}/d/${objectId}`;

      if (shouldSendTelegramManifest(c.env) && !metadata.manifestMessageId) {
        const manifestMessageId = await sendTelegramManifest(c.env, metadata);
        if (manifestMessageId) {
          await updateObjectMetadata(c.env.FILES, objectId, (existingMetadata) => {
            existingMetadata.manifestMessageId = manifestMessageId;
            existingMetadata.updatedAt = new Date().toISOString();
            return existingMetadata;
          });
        }
      }
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

export async function finalizeUpload(c: Context<{ Bindings: Env }>, objectId: string) {
  console.log(`Finalizing upload for object ${objectId}`);
  try {
    const metadata = await getObjectMetadata(c.env.FILES, objectId);
    if (!metadata) {
      throw new Error('Metadata not found');
    }

    if (metadata.chunkIds.some(id => id === null)) {
      throw new Error('Not all chunks have been uploaded');
    }

    const validationResult = validateObjectMetadata(metadata, false);
    if (!validationResult.isValid) {
      throw new Error(`Invalid metadata: ${validationResult.error}`);
    }

    console.log(`Upload finalized successfully for object ${objectId}`);
    return c.json({ Code: 1, Message: 'Upload finalized successfully', objectId });
  } catch (error) {
    console.error('Error finalizing upload:', error);
    return c.json({ Code: 0, Message: `Failed to finalize upload: ${error.message}` }, 500);
  }
}

export async function getUploadStatus(c: Context<{ Bindings: Env }>, objectId: string) {
  console.log(`Getting upload status for object ${objectId}`);
  try {
    const metadata = await getObjectMetadata(c.env.FILES, objectId);
    if (!metadata) {
      return c.json({ Code: 0, Message: 'Object not found' }, 404);
    }

    const uploadedChunks = metadata.chunkIds.filter(Boolean).length;
    const status = uploadedChunks === metadata.chunks ? 'complete' : 'in progress';

    return c.json({
      Code: 1,
      Message: 'Upload status retrieved successfully',
      objectId,
      status,
      uploadedChunks,
      totalChunks: metadata.chunks,
    });
  } catch (error) {
    console.error('Error getting upload status:', error);
    return c.json({ Code: 0, Message: 'Failed to get upload status' }, 500);
  }
}

function createObjectMetadata(input: {
  objectId: string;
  userId: string;
  objectName: string;
  objectSize: number;
  objectType: string;
  totalChunks: number;
  chunkSize: number;
  expiresAt: string | null;
}): ObjectMetadata {
  return {
    namespaceId: DEFAULT_NAMESPACE_ID,
    id: input.objectId,
    userId: input.userId,
    name: input.objectName,
    size: input.objectSize,
    type: input.objectType,
    chunks: input.totalChunks,
    chunkSize: Number.isFinite(input.chunkSize) && input.chunkSize > 0 ? input.chunkSize : undefined,
    chunkIds: new Array(input.totalChunks).fill(null),
    chunkMessageIds: new Array(input.totalChunks).fill(null),
    uploadedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: input.expiresAt,
    path: '/',
    tags: [],
    collectionIds: [],
    backend: TELEGRAM_BACKEND,
    createdByTokenId: input.userId,
  };
}

function optionalFormValue(formData: FormData, name: string): FormDataEntryValue | undefined {
  return formData.has(name) ? formData.get(name) || undefined : undefined;
}

function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}
