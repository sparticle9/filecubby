import { Env } from './index'
import { deleteObjectMetadata, getExpiredObjects, ObjectMetadata } from './db'
import { deleteMessageFromTelegram, resolveTelegramChatId } from './utils/tgFileOps'

export async function handleExpiryTask(env: Env): Promise<void> {
  const expiredObjects = await getExpiredObjects(env.FILES)

  for (const object of expiredObjects) {
    try {
      await deleteObject(env, object.id, object)
      console.log(`Deleted expired object: ${object.id}`)
    } catch (error) {
      console.error(`Failed to delete expired object ${object.id}:`, error)
    }
  }
}

async function deleteObject(env: Env, objectId: string, object: ObjectMetadata): Promise<void> {
  const chatId = await resolveTelegramChatId(env)
  if (object.chunks <= 1) {
    await deleteMessageFromTelegram(env.BOT_TOKEN, chatId, object.chunkIds[0])
  } else {
    for (const chunkId of object.chunkIds) {
      await deleteMessageFromTelegram(env.BOT_TOKEN, chatId, chunkId)
    }
  }

  await deleteObjectMetadata(env.FILES, objectId)
}
