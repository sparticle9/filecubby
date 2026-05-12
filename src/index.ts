import { Hono } from 'hono'
import { uploadHandler, finalizeUploadHandler, getUploadStatusHandler } from './handlers/upload'
import { handleFileDownload, handleFileHead, handlePartialDownload } from './handlers/download'
import { deleteExpiredObjectsHandler } from './handlers/expiry'
import { uploadImage } from './handlers/uploadImage'
import { deleteObject } from './handlers/deleteObject'
import { handleBotCommand } from './handlers/botCommand'
import { getUser, User } from './db'
import { handleUserManagement } from './handlers/userManagement'
import { createToken, listTokens, patchToken, removeToken } from './handlers/tokens'
import { handleExpiryTask } from './expiryTask'
import { clearCache, getCacheStatus, getCacheCount } from './handlers/cache'
import { listObjects, getObject, patchObject } from './handlers/objects'
import { createCollectionHandler, deleteCollectionHandler, getCollectionHandler, listCollectionsHandler, patchCollectionHandler } from './handlers/collections'
import { openApiHandler } from './handlers/openapi'
import { consoleHandler } from './handlers/console'
import { importTelegramMetadata } from './handlers/repair'

const app = new Hono<{ Bindings: Env, Variables: { user: User } }>()

// Authentication middleware
const authMiddleware = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization')
  
  if (!authHeader) {
    return c.json({ Code: 0, Message: 'Unauthorized: No Authorization header' }, 401)
  }

  const [authType, token] = authHeader.split(' ')

  if (authType.toLowerCase() !== 'bearer' || !token) {
    return c.json({ Code: 0, Message: 'Unauthorized: Invalid Authorization header' }, 401)
  }

  try {
    if (token === c.env.ADMIN_TOKEN) {
      c.set('user', { id: 'ADMIN', token: '', username: 'admin', enabled: true })
      return await next()
    }

    const user = await getUser(c.env.USERS, token)

    if (!user) {
      console.error('Middleware: Invalid token or user not found')
      return c.json({ Code: 0, Message: 'Unauthorized: Invalid token' }, 401)
    }

    c.set('user', user)
    return await next()
  } catch (error) {
    console.error('Error in authentication middleware:', error)
    return c.json({ Code: 0, Message: 'Internal Server Error' }, 500)
  }
}

// Admin authentication middleware
const adminAuthMiddleware = async (c: any, next: any) => {
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

  return await next()
}

// Apply authentication middleware to all routes except public download, image upload, and utility routes.
app.use('*', async (c, next) => {
  if (
    c.req.path.startsWith('/d/') ||
    c.req.path === '/api/upload/image' ||
    c.req.path === '/test' ||
    c.req.path === '/openapi.json' ||
    c.req.path === '/console' ||
    c.req.path.startsWith('/api/tokens') ||
    c.req.path.startsWith('/api/cache/') ||
    c.req.path.startsWith('/api/repair/')
  ) {
    return await next()
  } else {
    return await authMiddleware(c, next)
  }
})

// Cache management routes
app.post('/api/cache/clear', adminAuthMiddleware, clearCache)
app.get('/api/cache/status', adminAuthMiddleware, getCacheStatus)
app.get('/api/cache/count', adminAuthMiddleware, getCacheCount)
app.post('/api/repair/import-telegram', adminAuthMiddleware, importTelegramMetadata)

// Object upload routes
app.post('/api/upload', uploadHandler)
app.post('/api/upload/finalize/:objectId', finalizeUploadHandler)
app.get('/api/upload/status/:objectId', getUploadStatusHandler)

// Object metadata and organization routes
app.get('/api/objects', listObjects)
app.get('/api/objects/:id', getObject)
app.patch('/api/objects/:id', patchObject)
app.get('/api/collections', listCollectionsHandler)
app.post('/api/collections', createCollectionHandler)
app.get('/api/collections/:id', getCollectionHandler)
app.patch('/api/collections/:id', patchCollectionHandler)
app.delete('/api/collections/:id', deleteCollectionHandler)

// Object download routes
app.on('HEAD', '/d/:objectId', handleFileHead)
app.get('/d/:objectId', handleFileDownload)
app.get('/d/:objectId/partial', handlePartialDownload)

// Other routes
app.post('/api/delete-expired', deleteExpiredObjectsHandler)
app.post('/api/upload/image', uploadImage)
app.post('/api/del', deleteObject)
app.post('/bot-webhook', handleBotCommand)

// User management routes
app.get('/api/tokens', adminAuthMiddleware, listTokens)
app.post('/api/tokens', adminAuthMiddleware, createToken)
app.patch('/api/tokens/:id', adminAuthMiddleware, patchToken)
app.delete('/api/tokens/:id', adminAuthMiddleware, removeToken)

app.post('/api/users/create', (c) => handleUserManagement(c, 'create'))
app.put('/api/users/create', (c) => handleUserManagement(c, 'create'))
app.post('/api/users/update', (c) => handleUserManagement(c, 'update'))
app.put('/api/users/update', (c) => handleUserManagement(c, 'update'))
app.post('/api/users/delete', (c) => handleUserManagement(c, 'delete'))

app.get('/test', (c) => {
  console.log('Test route hit')
  return c.text('Test successful')
})
app.get('/openapi.json', openApiHandler)
app.get('/console', consoleHandler)

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
  CHAT_ID?: string;
  MAX_CHUNK_SIZE: string | number;
  MAX_IMAGE_SIZE: string | number;
  CACHE_CHUNK_URL_MAX_RETRY: string | number;
  CACHE_CHUNK_URL_TIMEOUT: string | number;
  EDGE_CACHE_CHUNK_TTL: string | number;
  EDGE_CACHE_MAX_CHUNK_SIZE: string | number;
  ANALYTICS_ENGINE: AnalyticsEngineDataset;
  TG_USER_AGENT: string;
  ADMIN_TOKEN: string;
  CACHE_CHUNK_EDGE_ON_UPLOAD: string;
  TELEGRAM_ORGANIZATION_MODE?: string;
  FILECUBBY_MARKER?: string;
}
