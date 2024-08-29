import { D1Database } from '@cloudflare/workers-types'
import { createUser, getUser } from '../src/db'
import { generateSecureToken } from '../src/utils'
import * as fs from 'fs'

function generateUserId(): string {
  return Math.random().toString(36).substring(2, 6).toUpperCase()
}

async function createOrUpdateAdminUser(db: D1Database, generateSql: boolean = false): Promise<void> {
  const adminToken = generateSecureToken()
  const adminUser = {
    id: generateUserId(),
    token: adminToken,
    username: 'admin',
    enabled: true
  }

  if (generateSql) {
    const sql = `
      INSERT INTO users (id, token, username, enabled)
      VALUES ('${adminUser.id}', '${adminUser.token}', '${adminUser.username}', ${adminUser.enabled})
      ON CONFLICT(username) DO UPDATE SET
      id = EXCLUDED.id,
      token = EXCLUDED.token,
      enabled = EXCLUDED.enabled;
    `
    fs.writeFileSync('scripts/createAdminUser.sql', sql)
    console.log('SQL file created. Run "npm run init-admin" to execute it.')
  } else {
    await createUser(db, adminUser)
  }

  console.log(`Admin user created/updated with ID: ${adminUser.id} and token: ${adminToken}`)
  console.log('Please store this token securely. It will not be shown again.')
}

async function checkAdminUser(db: D1Database): Promise<void> {
  const adminUser = await getUser(db, 'admin')
  if (adminUser) {
    console.log('Admin user exists:', adminUser)
  } else {
    console.log('Admin user does not exist.')
  }
}

async function run(action: 'create' | 'check', generateSql: boolean = false) {
  // @ts-ignore
  const db = await D1Database.fromEnvironment(process.env.METADB)
  
  if (action === 'create') {
    await createOrUpdateAdminUser(db, generateSql)
  } else if (action === 'check') {
    await checkAdminUser(db)
  }
}

// Parse command line arguments
const args = process.argv.slice(2)
const action = args[0] as 'create' | 'check'
const generateSql = args.includes('--generate-sql')

if (!action || (action !== 'create' && action !== 'check')) {
  console.log('Usage: npm run manage-admin -- <create|check> [--generate-sql]')
  process.exit(1)
}

run(action, generateSql).catch(console.error)