import { Context } from 'hono'
import { Env } from '../index'
import { Collection, DEFAULT_NAMESPACE_ID, deleteCollection, getCollection, getCollectionBySlug, listCollections, saveCollection } from '../db'
import { normalizeDescription, normalizePath, normalizeSlug, normalizeTags } from '../utils/metadata'

export async function listCollectionsHandler(c: Context<{ Bindings: Env }>) {
  const collections = await listCollections(c.env.FILES);
  return c.json({ Code: 1, collections, count: collections.length });
}

export async function createCollectionHandler(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json().catch(() => ({}));
  const normalized = normalizeCollectionInput(body, true);
  if ('error' in normalized) {
    return c.json({ Code: 0, Message: normalized.error }, 400);
  }

  const existing = await getCollectionBySlug(c.env.FILES, normalized.collection.slug);
  if (existing) {
    return c.json({ Code: 0, Message: 'Collection slug already exists' }, 409);
  }

  await saveCollection(c.env.FILES, normalized.collection);
  return c.json({ Code: 1, Message: 'Collection created', collection: normalized.collection });
}

export async function getCollectionHandler(c: Context<{ Bindings: Env }>) {
  const id = c.req.param('id');
  const collection = await getCollection(c.env.FILES, id);
  if (!collection) {
    return c.json({ Code: 0, Message: 'Collection not found' }, 404);
  }
  return c.json({ Code: 1, collection });
}

export async function patchCollectionHandler(c: Context<{ Bindings: Env }>) {
  const id = c.req.param('id');
  const existing = await getCollection(c.env.FILES, id);
  if (!existing) {
    return c.json({ Code: 0, Message: 'Collection not found' }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const next: Collection = { ...existing };
  try {
    if ('name' in body) {
      if (typeof body.name !== 'string' || !body.name.trim()) {
        return c.json({ Code: 0, Message: 'Collection name is required' }, 400);
      }
      next.name = body.name.trim().slice(0, 120);
    }
    if ('slug' in body) {
      const slug = normalizeSlug(body.slug);
      if (!slug) return c.json({ Code: 0, Message: 'Collection slug is invalid' }, 400);
      const owner = await getCollectionBySlug(c.env.FILES, slug);
      if (owner && owner.id !== id) {
        return c.json({ Code: 0, Message: 'Collection slug already exists' }, 409);
      }
      if (slug !== existing.slug) {
        await c.env.FILES.delete(`collection-slug:${existing.namespaceId}:${existing.slug}`);
      }
      next.slug = slug;
    }
    if ('description' in body) {
      const description = normalizeDescription(body.description);
      if (description) next.description = description;
      else delete next.description;
    }
    if ('path' in body) {
      next.path = normalizePath(body.path);
    }
    if ('tags' in body) {
      next.tags = normalizeTags(body.tags);
    }
  } catch (error) {
    return c.json({ Code: 0, Message: error.message }, 400);
  }

  next.updatedAt = new Date().toISOString();
  await saveCollection(c.env.FILES, next);
  return c.json({ Code: 1, Message: 'Collection updated', collection: next });
}

export async function deleteCollectionHandler(c: Context<{ Bindings: Env }>) {
  const id = c.req.param('id');
  const deleted = await deleteCollection(c.env.FILES, id);
  if (!deleted) {
    return c.json({ Code: 0, Message: 'Collection not found' }, 404);
  }
  return c.json({ Code: 1, Message: 'Collection deleted' });
}

function normalizeCollectionInput(body: any, requireName: boolean): { collection: Collection } | { error: string } {
  if (requireName && (typeof body.name !== 'string' || !body.name.trim())) {
    return { error: 'Collection name is required' };
  }
  const name = body.name.trim().slice(0, 120);
  const slug = normalizeSlug(body.slug || name);
  if (!slug) {
    return { error: 'Collection slug is invalid' };
  }
  const now = new Date().toISOString();
  try {
    return {
      collection: {
        namespaceId: DEFAULT_NAMESPACE_ID,
        id: generateCollectionId(),
        name,
        slug,
        description: normalizeDescription(body.description),
        path: normalizePath(body.path),
        tags: normalizeTags(body.tags),
        createdAt: now,
        updatedAt: now,
      }
    };
  } catch (error) {
    return { error: error.message };
  }
}

function generateCollectionId(): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  return `col_${Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')}`;
}
