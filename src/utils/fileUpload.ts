import { Env } from '../index'
import { saveFileMetadata } from '../db'
import { generateFileId } from '../utils'

interface UploadResult {
  fileId: string
  url: string
  fullUrl: string
  filename: string
  chunkId: string
}

export async function uploadFile(
  env: Env,
  userId: string,
  file: File,
  fileType: string,
  expiryHours: number | null,
  isChunk: boolean,
  uploadToTelegramFn: (botToken: string, channelId: string, file: File, fileName: string) => Promise<string>,
  host: string,
  protocol: string
): Promise<UploadResult> {
  const { BOT_TOKEN, CHANNEL_ID, METADB, CHUNK_SIZE } = env;
  const fileId = generateFileId();
  const fileName = file.name || `file_${fileId}.${fileType.split('/')[1]}`;

  try {
    let metadata: FileMetadata;
    const expiresAt = expiryHours ? new Date(Date.now() + expiryHours * 60 * 60 * 1000) : null;
    const uploadedAt = new Date();

    const telegramFileId = await uploadToTelegramFn(BOT_TOKEN, CHANNEL_ID, file, fileName);

    if (!isChunk) {
      metadata = {
        id: fileId,
        userId: userId,
        filename: fileName,
        size: file.size,
        chunks: 1,
        chunkIds: [telegramFileId],
        expiresAt: expiresAt,
        fileType: fileType,
        uploadedAt: uploadedAt
      };
      await saveFileMetadata(METADB, metadata);
    }
    
    const url = `/d/${fileId}`;
    const fullUrl = `${protocol}://${host}${url}`;

    return {
      fileId: fileId,
      url: url,
      fullUrl: fullUrl,
      filename: fileName,
      chunkId: telegramFileId
    };
  } catch (error) {
    console.error('Error in uploadFile:', error);
    throw new Error(`Failed to upload file: ${error.message}`);
  }
}

export async function uploadChunkedFile(
  env: Env,
  userId: string,
  file: File,
  fileType: string,
  expiryHours: number | null,
  chunkSize: number,
  uploadToTelegramFn: (botToken: string, channelId: string, file: File, fileName: string) => Promise<string>
): Promise<{ fileId: string }> {
  const totalChunks = Math.ceil(file.size / chunkSize);
  const chunkIds: string[] = [];
  let fileId = generateFileId();

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = file.slice(start, end);
    const chunkName = `${file.name}.part${i + 1}`;

    const chunkId = await uploadToTelegramFn(env.BOT_TOKEN, env.CHANNEL_ID, chunk as File, chunkName);
    chunkIds.push(chunkId);
  }

  const metadata = {
    id: fileId,
    userId: userId,
    filename: file.name,
    size: file.size,
    chunks: totalChunks,
    chunkIds: chunkIds,
    expiresAt: expiryHours ? new Date(Date.now() + expiryHours * 60 * 60 * 1000) : null,
    fileType: fileType,
    uploadedAt: new Date()
  };

  await saveFileMetadata(env.METADB, metadata);

  return { fileId };
}

function determineFileType(file: File): string {
  // Map MIME types to Telegram file types
  const mimeTypeMap: { [key: string]: string } = {
    'image/jpeg': 'photo',
    'image/png': 'photo',
    'image/gif': 'document', // GIFs are sent as documents to preserve animation
    'video/mp4': 'video',
    'audio/mpeg': 'audio',
    'audio/ogg': 'voice', // .ogg files are typically used for voice messages
    'application/pdf': 'document',
    // Add more mappings as needed
  };

  return mimeTypeMap[file.type] || 'document'; // Default to 'document' for unknown types
}