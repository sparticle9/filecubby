import { D1Database } from '@cloudflare/workers-types'

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
  expiresAt: Date | null;
  fileType: string;
  uploadedAt: Date;
}

export async function initializeDatabase(db: D1Database) {
  const schema = `
    -- Create users table if it doesn't exist
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE
    );

    -- Create files table if it doesn't exist
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      filename TEXT NOT NULL,
      size INTEGER NOT NULL,
      chunks INTEGER NOT NULL,
      expiresAt DATETIME NOT NULL,
      telegramFileId TEXT,
      fileType TEXT NOT NULL,
      chunkIds TEXT
    );

    -- Function to check if a column exists
    CREATE TEMP TABLE IF NOT EXISTS pragma_table_info_snapshot AS SELECT * FROM pragma_table_info('files');

    -- Add columns if they don't exist
    INSERT OR IGNORE INTO pragma_table_info_snapshot (name, type)
    VALUES 
      ('chunkIds', 'TEXT'),
      ('userId', 'TEXT'),
      ('filename', 'TEXT'),
      ('size', 'INTEGER'),
      ('chunks', 'INTEGER'),
      ('expiresAt', 'DATETIME'),
      ('telegramFileId', 'TEXT'),
      ('fileType', 'TEXT');

    -- Apply the changes
    WITH missing_columns AS (
      SELECT name, type
      FROM pragma_table_info_snapshot
      EXCEPT
      SELECT name, type FROM pragma_table_info('files')
    )
    SELECT 'ALTER TABLE files ADD COLUMN ' || name || ' ' || type || ';'
    FROM missing_columns;

    -- Clean up
    DROP TABLE pragma_table_info_snapshot;
  `

  await db.exec(schema)
}

export async function getUser(db: D1Database, token: string): Promise<User | null> {
  try {
    const query = 'SELECT * FROM users WHERE token = ? AND enabled = 1'
    const result = await db.prepare(query).bind(token).first()
    if (result) {
      const user = {
        id: result.id,
        token: result.token,
        username: result.username,
        enabled: result.enabled === 1 // SQLite stores booleans as 0 or 1
      }
      return user
    }
    console.log('getUser: No user found for token')
    return null
  } catch (error) {
    console.error('getUser: Error querying database:', error)
    return null
  }
}

// Add a function to create a new user
export async function createUser(db: D1Database, user: User): Promise<void> {
  await db.prepare(`
    INSERT INTO users (id, token, username, enabled)
    VALUES (?, ?, ?, ?)
  `).bind(user.id, user.token, user.username, user.enabled).run()
}

export async function saveFileMetadata(db: D1Database, metadata: FileMetadata) {
  await db.prepare(`
    INSERT INTO files (id, userId, filename, size, chunks, chunkIds, expiresAt, fileType, uploadedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    metadata.id,
    metadata.userId,
    metadata.filename,
    metadata.size,
    metadata.chunks,
    JSON.stringify(metadata.chunkIds),
    metadata.expiresAt?.toISOString() || null,
    metadata.fileType,
    metadata.uploadedAt.toISOString()
  ).run();
}

export async function getFileMetadata(db: D1Database, fileId: string): Promise<FileMetadata | null> {
  const result = await db.prepare(`
    SELECT id, userId, filename, size, chunks, 
           chunkIds, expiresAt, fileType, uploadedAt
    FROM files WHERE id = ?
  `)
    .bind(fileId)
    .first()
  if (result) {
    return {
      ...result,
      chunkIds: JSON.parse(result.chunkIds),
      expiresAt: result.expiresAt ? new Date(result.expiresAt) : null,
      uploadedAt: new Date(result.uploadedAt)
    } as FileMetadata
  }
  return null
}

export async function deleteFileMetadata(db: D1Database, fileId: string, userId: string) {
  const result = await db.prepare('DELETE FROM files WHERE id = ?')
    .bind(fileId)
    .run()
  
  if (result.changes === 0) {
    throw new Error('File not found')
  }
}

export async function getExpiredFiles(db: D1Database): Promise<FileMetadata[]> {
  const result = await db.prepare(`
    SELECT id, userId, filename, size, chunks, 
           json(chunkIds) as chunkIds, expiresAt, telegramFileId, fileType 
    FROM files 
    WHERE expiresAt IS NOT NULL AND expiresAt < datetime('now')
  `).all()
  return result.results.map(row => ({
    ...row,
    chunkIds: row.chunkIds ? JSON.parse(row.chunkIds) : null,
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : null
  })) as FileMetadata[]
}

export async function updateUser(db: D1Database, id: string, updates: Partial<User>): Promise<void> {
  const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ')
  const values = Object.values(updates)
  
  await db.prepare(`
    UPDATE users
    SET ${setClause}
    WHERE id = ?
  `).bind(...values, id).run()
}

export async function deleteUser(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run()
}

export async function archiveFile(db: D1Database, file: FileMetadata) {
  await db.prepare(`
    INSERT INTO archived_files (id, userId, filename, size, chunks, chunkIds, expiresAt, fileType, uploadedAt, deletedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    file.id,
    file.userId,
    file.filename,
    file.size,
    file.chunks,
    JSON.stringify(file.chunkIds),
    file.expiresAt?.toISOString() || null,
    file.fileType,
    file.uploadedAt.toISOString(),
    new Date().toISOString()
  ).run();
}