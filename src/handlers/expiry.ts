import { Context } from 'hono'
import { Env } from '../index'
import { DEFAULT_NAMESPACE_ID } from '../db'
import { resolveTelegramChatId } from '../utils/tgFileOps'

export async function deleteExpiredObjects(env: Env) {
  const { BOT_TOKEN, FILES, TASKS } = env
  const CHAT_ID = await resolveTelegramChatId(env)
  const now = Date.now()

  const { keys } = await FILES.list({ prefix: `object:${DEFAULT_NAMESPACE_ID}:` })

  for (const key of keys) {
    const metadata = await FILES.get<any>(key.name, 'json')
    if (metadata?.expiresAt && Date.parse(metadata.expiresAt) < now) {
      await TASKS.put(`delete:${key.name}`, JSON.stringify({
        objectId: key.name.split(':')[2],
        isChunked: metadata.chunks > 1,
        chunkIds: metadata.chunkIds,
      }))
    }
  }

  // Process delete tasks
  const { keys: taskKeys } = await TASKS.list({ prefix: 'delete:' })
  for (const taskKey of taskKeys) {
      const task = await TASKS.get<any>(taskKey.name, 'json')
      if (task) {
        if (task.isChunked) {
          for (const chunkId of task.chunkIds) {
          await deleteMessageFromTelegram(BOT_TOKEN, CHAT_ID, chunkId)
        }
      }
      await FILES.delete(`object:${DEFAULT_NAMESPACE_ID}:${task.objectId}`)
      await TASKS.delete(taskKey.name)
    }
  }
}

export async function deleteExpiredObjectsHandler(c: Context<{ Bindings: Env }>) {
  await deleteExpiredObjects(c.env);
  return c.json({ Code: 1, Message: 'Expired-object cleanup scheduled' });
}

async function deleteMessageFromTelegram(botToken: string, channelId: string, messageId: string) {
  await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: channelId, message_id: messageId }),
  })
}
