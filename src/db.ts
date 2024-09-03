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
  name: string;  // Changed from filename
  size: number;
  chunks: number;
  chunkIds: string[];
  expiresAt: string | null;
  type: string;  // Changed from fileType
  uploadedAt: string;
  // status field removed
}

// Validation function for FileMetadata
export function validateFileMetadata(metadata: FileMetadata, isInitializing: boolean = false): { isValid: boolean; error?: string } {
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
  if (!Array.isArray(metadata.chunkIds) || metadata.chunkIds.length !== metadata.chunks) {
    return { isValid: false, error: 'Invalid chunkIds array' };
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

  return { isValid: true };
}

export async function saveFileMetadata(files: KVNamespace, key: string, metadata: FileMetadata, isInitializing: boolean = false) {
  console.log(`Attempting to save metadata for key ${key}:`, JSON.stringify(metadata, null, 2));
  const validationResult = validateFileMetadata(metadata, isInitializing);
  if (!validationResult.isValid) {
    console.error('Invalid file metadata:', JSON.stringify(metadata, null, 2));
    throw new Error(`Invalid file metadata: ${validationResult.error}`);
  }
  const metadataString = JSON.stringify(metadata);
  await files.put(key, metadataString);
  console.log(`Metadata saved successfully for key ${key}`);
}

export async function getFileMetadata(files: KVNamespace, key: string): Promise<FileMetadata | null> {
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
    return metadata as FileMetadata;
  } catch (error) {
    console.error(`Error parsing metadata for key ${key}:`, error);
    return null;
  }
}

export async function updateFileMetadata(files: KVNamespace, key: string, updateFn: (metadata: FileMetadata) => FileMetadata): Promise<FileMetadata> {
  console.log(`Attempting to update metadata for key ${key}`);
  const existingMetadata = await getFileMetadata(files, key);
  
  if (!existingMetadata) {
    console.error(`No existing metadata found for key ${key}`);
    throw new Error('Metadata not found');
  }

  const updatedMetadata = updateFn(existingMetadata);
  
  const validationResult = validateFileMetadata(updatedMetadata);
  if (!validationResult.isValid) {
    console.error('Invalid updated file metadata:', JSON.stringify(updatedMetadata, null, 2));
    throw new Error(`Invalid file metadata: ${validationResult.error}`);
  }

  const metadataString = JSON.stringify(updatedMetadata);
  await files.put(key, metadataString);
  console.log(`Metadata updated successfully for key ${key}:`, metadataString);
  
  return updatedMetadata;
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