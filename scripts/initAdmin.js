const { execSync } = require('child_process');
const crypto = require('crypto');

function generateSecureToken() {
  return crypto.randomBytes(32).toString('hex');
}

function runWranglerCommand(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: 'pipe' });
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
      adminCheck = runWranglerCommand('wrangler kv key get --binding=USERS "username:admin"');
    } catch (error) {
      if (error.stderr.includes('404: Not Found')) {
        console.log('Admin user does not exist. Proceeding with initialization.');
        adminCheck = '';
      } else {
        throw error;
      }
    }
    
    if (adminCheck.trim()) {
      console.log('Admin user already exists. Skipping initialization.');
      return;
    }

    console.log('Generating admin token...');
    const adminToken = generateSecureToken();

    const adminUser = {
      id: 'ADMIN',
      token: adminToken,
      username: 'admin',
      enabled: true
    };

    console.log('Saving admin user...');
    runWranglerCommand(`wrangler kv key put --binding=USERS "user:${adminToken}" '${JSON.stringify(adminUser)}'`);
    runWranglerCommand(`wrangler kv key put --binding=USERS "username:admin" "${adminToken}"`);

    console.log(`Admin user initialized with token: ${adminToken}`);
    console.log('Please store this token securely. It will not be shown again.');
  } catch (error) {
    console.error('Error initializing admin:', error);
  }
}

initAdmin();