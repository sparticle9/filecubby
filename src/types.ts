export interface FileMetadata {
  fileName: string;
  fileSize: number;
  fileType: string;
  isChunked: boolean;
  uploadTime: number;
  expiryTime: number;
  messageId: string;
  chatId: string;
  chunkIds?: Array<{
    fileId: string;
    messageId: string;
  }>;
}