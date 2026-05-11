import { Env } from './index'
import { initAdminUser, getUser } from './db'

export async function initializeAdmin(env: Env) {
  if (!env.ADMIN_TOKEN) {
    throw new Error('ADMIN_TOKEN is required to initialize admin access');
  }

  const existingAdmin = await getUser(env.USERS, env.ADMIN_TOKEN);
  if (existingAdmin) {
    console.log('Admin user already exists. Skipping initialization.');
    return;
  }

  await initAdminUser(env.USERS, env.ADMIN_TOKEN);
  console.log('Admin user initialized from ADMIN_TOKEN.');
}

// Add this to make the script runnable
export default {
  async fetch(request: Request, env: Env) {
    await initializeAdmin(env);
    return new Response('Admin initialization complete.');
  },
};
