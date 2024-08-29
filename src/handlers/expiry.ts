import { Context } from 'hono'
import { Env } from '../index'

export async function deleteExpiredFiles(env: Env) {
  const { BOT_TOKEN, CHANNEL_ID, FILE_METADATA, TASKS } = env
  const now = Date.now()

  // List all keys with prefix 'file:'
  const { keys } = await FILE_METADATA.list({ prefix: 'file:' })

  for (const key of keys) {
    const metadata = await FILE_METADATA.get(key.name, 'json')
    if (metadata && metadata.expiryTime < now) {
      // Add delete task to TASKS KV
      await TASKS.put(`delete:${key.name}`, JSON.stringify({
        fileId: key.name.split(':')[1],
        isChunked: metadata.isChunked,
        chunkIds: metadata.chunkIds,
      }))
    }
  }

  // Process delete tasks
  const { keys: taskKeys } = await TASKS.list({ prefix: 'delete:' })
  for (const taskKey of taskKeys) {
    const task = await TASKS.get(taskKey.name, 'json')
    if (task) {
      if (task.isChunked) {
        for (const chunkId of task.chunkIds) {
          await deleteMessageFromTelegram(BOT_TOKEN, CHANNEL_ID, chunkId)
        }
      }
      await deleteMessageFromTelegram(BOT_TOKEN, CHANNEL_ID, task.fileId)
      await FILE_METADATA.delete(`file:${task.fileId}`)
      await TASKS.delete(taskKey.name)
    }
  }
}

async function deleteMessageFromTelegram(botToken: string, channelId: string, messageId: string) {
  await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: channelId, message_id: messageId }),
  })
}