import { Context } from 'hono'
import { Env } from '../index'
import { createUser, updateUser, deleteUser } from '../db'
import { generateSecureToken } from '../utils'

export async function handleUserManagement(c: Context<{ Bindings: Env }>, action: string) {
  const user = c.get('user')
  if (!user || user.username !== 'admin') {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  switch (action) {
    case 'create':
      return handleCreateUser(c)
    case 'update':
      return handleUpdateUser(c)
    case 'delete':
      return handleDeleteUser(c)
    default:
      return c.json({ error: 'Invalid action' }, 400)
  }
}

function generateUserId(): string {
  return Math.random().toString(36).substring(2, 6).toUpperCase()
}

async function handleCreateUser(c: Context<{ Bindings: Env }>) {
  const { username } = await c.req.json()
  const token = generateSecureToken()
  const user = { id: generateUserId(), token, username, enabled: true }
  await createUser(c.env.METADB, user)
  return c.json({ message: 'User created', token, id: user.id })
}

async function handleUpdateUser(c: Context<{ Bindings: Env }>) {
  const { id, enabled } = await c.req.json()
  await updateUser(c.env.METADB, id, { enabled })
  return c.json({ message: 'User updated' })
}

async function handleDeleteUser(c: Context<{ Bindings: Env }>) {
  const { id } = await c.req.json()
  await deleteUser(c.env.METADB, id)
  return c.json({ message: 'User deleted' })
}