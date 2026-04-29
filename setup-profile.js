/**
 * Truecaller Profile Setup
 * Creates and manages Chrome profiles for Truecaller scraping.
 *
 * Usage: npm run create-profile
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const ChromeLauncher = require('./src/chrome-launcher');

const PROFILES_FILE = path.join(__dirname, 'profiles.json');

function loadProfiles() {
  if (!fs.existsSync(PROFILES_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveProfiles(profiles) {
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2));
}

function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function printProfileList() {
  const profiles = loadProfiles();
  if (profiles.length === 0) {
    console.log('   (none)');
    return;
  }
  profiles.forEach(p => {
    const status = p.is_logged_in ? '✅ logged in' : '❌ not logged in';
    console.log(`   • ${p.name.padEnd(20)} ${status}`);
  });
}

async function setupOneProfile(rl) {
  const profiles = loadProfiles();

  const rawName = (await prompt(rl, '\nEnter name (e.g. kishor): ')).trim().toLowerCase().replace(/\s+/g, '_');
  const last4 = (await prompt(rl, 'Enter last 4 digits of phone number: ')).trim();

  if (!rawName) {
    console.log('❌ Name cannot be empty.');
    return;
  }
  if (!/^\d{4}$/.test(last4)) {
    console.log('❌ Last 4 digits must be exactly 4 numbers.');
    return;
  }

  const profileName = `${rawName}_${last4}`;
  const existing = profiles.find(p => p.name === profileName);

  if (existing) {
    console.log(`\n⚠️  Profile "${profileName}" already exists (logged_in: ${existing.is_logged_in})`);
    const open = (await prompt(rl, 'Open Truecaller page to (re)login? (y/n): ')).trim().toLowerCase();
    if (open !== 'y') return;
  } else {
    console.log(`\n✅ Setting up new profile: ${profileName}`);
  }

  // Launch Chrome with this profile
  console.log(`\n🚀 Opening Chrome for profile "${profileName}"...`);
  const launcher = new ChromeLauncher(profileName);
  try {
    await launcher.launch();
  } catch (err) {
    console.log(`❌ Failed to launch Chrome: ${err.message}`);
    return;
  }

  console.log('\n' + '='.repeat(50));
  console.log('ACTION REQUIRED IN CHROME:');
  console.log('1. Enter your phone number on Truecaller');
  console.log('2. Open the Truecaller app on your phone');
  console.log('3. Approve the login notification');
  console.log('='.repeat(50));

  const loginDone = (await prompt(rl, '\nIs login done? (y/n): ')).trim().toLowerCase();

  if (loginDone === 'y') {
    if (existing) {
      existing.is_logged_in = true;
      existing.updated_at = new Date().toISOString();
    } else {
      profiles.push({
        name: profileName,
        is_logged_in: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    saveProfiles(profiles);
    console.log(`\n✅ Profile "${profileName}" saved as logged in!`);
  } else {
    console.log('\n⚠️  Login not confirmed. Profile saved as not logged in.');
    if (!existing) {
      profiles.push({
        name: profileName,
        is_logged_in: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      saveProfiles(profiles);
    }
  }
}

async function main() {
  console.log('\n' + '='.repeat(50));
  console.log('  TRUECALLER PROFILE SETUP');
  console.log('  Naming: {name}_{last4}  e.g. kishor_4321');
  console.log('='.repeat(50));
  console.log('\nExisting profiles:');
  printProfileList();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let continueAdding = true;
  while (continueAdding) {
    await setupOneProfile(rl);
    const another = (await prompt(rl, '\nAdd another profile? (y/n): ')).trim().toLowerCase();
    continueAdding = another === 'y';
  }

  rl.close();

  console.log('\n📋 Updated profile list:');
  printProfileList();
  console.log('\n✅ Done! Run "npm start" to begin scraping.\n');
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
