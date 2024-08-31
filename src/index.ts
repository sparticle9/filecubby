import { Hono } from 'hono'
import { uploadHandler } from './handlers/upload'
import { downloadFile } from './handlers/download'
import { deleteExpiredFiles } from './handlers/expiry'
import { uploadPic } from './handlers/uploadPic'
import { deleteFile } from './handlers/deleteFile'
import { handleBotCommand } from './handlers/botCommand'
import { D1Database } from '@cloudflare/workers-types'
import { getUser, User } from './db'
import { handleUserManagement } from './handlers/userManagement'
import { handleExpiryTask } from './expiryTask'
import { writeAnalytics } from './utils/analytics';

const app = new Hono<{ Bindings: Env, Variables: { user: User } }>()

// Authentication middleware
const authMiddleware = async (c: Context<{ Bindings: Env }>, next: () => Promise<void>) => {
  const authHeader = c.req.header('Authorization')
  
  if (!authHeader) {
    return c.json({ Code: 0, Message: 'Unauthorized: No Authorization header' }, 401)
  }

  const [authType, token] = authHeader.split(' ')

  if (authType.toLowerCase() !== 'bearer' || !token) {
    return c.json({ Code: 0, Message: 'Unauthorized: Invalid Authorization header' }, 401)
  }

  try {
    const user = await getUser(c.env.USERS, token)

    if (!user) {
      console.error('Middleware: Invalid token or user not found')
      return c.json({ Code: 0, Message: 'Unauthorized: Invalid token' }, 401)
    }

    c.set('user', user)
    await next()
  } catch (error) {
    console.error('Error in authentication middleware:', error)
    return c.json({ Code: 0, Message: 'Internal Server Error' }, 500)
  }
}

// Apply authentication middleware to all routes except /d/:fileId and /api/pic
app.use('*', async (c, next) => {
  if (c.req.path.startsWith('/d/') || c.req.path === '/api/pic') {
    await next()
  } else {
    await authMiddleware(c, next)
  }
})

// Modify the upload handler
app.post('/api/upload', async (c) => {
  const result = await uploadHandler(c);
  return result;
});

// Modify the download handler
app.get('/d/:fileId', async (c) => {
  return await downloadFile(c);
});

// Add error handling middleware
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ Code: 0, Message: 'An unexpected error occurred' }, 500);
});

app.post('/api/delete-expired', deleteExpiredFiles)
app.post('/api/pic', async (c) => {
  try {
    const result = await uploadPic(c)
    return result
  } catch (error) {
    console.error('Error in /api/pic handler:', error)
    return c.json({ Code: 0, Message: 'Internal server error' }, 500)
  }
})
app.post('/api/del', deleteFile)
app.post('/bot-webhook', handleBotCommand)

// User management routes
app.post('/api/users/create', (c) => handleUserManagement(c, 'create'))
app.put('/api/users/create', (c) => handleUserManagement(c, 'create'))
app.post('/api/users/update', (c) => handleUserManagement(c, 'update'))
app.put('/api/users/update', (c) => handleUserManagement(c, 'update'))
app.post('/api/users/delete', (c) => handleUserManagement(c, 'delete'))

app.get('/test', (c) => {
  console.log('Test route hit')
  return c.text('Test successful')
})

export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(handleExpiryTask(env))
  },
}

export interface Env {
  USERS: KVNamespace;
  FILES: KVNamespace;
  FILE_DOWNLOAD_INFO: KVNamespace;
  TASKS: KVNamespace;
  BOT_TOKEN: string;
  CHANNEL_ID: string;
  CHUNK_SIZE: string;
  PIC_MAX_SIZE: string;
  MAX_RETRY_FROM_TG: string;
  ANALYTICS_ENGINE: AnalyticsEngineDataset;
  // ... any other environment bindings
}

// Remove the handleRequest function as it's no longer needed
