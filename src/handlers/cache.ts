import { Context } from 'hono'
import { Env } from '../index'
import { clearAllCache, getAllCacheKeys, getCacheKeyCount } from '../utils/cache'

// Clear cache handler
export async function clearCache(c: Context<{ Bindings: Env }>) {
  try {
    await clearAllCache();
    console.log('Cache cleared');
    return c.json({ Code: 1, Message: 'Cache cleared successfully' });
  } catch (error) {
    console.error('Error clearing cache:', error);
    return c.json({ Code: 0, Message: 'Failed to clear cache' }, 500);
  }
}

// Get cache status handler
export async function getCacheStatus(c: Context<{ Bindings: Env }>) {
  try {
    const cacheStatus = await getAllCacheKeys();
    console.log('Cache status retrieved');
    return c.json({ Code: 1, Message: 'Cache status retrieved successfully', cacheStatus });
  } catch (error) {
    console.error('Error retrieving cache status:', error);
    return c.json({ Code: 0, Message: 'Failed to retrieve cache status' }, 500);
  }
}

// Handler to get total count of cache keys
export async function getCacheCount(c: Context<{ Bindings: Env }>) {
  try {
    const count = await getCacheKeyCount();
    console.log(`Total cache keys: ${count}`);
    return c.json({ Code: 1, Message: 'Cache count retrieved successfully', count });
  } catch (error) {
    console.error('Error retrieving cache count:', error);
    return c.json({ Code: 0, Message: 'Failed to retrieve cache count' }, 500);
  }
}