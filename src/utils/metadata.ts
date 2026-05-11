import type { Env } from '../index'
import { DEFAULT_NAMESPACE_ID, type ObjectMetadata } from '../db'

export const TELEGRAM_PUBLIC_BOT_DOWNLOAD_LIMIT_BYTES = 20 * 1024 * 1024;
export const SAFE_PUBLIC_BOT_CHUNK_BYTES = 19 * 1024 * 1024;
export const TELEGRAM_BACKEND = 'telegram-bot-api';

export function filecubbyMarker(env: Env): string {
  const raw = String((env as any).FILECUBBY_MARKER || 'fc').trim().toLowerCase();
  const normalized = raw.replace(/[^a-z0-9_.-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  return normalized || 'fc';
}

export function telegramOrganizationMode(env: Env): 'off' | 'caption' | 'manifest' {
  const value = String((env as any).TELEGRAM_ORGANIZATION_MODE || 'off').trim().toLowerCase();
  if (value === 'manifest') return 'manifest';
  if (value === 'caption' || value === 'captions') return 'caption';
  return 'off';
}

export function effectiveMaxChunkSize(env: Env): number {
  const configured = parseInt(String(env.MAX_CHUNK_SIZE), 10);
  if (!Number.isFinite(configured) || configured <= 0) {
    return SAFE_PUBLIC_BOT_CHUNK_BYTES;
  }
  return Math.min(configured, SAFE_PUBLIC_BOT_CHUNK_BYTES);
}

export function normalizePath(value: unknown): string {
  if (typeof value !== 'string') {
    return '/';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '/';
  }

  const parts = trimmed
    .replace(/\\/g, '/')
    .split('/')
    .map(part => part.trim())
    .filter(part => part && part !== '.');

  if (parts.some(part => part === '..')) {
    throw new Error('Path must not contain .. segments');
  }

  return `/${parts.join('/')}`;
}

export function normalizeTags(value: unknown): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? parseStringList(value)
      : [];

  const normalized = rawValues
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)
    .map(item => item.replace(/\s+/g, '-'))
    .filter(item => /^[a-z0-9][a-z0-9_.-]{0,63}$/.test(item));

  return Array.from(new Set(normalized)).slice(0, 32);
}

export function normalizeCollectionIds(value: unknown): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? parseStringList(value)
      : [];

  const normalized = rawValues
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => /^[A-Za-z0-9_-]{1,80}$/.test(item));

  return Array.from(new Set(normalized)).slice(0, 32);
}

export function normalizeDescription(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 500) : undefined;
}

export function normalizeSlug(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || null;
}

export function applyMetadataInputs(metadata: ObjectMetadata, input: {
  path?: unknown;
  tags?: unknown;
  collectionIds?: unknown;
  description?: unknown;
}, overwrite = false): ObjectMetadata {
  metadata.namespaceId = DEFAULT_NAMESPACE_ID;
  if (overwrite || input.path !== undefined) {
    metadata.path = normalizePath(input.path);
  }
  if (overwrite || input.tags !== undefined) {
    metadata.tags = normalizeTags(input.tags);
  }
  if (overwrite || input.collectionIds !== undefined) {
    metadata.collectionIds = normalizeCollectionIds(input.collectionIds);
  }
  if (overwrite || input.description !== undefined) {
    const description = normalizeDescription(input.description);
    if (description) {
      metadata.description = description;
    } else {
      delete metadata.description;
    }
  }
  metadata.backend = metadata.backend || TELEGRAM_BACKEND;
  metadata.createdByTokenId = metadata.createdByTokenId || metadata.userId;
  metadata.updatedAt = new Date().toISOString();
  return metadata;
}

export function publicObject(object: ObjectMetadata) {
  return {
    namespaceId: object.namespaceId || DEFAULT_NAMESPACE_ID,
    id: object.id,
    name: object.name,
    size: object.size,
    type: object.type,
    chunks: object.chunks,
    chunkSize: object.chunkSize,
    path: object.path || '/',
    tags: object.tags || [],
    collectionIds: object.collectionIds || [],
    description: object.description,
    backend: object.backend || TELEGRAM_BACKEND,
    createdByTokenId: object.createdByTokenId || object.userId,
    uploadedAt: object.uploadedAt,
    updatedAt: object.updatedAt || object.uploadedAt,
    expiresAt: object.expiresAt,
    url: `/d/${object.id}`,
  };
}

function parseStringList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return [];
    }
  }
  return trimmed.split(',');
}
