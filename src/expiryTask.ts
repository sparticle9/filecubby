import { Env } from './index'
import { deleteFile } from './fileOperations'
import { getExpiredFiles, deleteFileMetadata } from './db'

export async function handleExpiryTask(env: Env): Promise<void> {
  const expiredFiles = await getExpiredFiles(env.METADB)

  for (const file of expiredFiles) {
    try {
      if (file.chunks === 0) {
        // Single file deletion
        await deleteFile(env, file.id, { id: file.userId, token: '', username: '', enabled: true })
      } else {
        // Chunked file deletion
        for (const chunkId of file.chunkIds) {
          await deleteFileFromTelegram(env.BOT_TOKEN, chunkId)
        }
      }
      await deleteFileMetadata(env.METADB, file.id, file.userId)
      console.log(`Deleted expired file: ${file.id}`)
    } catch (error) {
      console.error(`Failed to delete expired file ${file.id}:`, error)
    }
  }
}

async function deleteFileFromTelegram(botToken: string, fileId: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: process.env.CHANNEL_ID,
      message_id: fileId,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(`Failed to delete file from Telegram: ${error.description}`)
  }
}