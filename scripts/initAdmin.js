const { execSync } = require('child_process');
const crypto = require('crypto');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function runWranglerCommand(command) {
  try {
    return execSync(`pnpm exec ${command}`, { encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    console.error(`Error running command: ${command}`);
    console.error(`Error message: ${error.message}`);
    console.error(`Error output: ${error.stderr}`);
    throw error;
  }
}

async function initAdmin() {
  try {
    console.log('Checking for existing admin user...');
    let adminCheck;
    try {
      adminCheck = runWranglerCommand('wrangler kv key get --remote --binding=USERS "username:admin"');
    } catch (error) {
      if (error.stderr.includes('404: Not Found')) {
        console.log('Admin user does not exist. Proceeding with initialization.');
        adminCheck = '';
      } else {
        throw error;
      }
    }
    
    if (adminCheck.trim()) {
      if (adminCheck.trim() === 'Value not found') {
        console.log('Admin user does not exist. Proceeding with initialization.');
      } else {
      console.log('Admin user already exists. Skipping initialization.');
      return;
      }
    }

    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) {
      throw new Error('ADMIN_TOKEN is required; generate it with pnpm run secrets:bootstrap or set it in the environment.');
    }

    const adminUser = {
      id: 'ADMIN',
      token: adminToken,
      username: 'admin',
      enabled: true
    };
    const now = new Date().toISOString();
    const serviceToken = {
      id: 'admin',
      name: 'admin',
      enabled: true,
      createdAt: now,
      updatedAt: now,
      note: 'Bootstrap admin token',
      legacyUserId: 'ADMIN'
    };

    console.log('Saving admin user...');
    runWranglerCommand(`wrangler kv key put --remote --binding=USERS "user:ADMIN" '${JSON.stringify(adminUser)}'`);
    runWranglerCommand(`wrangler kv key put --remote --binding=USERS "username:admin" "ADMIN"`);
    runWranglerCommand(`wrangler kv key put --remote --binding=USERS "service-token:admin" '${JSON.stringify(serviceToken)}'`);
    runWranglerCommand(`wrangler kv key put --remote --binding=USERS "service-token-name:admin" "admin"`);
    runWranglerCommand(`wrangler kv key put --remote --binding=USERS "token:${hashToken(adminToken)}" "admin"`);

    console.log('Admin user initialized from ADMIN_TOKEN.');
  } catch (error) {
    console.error('Error initializing admin:', error);
  }
}

initAdmin();
