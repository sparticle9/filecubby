import { Context } from 'hono'
import { Env } from '../index'
import { deleteFileMetadata, getFileMetadata, archiveFile } from '../db'
import { User } from '../db'

export async function deleteFile(c: Context<{ Bindings: Env, Variables: { user: User } }>) {
  const user = c.get('user')
  if (!user) {
    return c.json({ Code: 0, Message: 'Unauthorized' }, 401)
  }

  try {
    const { fileId } = await c.req.json()
    if (!fileId) {
      return c.json({ Code: 0, Message: 'File ID is required' }, 400)
    }

    console.log(`Deleting file ${fileId} for user ${user.id}`)

    const file = await getFileMetadata(c.env.METADB, fileId)
    if (!file) {
      return c.json({ Code: 0, Message: 'File not found' }, 404)
    }

    if (file.userId !== user.id && user.username !== 'admin') {
      return c.json({ Code: 0, Message: 'Unauthorized to delete this file' }, 403)
    }

    // Archive the file metadata
    await archiveFile(c.env.METADB, file)

    // Delete file metadata from the main table
    await deleteFileMetadata(c.env.METADB, fileId, file.userId)

    console.log(`File ${fileId} deleted successfully by user ${user.id}`)
    return c.json({ Code: 1, Message: 'File deleted successfully' })
  } catch (error) {
    console.error('Error in deleteFile:', error)
    return c.json({ Code: 0, Message: 'Failed to delete file' }, 500)
  }
}

// We'll keep this function for potential future use, but we won't call it for now
async function deleteMessageFromTelegram(botToken: string, channelId: string, messageId: string) {
  console.log(`Attempting to delete message ${messageId} from channel ${channelId}`)
  const response = await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: channelId,
      message_id: messageId,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    console.error(`Failed to delete message from Telegram: ${error.description}`)
    // We don't throw here to continue with other operations
  } else {
    console.log(`Successfully deleted message ${messageId} from Telegram`)
  }
}