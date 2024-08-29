export interface FileMetadata {
  fileName: string
  fileSize: number
  isChunked: boolean
  chunkIds?: string[]
  uploadTime: number
  expiryTime: number
  mediaType?: 'document' | 'audio' | 'video' | 'sticker'
}