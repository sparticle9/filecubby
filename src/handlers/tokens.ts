import { createServiceToken, deleteServiceToken, getServiceToken, getServiceTokenByName, listServiceTokens, updateServiceToken } from '../db'

function toPublicToken(token: any) {
  return {
    id: token.id,
    name: token.name,
    enabled: token.enabled,
    createdAt: token.createdAt,
    updatedAt: token.updatedAt,
    note: token.note,
    lastUsedAt: token.lastUsedAt,
  };
}

function normalizeName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const normalized = name.trim();
  if (!normalized || normalized.length > 80) return null;
  return normalized;
}

export async function listTokens(c: any) {
  const tokens = await listServiceTokens(c.env.USERS);
  return c.json({ Code: 1, tokens: tokens.map(toPublicToken) });
}

export async function createToken(c: any) {
  const body = await c.req.json().catch(() => ({}));
  const name = normalizeName(body.name);
  if (!name) {
    return c.json({ Code: 0, Message: 'Token name is required' }, 400);
  }

  const existing = await getServiceTokenByName(c.env.USERS, name);
  if (existing) {
    return c.json({ Code: 0, Message: 'Token name already exists' }, 409);
  }

  const { serviceToken, token } = await createServiceToken(c.env.USERS, {
    name,
    note: typeof body.note === 'string' ? body.note : undefined,
  });

  return c.json({
    Code: 1,
    Message: 'Token created successfully',
    token,
    serviceToken: toPublicToken(serviceToken),
  });
}

export async function patchToken(c: any) {
  const id = c.req.param('id');
  const existing = await getServiceToken(c.env.USERS, id);
  if (!existing) {
    return c.json({ Code: 0, Message: 'Token not found' }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const patch: any = {};

  if ('name' in body) {
    const name = normalizeName(body.name);
    if (!name) {
      return c.json({ Code: 0, Message: 'Token name is invalid' }, 400);
    }
    const nameOwner = await getServiceTokenByName(c.env.USERS, name);
    if (nameOwner && nameOwner.id !== id) {
      return c.json({ Code: 0, Message: 'Token name already exists' }, 409);
    }
    patch.name = name;
  }

  if ('enabled' in body) {
    if (typeof body.enabled !== 'boolean') {
      return c.json({ Code: 0, Message: 'enabled must be boolean' }, 400);
    }
    patch.enabled = body.enabled;
  }

  if ('note' in body) {
    if (body.note !== null && typeof body.note !== 'string') {
      return c.json({ Code: 0, Message: 'note must be a string or null' }, 400);
    }
    patch.note = body.note;
  }

  const updated = await updateServiceToken(c.env.USERS, id, patch);
  return c.json({ Code: 1, Message: 'Token updated successfully', serviceToken: toPublicToken(updated) });
}

export async function removeToken(c: any) {
  const id = c.req.param('id');
  const deleted = await deleteServiceToken(c.env.USERS, id);
  if (!deleted) {
    return c.json({ Code: 0, Message: 'Token not found' }, 404);
  }
  return c.json({ Code: 1, Message: 'Token deleted successfully' });
}
