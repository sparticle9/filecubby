import { Hono } from 'hono'
import { uploadFile } from './handlers/upload'
import { downloadFile } from './handlers/download'
import { deleteExpiredFiles } from './handlers/expiry'
import { uploadPic } from './handlers/uploadPic'

const app = new Hono<{ Bindings: Env }>()

app.post('/api/upload', uploadFile)
app.get('/d/:fileId', downloadFile)
app.post('/api/delete-expired', deleteExpiredFiles)
app.post('/api/pic', uploadPic)

export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(deleteExpiredFiles(env))
  },
}

export interface Env {
  BOT_TOKEN: string
  CHANNEL_ID: string
  CHUNK_SIZE: string
  FILE_METADATA: KVNamespace
  TASKS: KVNamespace
  PIC_MAX_SIZE: string
}
