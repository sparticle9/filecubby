import { Env } from './index'
import { deleteObjectMetadata, getExpiredObjects, ObjectMetadata } from './db'
import { deleteMessageFromTelegram } from './utils/tgFileOps'

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
  if (object.chunks <= 1) {
    await deleteMessageFromTelegram(env.BOT_TOKEN, env.CHAT_ID, object.chunkIds[0])
  } else {
    for (const chunkId of object.chunkIds) {
      await deleteMessageFromTelegram(env.BOT_TOKEN, env.CHAT_ID, chunkId)
    }
  }

  await deleteObjectMetadata(env.FILES, objectId)
}
