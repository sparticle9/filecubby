import { Env } from './index'

export const getChunkSize = (env: Env) => parseInt(env.CHUNK_SIZE || '10485760', 10)  // Default to 10MB if not set
