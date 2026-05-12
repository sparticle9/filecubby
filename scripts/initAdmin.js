const { execSync } = require('child_process');
const crypto = require('crypto');

const envName = process.argv.includes('--env')
  ? process.argv[process.argv.indexOf('--env') + 1]
  : null;
const envFlag = envName ? ` --env ${envName}` : '';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function runWranglerCommand(command) {
  try {
    return execSync(`pnpm exec ${command}${envFlag}`, { encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    console.error(`Error running command: ${command}${envFlag}`);
    console.error(`Error message: ${error.message}`);
    console.error(`Error output: ${error.stderr}`);
    throw error;
  }
}

async function initAdmin() {
  try {
    console.log('Checking for existing admin service token...');
    let adminCheck;
    try {
      adminCheck = runWranglerCommand('wrangler kv key get --remote --binding=USERS "service-token-name:admin"');
    } catch (error) {
      if (error.stderr.includes('404: Not Found')) {
        console.log('Admin service token does not exist. Proceeding with initialization.');
        adminCheck = '';
      } else {
        throw error;
      }
    }
    
    if (adminCheck.trim()) {
      if (adminCheck.trim() === 'Value not found') {
        console.log('Admin service token does not exist. Proceeding with initialization.');
      } else {
        console.log('Admin service token already exists. Skipping initialization.');
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

    console.log('Saving admin service token...');
    runWranglerCommand(`wrangler kv key put --remote --binding=USERS "user:ADMIN" '${JSON.stringify(adminUser)}'`);
    runWranglerCommand(`wrangler kv key put --remote --binding=USERS "username:admin" "ADMIN"`);
    runWranglerCommand(`wrangler kv key put --remote --binding=USERS "service-token:admin" '${JSON.stringify(serviceToken)}'`);
    runWranglerCommand(`wrangler kv key put --remote --binding=USERS "service-token-name:admin" "admin"`);
    runWranglerCommand(`wrangler kv key put --remote --binding=USERS "token:${hashToken(adminToken)}" "admin"`);

    console.log('Admin service token initialized from ADMIN_TOKEN.');
  } catch (error) {
    console.error('Error initializing admin:', error);
  }
}

initAdmin();
