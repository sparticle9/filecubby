export function generateSecureToken(): string {
  const buffer = new Uint8Array(32) // 256 bits
  crypto.getRandomValues(buffer)
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function generateObjectId(_objects?: KVNamespace): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';
  return Array.from({length: 8}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export function generateUserId(): string {
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({length: 4}, () => characters[Math.floor(Math.random() * characters.length)]).join('');
}
