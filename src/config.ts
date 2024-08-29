import { Env } from './index'

export const getChunkSize = (env: Env) => parseInt(env.CHUNK_SIZE || '20971520', 10)  // Default to 20MB if not set
