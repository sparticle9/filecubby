export interface User {
  id: string
  token: string
  username: string
  enabled: boolean
}

export interface ServiceToken {
  id: string
  name: string
  enabled: boolean
  createdAt: string
  updatedAt: string
  note?: string
  lastUsedAt?: string
  legacyUserId?: string
}

export const DEFAULT_NAMESPACE_ID = 'default';

export function objectMetadataKey(objectId: string, namespaceId = DEFAULT_NAMESPACE_ID): string {
  return `object:${namespaceId}:${objectId}`;
}

function collectionKey(collectionId: string, namespaceId = DEFAULT_NAMESPACE_ID): string {
  return `collection:${namespaceId}:${collectionId}`;
}

function collectionSlugKey(slug: string, namespaceId = DEFAULT_NAMESPACE_ID): string {
  return `collection-slug:${namespaceId}:${slug}`;
}

export interface ObjectMetadata {
  namespaceId: string;
  id: string;
  userId: string;
  name: string;
  size: number;
  chunks: number;
  chunkSize?: number;
  chunkIds: string[];
  chunkMessageIds?: Array<number | null>;
  manifestMessageId?: number;
  expiresAt: string | null;
  type: string;
  uploadedAt: string;
  updatedAt?: string;
  path?: string;
  tags?: string[];
  collectionIds?: string[];
  description?: string;
  backend?: string;
  createdByTokenId?: string;
}

