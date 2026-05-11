import { createServiceToken, deleteServiceToken, getServiceTokenByName, updateServiceToken } from '../db'

export async function handleUserManagement(c: any, action: string) {
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

async function handleCreateUser(c: any) {
  const { username } = await c.req.json();
  const existingToken = await getServiceTokenByName(c.env.USERS, username);
  if (existingToken) {
    return c.json({ Code: 0, Message: 'Username already exists' }, 400);
  }

  const { token, serviceToken } = await createServiceToken(c.env.USERS, { name: username });
  return c.json({
    Code: 1,
    Message: 'User created successfully',
    Deprecated: 'Use POST /api/tokens instead.',
    token,
    userId: serviceToken.id,
  });
}

async function handleUpdateUser(c: any) {
  const { username, enabled } = await c.req.json();
  const serviceToken = await getServiceTokenByName(c.env.USERS, username);
  if (!serviceToken) {
    return c.json({ Code: 0, Message: 'User not found' }, 404);
  }

  await updateServiceToken(c.env.USERS, serviceToken.id, { enabled });
  return c.json({ Code: 1, Message: 'User updated successfully', Deprecated: 'Use PATCH /api/tokens/:id instead.' });
}

async function handleDeleteUser(c: any) {
  const { username } = await c.req.json();
  const serviceToken = await getServiceTokenByName(c.env.USERS, username);
  if (serviceToken) {
    await deleteServiceToken(c.env.USERS, serviceToken.id);
  }
  return c.json({ Code: 1, Message: 'User deleted successfully', Deprecated: 'Use DELETE /api/tokens/:id instead.' });
}
