import { Hono } from 'hono'
import { uploadHandler, finalizeUploadHandler, getUploadStatusHandler } from './handlers/upload'
import { handleFileDownload, handlePartialDownload } from './handlers/download'
import { deleteExpiredFiles } from './handlers/expiry'
import { uploadPic } from './handlers/uploadPic'
import { deleteFile } from './handlers/deleteFile'
import { handleBotCommand } from './handlers/botCommand'
import { getUser, User } from './db'
import { handleUserManagement } from './handlers/userManagement'
import { handleExpiryTask } from './expiryTask'
import { writeAnalytics } from './utils/analytics'
import { clearCache, getCacheStatus, getCacheCount } from './handlers/cache'

const app = new Hono<{ Bindings: Env, Variables: { user: User } }>()

// Authentication middleware
const authMiddleware = async (c, next) => {
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

// Admin authentication middleware
const adminAuthMiddleware = async (c, next) => {
  const authHeader = c.req.header('Authorization')
  
  if (!authHeader) {
    return c.json({ Code: 0, Message: 'Unauthorized: No Authorization header' }, 401)
  }

  const [authType, token] = authHeader.split(' ')

  if (authType.toLowerCase() !== 'bearer' || !token) {
    return c.json({ Code: 0, Message: 'Unauthorized: Invalid Authorization header' }, 401)
  }

  if (token !== c.env.ADMIN_TOKEN) {
    return c.json({ Code: 0, Message: 'Unauthorized: Invalid admin token' }, 401)
  }

  await next()
}

// Apply authentication middleware to all routes except /d/:fileId and /api/pic
app.use('*', async (c, next) => {
  if (c.req.path.startsWith('/d/') || c.req.path === '/api/pic') {
    await next()
  } else {
    await authMiddleware(c, next)
  }
})

// Cache management routes
app.post('/api/cache/clear', adminAuthMiddleware, clearCache)
app.get('/api/cache/status', adminAuthMiddleware, getCacheStatus)
app.get('/api/cache/count', getCacheCount)

// File upload routes
app.post('/api/upload', uploadHandler)
app.post('/api/upload/finalize/:fileId', finalizeUploadHandler)
app.get('/api/upload/status/:fileId', getUploadStatusHandler)

// File download routes
app.get('/d/:fileId', handleFileDownload)
app.get('/d/:fileId/partial', handlePartialDownload)

// Other routes
app.post('/api/delete-expired', deleteExpiredFiles)
app.post('/api/pic', uploadPic)
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

// Add error handling middleware
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ Code: 0, Message: 'An unexpected error occurred' }, 500);
});

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
  MAX_CHUNK_SIZE: number;
  MAX_IMAGE_SIZE: number;
  CACHE_CHUNK_URL_MAX_RETRY: number;
  CACHE_CHUNK_URL_TIMEOUT: number;
  EDGE_CACHE_CHUNK_TTL: number;
  EDGE_CACHE_MAX_CHUNK_SIZE: number;
  ANALYTICS_ENGINE: AnalyticsEngineDataset;
  TG_USER_AGENT: string;
  ADMIN_TOKEN: string;
  CACHE_CHUNK_EDGE_ON_UPLOAD: string;
  // ... any other environment bindings
}