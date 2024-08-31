import { Context } from 'hono'
import { Env } from '../index'
import { saveUser, getUser, getUserByUsername, updateUser, deleteUser } from '../db'
import { generateSecureToken, generateUserId } from '../utils'

export async function handleUserManagement(c: Context<{ Bindings: Env }>, action: string) {
  const adminToken = c.req.header('Authorization')?.split(' ')[1];
  const admin = await getUser(c.env.USERS, adminToken);
  
  if (!admin || admin.username !== 'admin') {
    return c.json({ Code: 0, Message: 'Unauthorized' }, 401);
  }

  switch (action) {
    case 'create':
      return handleCreateUser(c);
    case 'update':
      return handleUpdateUser(c);
    case 'delete':
      return handleDeleteUser(c);
    default:
      return c.json({ Code: 0, Message: 'Invalid action' }, 400);
  }
}

async function handleCreateUser(c: Context<{ Bindings: Env }>) {
  const { username } = await c.req.json();
  const existingUser = await getUserByUsername(c.env.USERS, username);
  if (existingUser) {
    return c.json({ Code: 0, Message: 'Username already exists' }, 400);
  }

  const token = generateSecureToken();
  const userId = generateUserId();
  const user = { id: userId, token, username, enabled: true };
  await saveUser(c.env.USERS, user);
  return c.json({ Code: 1, Message: 'User created successfully', token });
}

async function handleUpdateUser(c: Context<{ Bindings: Env }>) {
  const { username, enabled } = await c.req.json();
  const user = await getUserByUsername(c.env.USERS, username);
  if (!user) {
    return c.json({ Code: 0, Message: 'User not found' }, 404);
  }

  user.enabled = enabled;
  await updateUser(c.env.USERS, user);
  return c.json({ Code: 1, Message: 'User updated successfully' });
}

async function handleDeleteUser(c: Context<{ Bindings: Env }>) {
  const { username } = await c.req.json();
  await deleteUser(c.env.USERS, username);
  return c.json({ Code: 1, Message: 'User deleted successfully' });
}