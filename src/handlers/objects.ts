import { Context } from 'hono'
import { Env } from '../index'
import { getObjectMetadata, listObjectMetadata, updateObjectMetadata } from '../db'
import { applyMetadataInputs, normalizeCollectionIds, normalizePath, normalizeTags, publicObject } from '../utils/metadata'

export async function listObjects(c: Context<{ Bindings: Env }>) {
  const limit = clampInt(c.req.query('limit'), 50, 1, 200);
  const pathQuery = c.req.query('path');
  const tagQuery = c.req.query('tag');
  const collectionQuery = c.req.query('collectionId') || c.req.query('collection');
  const q = (c.req.query('q') || '').trim().toLowerCase();

  let path: string | undefined;
  try {
    path = pathQuery ? normalizePath(pathQuery) : undefined;
  } catch (error) {
    return c.json({ Code: 0, Message: error.message }, 400);
  }

  const tags = tagQuery ? normalizeTags(tagQuery) : [];
  const collectionIds = collectionQuery ? normalizeCollectionIds(collectionQuery) : [];
  const objects = await listObjectMetadata(c.env.FILES);

  const filtered = objects
    .filter(object => !path || (object.path || '/') === path)
    .filter(object => tags.length === 0 || tags.every(tag => (object.tags || []).includes(tag)))
    .filter(object => collectionIds.length === 0 || collectionIds.every(id => (object.collectionIds || []).includes(id)))
    .filter(object => !q || object.name.toLowerCase().includes(q) || (object.description || '').toLowerCase().includes(q))
    .sort((a, b) => (b.updatedAt || b.uploadedAt).localeCompare(a.updatedAt || a.uploadedAt))
    .slice(0, limit)
    .map(publicObject);

  return c.json({ Code: 1, objects: filtered, count: filtered.length });
}

export async function getObject(c: Context<{ Bindings: Env }>) {
  const objectId = c.req.param('id');
  const object = await getObjectMetadata(c.env.FILES, objectId);
  if (!object) {
    return c.json({ Code: 0, Message: 'Object not found' }, 404);
  }
  return c.json({ Code: 1, object: publicObject(object) });
}

export async function patchObject(c: Context<{ Bindings: Env }>) {
  const objectId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const existing = await getObjectMetadata(c.env.FILES, objectId);
  if (!existing) {
    return c.json({ Code: 0, Message: 'Object not found' }, 404);
  }

  try {
    const updated = await updateObjectMetadata(c.env.FILES, objectId, (metadata) => {
      if ('name' in body) {
        if (typeof body.name !== 'string' || !body.name.trim()) {
          throw new Error('name must be a non-empty string');
        }
        metadata.name = body.name.trim().slice(0, 255);
      }
      applyMetadataInputs(metadata, {
        path: body.path,
        tags: body.tags,
        collectionIds: body.collectionIds,
        description: body.description,
      }, false);
      return metadata;
    });

    return c.json({ Code: 1, Message: 'Object metadata updated', object: publicObject(updated) });
  } catch (error) {
    return c.json({ Code: 0, Message: error.message }, 400);
  }
}

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}