export interface Collection {
  namespaceId: string;
  id: string;
  name: string;
  slug: string;
  description?: string;
  path?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export function validateObjectMetadata(metadata: ObjectMetadata, isInitializing: boolean = false): { isValid: boolean; error?: string } {
  if (metadata.namespaceId !== DEFAULT_NAMESPACE_ID) {
    return { isValid: false, error: 'Invalid namespaceId' };
  }
  if (typeof metadata.id !== 'string' || metadata.id.length === 0) {
    return { isValid: false, error: 'Invalid id' };
  }
  if (typeof metadata.userId !== 'string' || metadata.userId.length === 0) {
    return { isValid: false, error: 'Invalid userId' };
  }
  if (typeof metadata.name !== 'string' || metadata.name.length === 0) {
    return { isValid: false, error: 'Invalid name' };
  }
  if (typeof metadata.size !== 'number' || metadata.size < 0) {
    return { isValid: false, error: 'Invalid size' };
  }
  if (typeof metadata.chunks !== 'number' || metadata.chunks <= 0) {
    return { isValid: false, error: 'Invalid chunks' };
  }
  if (metadata.chunkSize !== undefined && (typeof metadata.chunkSize !== 'number' || metadata.chunkSize <= 0)) {
    return { isValid: false, error: 'Invalid chunkSize' };
  }
  if (!Array.isArray(metadata.chunkIds) || metadata.chunkIds.length !== metadata.chunks) {
    return { isValid: false, error: 'Invalid chunkIds array' };
  }
  if (metadata.chunkMessageIds !== undefined && (!Array.isArray(metadata.chunkMessageIds) || !metadata.chunkMessageIds.every(id => typeof id === 'number' || id === null))) {
    return { isValid: false, error: 'Invalid chunkMessageIds' };
  }
  if (metadata.manifestMessageId !== undefined && typeof metadata.manifestMessageId !== 'number') {
    return { isValid: false, error: 'Invalid manifestMessageId' };
  }
  // Allow null values in chunkIds during initialization and chunk uploads
  if (!isInitializing && !metadata.chunkIds.every(id => typeof id === 'string' || id === null)) {
    return { isValid: false, error: 'Invalid chunkIds' };
  }
  if (metadata.expiresAt !== null && (typeof metadata.expiresAt !== 'string' || isNaN(Date.parse(metadata.expiresAt)))) {
    return { isValid: false, error: 'Invalid expiresAt' };
  }
  if (typeof metadata.type !== 'string' || metadata.type.length === 0) {
    return { isValid: false, error: 'Invalid type' };
  }
  if (typeof metadata.uploadedAt !== 'string' || isNaN(Date.parse(metadata.uploadedAt))) {
    return { isValid: false, error: 'Invalid uploadedAt' };
  }
  if (metadata.updatedAt !== undefined && (typeof metadata.updatedAt !== 'string' || isNaN(Date.parse(metadata.updatedAt)))) {
    return { isValid: false, error: 'Invalid updatedAt' };
  }
  if (metadata.path !== undefined && (typeof metadata.path !== 'string' || metadata.path.length === 0)) {
    return { isValid: false, error: 'Invalid path' };
  }
  if (metadata.tags !== undefined && (!Array.isArray(metadata.tags) || !metadata.tags.every(tag => typeof tag === 'string'))) {
    return { isValid: false, error: 'Invalid tags' };
  }
  if (metadata.collectionIds !== undefined && (!Array.isArray(metadata.collectionIds) || !metadata.collectionIds.every(id => typeof id === 'string'))) {
    return { isValid: false, error: 'Invalid collectionIds' };
  }
  if (metadata.description !== undefined && typeof metadata.description !== 'string') {
    return { isValid: false, error: 'Invalid description' };
  }
  if (metadata.backend !== undefined && typeof metadata.backend !== 'string') {
    return { isValid: false, error: 'Invalid backend' };
  }
  if (metadata.createdByTokenId !== undefined && typeof metadata.createdByTokenId !== 'string') {
    return { isValid: false, error: 'Invalid createdByTokenId' };
  }

  return { isValid: true };
}

export async function saveObjectMetadata(files: KVNamespace, metadata: ObjectMetadata, isInitializing: boolean = false) {
  const key = objectMetadataKey(metadata.id, metadata.namespaceId);
  console.log(`Attempting to save metadata for key ${key}:`, JSON.stringify(metadata, null, 2));
  const validationResult = validateObjectMetadata(metadata, isInitializing);
  if (!validationResult.isValid) {
    console.error('Invalid object metadata:', JSON.stringify(metadata, null, 2));
    throw new Error(`Invalid object metadata: ${validationResult.error}`);
  }
  const metadataString = JSON.stringify(metadata);
  await files.put(key, metadataString);
  console.log(`Metadata saved successfully for key ${key}`);
}

export async function getObjectMetadata(files: KVNamespace, objectId: string, namespaceId = DEFAULT_NAMESPACE_ID): Promise<ObjectMetadata | null> {
  const key = objectMetadataKey(objectId, namespaceId);
  console.log(`Attempting to retrieve metadata for key: ${key}`);
  const rawMetadata = await files.get(key);
  
  if (rawMetadata === null) {
    console.log(`No metadata found for key: ${key}`);
    return null;
  }

  if (typeof rawMetadata !== 'string') {
    console.error(`Unexpected metadata type for key ${key}:`, typeof rawMetadata);
    return null;
  }

  try {
    const metadata = JSON.parse(rawMetadata);
    console.log(`Retrieved metadata for key ${key}:`, JSON.stringify(metadata, null, 2));
    return metadata as ObjectMetadata;
  } catch (error) {
    console.error(`Error parsing metadata for key ${key}:`, error);
    return null;
  }
}

export async function updateObjectMetadata(files: KVNamespace, objectId: string, updateFn: (metadata: ObjectMetadata) => ObjectMetadata, namespaceId = DEFAULT_NAMESPACE_ID): Promise<ObjectMetadata> {
  const key = objectMetadataKey(objectId, namespaceId);
  console.log(`Attempting to update metadata for key ${key}`);
  const existingMetadata = await getObjectMetadata(files, objectId, namespaceId);
  
  if (!existingMetadata) {
    console.error(`No existing metadata found for key ${key}`);
    throw new Error('Metadata not found');
  }

  const updatedMetadata = updateFn(existingMetadata);
  
  const validationResult = validateObjectMetadata(updatedMetadata);
  if (!validationResult.isValid) {
    console.error('Invalid updated object metadata:', JSON.stringify(updatedMetadata, null, 2));
    throw new Error(`Invalid object metadata: ${validationResult.error}`);
  }

  const metadataString = JSON.stringify(updatedMetadata);
  await files.put(key, metadataString);
  console.log(`Metadata updated successfully for key ${key}:`, metadataString);
  
  return updatedMetadata;
}

export async function deleteObjectMetadata(files: KVNamespace, objectId: string, namespaceId = DEFAULT_NAMESPACE_ID): Promise<void> {
  await files.delete(objectMetadataKey(objectId, namespaceId));
}

export async function getExpiredObjects(files: KVNamespace): Promise<ObjectMetadata[]> {
  const now = new Date().toISOString();
  const { keys } = await files.list({ prefix: `object:${DEFAULT_NAMESPACE_ID}:` });
  const expiredObjects: ObjectMetadata[] = [];

  for (const key of keys) {
    const object = await files.get(key.name, 'json') as ObjectMetadata;
    if (object.expiresAt && object.expiresAt < now) {
      expiredObjects.push(object);
    }
  }

  return expiredObjects;
}

export async function archiveObject(files: KVNamespace, object: ObjectMetadata) {
  await files.put(`archived:${object.namespaceId}:${object.id}`, JSON.stringify({
    ...object,
    deletedAt: new Date().toISOString()
  }));
}

export async function listObjectMetadata(files: KVNamespace, namespaceId = DEFAULT_NAMESPACE_ID): Promise<ObjectMetadata[]> {
  const { keys } = await files.list({ prefix: `object:${namespaceId}:` });
  const results: ObjectMetadata[] = [];
  for (const key of keys) {
    const object = await files.get(key.name, 'json') as ObjectMetadata | null;
    if (object) {
      results.push(object);
    }
  }
  return results;
}

export async function saveCollection(files: KVNamespace, collection: Collection): Promise<void> {
  await files.put(collectionKey(collection.id, collection.namespaceId), JSON.stringify(collection));
  await files.put(collectionSlugKey(collection.slug, collection.namespaceId), collection.id);
}

export async function getCollection(files: KVNamespace, id: string, namespaceId = DEFAULT_NAMESPACE_ID): Promise<Collection | null> {
  return await files.get(collectionKey(id, namespaceId), 'json') as Collection | null;
}

export async function getCollectionBySlug(files: KVNamespace, slug: string, namespaceId = DEFAULT_NAMESPACE_ID): Promise<Collection | null> {
  const id = await files.get(collectionSlugKey(slug, namespaceId));
  return id ? getCollection(files, id, namespaceId) : null;
}

export async function listCollections(files: KVNamespace, namespaceId = DEFAULT_NAMESPACE_ID): Promise<Collection[]> {
  const { keys } = await files.list({ prefix: `collection:${namespaceId}:` });
  const collections: Collection[] = [];
  for (const key of keys) {
    const collection = await files.get(key.name, 'json') as Collection | null;
    if (collection) {
      collections.push(collection);
    }
  }
  return collections.sort((a, b) => a.name.localeCompare(b.name));
}

export async function deleteCollection(files: KVNamespace, id: string, namespaceId = DEFAULT_NAMESPACE_ID): Promise<boolean> {
  const existing = await getCollection(files, id, namespaceId);
  if (!existing) return false;
  await files.delete(collectionKey(id, namespaceId));
  await files.delete(collectionSlugKey(existing.slug, namespaceId));
  return true;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}

export function serviceTokenToUser(token: ServiceToken): User {
  return {
    id: token.id,
    token: '',
    username: token.name,
    enabled: token.enabled,
  };
}

export async function saveServiceToken(users: KVNamespace, serviceToken: ServiceToken, token?: string): Promise<void> {
  await users.put(`service-token:${serviceToken.id}`, JSON.stringify(serviceToken));
  await users.put(`service-token-name:${serviceToken.name}`, serviceToken.id);
  if (token) {
    await users.put(`token:${await hashToken(token)}`, serviceToken.id);
  }
}

export async function getServiceToken(users: KVNamespace, id: string): Promise<ServiceToken | null> {
  return await users.get(`service-token:${id}`, 'json') as ServiceToken | null;
}

export async function getServiceTokenByName(users: KVNamespace, name: string): Promise<ServiceToken | null> {
  const id = await users.get(`service-token-name:${name}`);
  return id ? getServiceToken(users, id) : null;
}

export async function listServiceTokens(users: KVNamespace): Promise<ServiceToken[]> {
  const { keys } = await users.list({ prefix: 'service-token:' });
  const tokens: ServiceToken[] = [];
  for (const key of keys) {
    const token = await users.get(key.name, 'json') as ServiceToken | null;
    if (token) {
      tokens.push(token);
    }
  }
  return tokens.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function createServiceToken(
  users: KVNamespace,
  input: { name: string; note?: string; token?: string; id?: string }
): Promise<{ serviceToken: ServiceToken; token: string }> {
  const now = new Date().toISOString();
  const token = input.token || generateToken();
  const serviceToken: ServiceToken = {
    id: input.id || generateServiceTokenId(),
    name: input.name,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    note: input.note,
  };
  await saveServiceToken(users, serviceToken, token);
  return { serviceToken, token };
}

export async function updateServiceToken(
  users: KVNamespace,
  id: string,
  patch: { name?: string; enabled?: boolean; note?: string | null }
): Promise<ServiceToken | null> {
  const existing = await getServiceToken(users, id);
  if (!existing) return null;

  if (patch.name && patch.name !== existing.name) {
    await users.delete(`service-token-name:${existing.name}`);
    existing.name = patch.name;
    await users.put(`service-token-name:${existing.name}`, existing.id);
  }
  if (typeof patch.enabled === 'boolean') {
    existing.enabled = patch.enabled;
  }
  if ('note' in patch) {
    if (patch.note === null || patch.note === undefined) {
      delete existing.note;
    } else {
      existing.note = patch.note;
    }
  }
  existing.updatedAt = new Date().toISOString();
  await users.put(`service-token:${existing.id}`, JSON.stringify(existing));
  return existing;
}

export async function deleteServiceToken(users: KVNamespace, id: string): Promise<boolean> {
  const existing = await getServiceToken(users, id);
  if (!existing) return false;
  await users.delete(`service-token:${id}`);
  await users.delete(`service-token-name:${existing.name}`);
  return true;
}

export async function saveUser(users: KVNamespace, user: User): Promise<void> {
  await users.put(`user:${user.id}`, JSON.stringify(user));
  await users.put(`username:${user.username}`, user.id);
  await users.put(`token:${await hashToken(user.token)}`, user.id);
}

export async function getUser(users: KVNamespace, token: string): Promise<User | null> {
  const hashedToken = await hashToken(token);
  const indexedId = await users.get(`token:${hashedToken}`);
  if (indexedId) {
    const serviceToken = await getServiceToken(users, indexedId);
    if (serviceToken) {
      return serviceToken.enabled ? serviceTokenToUser(serviceToken) : null;
    }

    const legacyUser = await users.get(`user:${indexedId}`, 'json') as User | null;
    if (legacyUser?.enabled) {
      return legacyUser;
    }
    return null;
  }

  // Temporary compatibility for the pre-hash index format.
  const plaintextIndexedUserId = await users.get(`token:${token}`);
  if (plaintextIndexedUserId) {
    const user = await users.get(`user:${plaintextIndexedUserId}`, 'json') as User | null;
    if (user?.enabled) return user;
  }

  const allUsers = await users.list({ prefix: 'user:' });
  for (const key of allUsers.keys) {
    const user = await users.get(key.name, 'json') as User | null;
    if (user && user.token === token) {
      return user;
    }
  }
  return null;
}

export async function getUserByUsername(users: KVNamespace, username: string): Promise<User | null> {
  const userId = await users.get(`username:${username}`);
  if (!userId) return null;
  const user = await users.get(`user:${userId}`, 'json');
  return user as User | null;
}

export async function updateUser(users: KVNamespace, user: User): Promise<void> {
  await saveUser(users, user);
}

export async function deleteUser(users: KVNamespace, username: string): Promise<void> {
  const userId = await users.get(`username:${username}`);
  if (userId) {
    const user = await users.get(`user:${userId}`, 'json') as User | null;
    if (user?.token) {
      await users.delete(`token:${await hashToken(user.token)}`);
      await users.delete(`token:${user.token}`);
    }
    await users.delete(`user:${userId}`);
    await users.delete(`username:${username}`);
  }
}

export async function initAdminUser(users: KVNamespace, adminToken: string): Promise<void> {
  const adminUser: User = {
    id: 'ADMIN',
    token: adminToken,
    username: 'admin',
    enabled: true
  };
  await saveUser(users, adminUser);
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function generateServiceTokenId(): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  return `tok_${Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')}`;
}
