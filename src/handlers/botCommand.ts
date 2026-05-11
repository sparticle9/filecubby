import { Context } from 'hono'
import { Env } from '../index'

export async function handleBotCommand(c: Context<{ Bindings: Env }>) {
  const { BOT_TOKEN } = c.env
  const update = await c.req.json()
  
  console.log('Received update:', JSON.stringify(update, null, 2))

  if (update.message) {
    const chatId = update.message.chat.id
    const messageId = update.message.message_id
    const text = update.message.text

    console.log(`Received message: "${text}" in chat ${chatId}`)

    if (text === '/getid' || text === '/getid@your_bot_username') {
      // Check if this message is replying to another message
      if (update.message.reply_to_message) {
        const originalMessage = update.message.reply_to_message

        // Check if the original message contains a document, photo, video, or audio
        let telegramFileId = null
        if (originalMessage.document) {
          telegramFileId = originalMessage.document.file_id
        } else if (originalMessage.photo) {
          // For photos, get the file_id of the largest size
          telegramFileId = originalMessage.photo[originalMessage.photo.length - 1].file_id
        } else if (originalMessage.video) {
          telegramFileId = originalMessage.video.file_id
        } else if (originalMessage.audio) {
          telegramFileId = originalMessage.audio.file_id
        }

        if (telegramFileId) {
          const replyText = `Telegram file_id: ${telegramFileId}\nFilecubby object IDs are available through captions, manifests, API, or CLI metadata.`
          await sendTelegramMessage(BOT_TOKEN, chatId, replyText, messageId)
        } else {
          await sendTelegramMessage(BOT_TOKEN, chatId, "The message you're replying to doesn't contain Telegram file media.", messageId)
        }
      } else {
        await sendTelegramMessage(BOT_TOKEN, chatId, "Please use this command as a reply to a message containing Telegram file media.", messageId)
      }
    } else {
      console.log('Received non-command message')
    }
  } else {
    console.log('Received update without message')
  }

  return c.json({ ok: true })
}

async function sendTelegramMessage(botToken: string, chatId: string, text: string, replyToMessageId: number) {
  console.log(`Sending message to chat ${chatId}: "${text}"`)
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      reply_to_message_id: replyToMessageId,
    }),
  })
  const result: any = await response.json()
  console.log('Telegram API response:', JSON.stringify(result, null, 2))
  if (!result.ok) {
    console.error('Failed to send message:', result.description)
  }
}
