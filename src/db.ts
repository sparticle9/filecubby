import { KVNamespace } from '@cloudflare/workers-types'

export interface User {
  id: string
  token: string
  username: string
  enabled: boolean
}

export interface FileMetadata {
  id: string;
  userId: string;
  filename: string;
  size: number;
  chunks: number;
  chunkIds: string[];
  expiresAt: string | null;
  fileType: string;
  uploadedAt: string;
  status: 'uploading' | 'completed';
}

// Validation function for FileMetadata
export function validateFileMetadata(metadata: FileMetadata, isInitializing: boolean = false): boolean {
  return (
    typeof metadata.id === 'string' && metadata.id.length > 0 &&
    typeof metadata.userId === 'string' && metadata.userId.length > 0 &&
    typeof metadata.filename === 'string' && metadata.filename.length > 0 &&
    typeof metadata.size === 'number' && metadata.size >= 0 &&
    typeof metadata.chunks === 'number' && metadata.chunks > 0 &&
    Array.isArray(metadata.chunkIds) &&
    (isInitializing || metadata.chunkIds.every(id => typeof id === 'string' || id === null)) &&
    (metadata.expiresAt === null || (typeof metadata.expiresAt === 'string' && !isNaN(Date.parse(metadata.expiresAt)))) &&
    typeof metadata.fileType === 'string' && metadata.fileType.length > 0 &&
    typeof metadata.uploadedAt === 'string' && !isNaN(Date.parse(metadata.uploadedAt)) &&
    (metadata.status === 'uploading' || metadata.status === 'completed')
  );
}

export async function saveFileMetadata(files: KVNamespace, key: string, metadata: FileMetadata, isInitializing: boolean = false) {
  if (!validateFileMetadata(metadata, isInitializing)) {
    console.error('Invalid file metadata:', JSON.stringify(metadata, null, 2));
    throw new Error('Invalid file metadata');
  }
  await files.put(key, JSON.stringify(metadata));
}

export async function getFileMetadata(files: KVNamespace, key: string): Promise<FileMetadata | null> {
  console.log(`Attempting to retrieve metadata for key: ${key}`);
  const metadata = await files.get(key, 'json');
  if (!metadata) {
    console.log(`No metadata found for key: ${key}`);
    return null;
  }
  console.log(`Retrieved metadata for key ${key}:`, JSON.stringify(metadata, null, 2));
  return metadata as FileMetadata;
}

export async function updateFileMetadata(files: KVNamespace, key: string, metadata: FileMetadata) {
  console.log(`Attempting to update metadata for key ${key}:`, JSON.stringify(metadata, null, 2));
  if (!validateFileMetadata(metadata)) {
    console.error('Invalid file metadata:', JSON.stringify(metadata, null, 2));
    throw new Error('Invalid file metadata');
  }
  await files.put(key, JSON.stringify(metadata));
  console.log(`Metadata updated successfully for key ${key}`);
}

export async function deleteFileMetadata(files: KVNamespace, fileId: string): Promise<void> {
  await files.delete(`file:${fileId}`);
}

export async function getExpiredFiles(files: KVNamespace): Promise<FileMetadata[]> {
  const now = new Date().toISOString();
  const { keys } = await files.list({ prefix: 'file:' });
  const expiredFiles: FileMetadata[] = [];

  for (const key of keys) {
    const file = await files.get(key.name, 'json') as FileMetadata;
    if (file.expiresAt && file.expiresAt < now) {
      expiredFiles.push(file);
    }
  }

  return expiredFiles;
}

export async function archiveFile(files: KVNamespace, file: FileMetadata) {
  await files.put(`archived:${file.id}`, JSON.stringify({
    ...file,
    deletedAt: new Date().toISOString()
  }));
}

export async function cacheChunkUrl(fileDownloadInfo: KVNamespace, fileId: string, chunkIndex: number, url: string, ttl: number): Promise<void> {
  console.log(`Caching chunk URL for file ${fileId}, chunk ${chunkIndex} with TTL: ${ttl}`);
  const expiresAt = Date.now() + ttl * 1000;
  await fileDownloadInfo.put(`file:${fileId}:chunk:${chunkIndex}:url`, JSON.stringify({ url, expiresAt }), { expirationTtl: ttl });
}

export async function getCachedChunkUrl(fileDownloadInfo: KVNamespace, fileId: string, chunkIndex: number): Promise<string | null> {
  const cachedData = await fileDownloadInfo.get(`file:${fileId}:chunk:${chunkIndex}:url`);
  if (!cachedData) return null;

  try {
    const parsed = JSON.parse(cachedData);
    if (typeof parsed === 'object' && parsed.url && parsed.expiresAt) {
      if (parsed.expiresAt > Date.now()) {
        return parsed.url;
      }
    }
  } catch (error) {
    console.error(`Error parsing cached URL data for file ${fileId}, chunk ${chunkIndex}:`, error);
    // If parsing fails, return the raw cached data if it's a string
    if (typeof cachedData === 'string') {
      return cachedData;
    }
  }

  return null;
}

export async function saveUser(users: KVNamespace, user: User): Promise<void> {
  await users.put(`user:${user.id}`, JSON.stringify(user));
  await users.put(`username:${user.username}`, user.id);
}

export async function getUser(users: KVNamespace, token: string): Promise<User | null> {
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