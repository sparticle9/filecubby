import { Context } from 'hono'
import { Env } from '../index'
import { archiveObject, deleteObjectMetadata, getObjectMetadata } from '../db'
import { User } from '../db'

export async function deleteObject(c: Context<{ Bindings: Env, Variables: { user: User } }>) {
  const user = c.get('user')
  if (!user) {
    return c.json({ Code: 0, Message: 'Unauthorized' }, 401)
  }

  try {
    const { objectId } = await c.req.json()
    if (!objectId) {
      return c.json({ Code: 0, Message: 'Object ID is required' }, 400)
    }

    console.log(`Deleting object ${objectId} for user ${user.id}`)

    const object = await getObjectMetadata(c.env.FILES, objectId)
    if (!object) {
      return c.json({ Code: 0, Message: 'Object not found' }, 404)
    }

    if (object.userId !== user.id && user.username !== 'admin') {
      return c.json({ Code: 0, Message: 'Unauthorized to delete this object' }, 403)
    }

    await archiveObject(c.env.FILES, object)

    await deleteObjectMetadata(c.env.FILES, objectId)

    console.log(`Object ${objectId} deleted successfully by user ${user.id}`)
    return c.json({ Code: 1, Message: 'Object deleted successfully' })
  } catch (error) {
    console.error('Error in deleteObject:', error)
    return c.json({ Code: 0, Message: 'Failed to delete object' }, 500)
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
    const error: any = await response.json()
    console.error(`Failed to delete message from Telegram: ${error.description}`)
    // We don't throw here to continue with other operations
  } else {
    console.log(`Successfully deleted message ${messageId} from Telegram`)
  }
}
