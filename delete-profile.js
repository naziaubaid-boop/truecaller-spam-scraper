/**
 * Delete a Truecaller Chrome profile
 * Shows both profiles.json entries and raw chrome_profile/ directories.
 *
 * Usage: npm run delete-profile
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const ChromeLauncher = require('./src/chrome-launcher');
const { getProfileUserDataDir } = require('./src/config');

const PROFILES_FILE = path.join(__dirname, 'profiles.json');
const CHROME_PROFILE_BASE = path.join(__dirname, 'chrome_profile');

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

/** Names of subdirectories inside chrome_profile/ (excludes the base dir itself = "default") */
function getRawProfileNames() {
  if (!fs.existsSync(CHROME_PROFILE_BASE)) return [];
  return fs.readdirSync(CHROME_PROFILE_BASE).filter(name => {
    const full = path.join(CHROME_PROFILE_BASE, name);
    return fs.statSync(full).isDirectory();
  });
}

function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  console.log('\n' + '='.repeat(50));
  console.log('  DELETE TRUECALLER PROFILE');
  console.log('='.repeat(50));

  const jsonProfiles = loadProfiles();
  const jsonNames = new Set(jsonProfiles.map(p => p.name));

  // Raw = directories in chrome_profile/ that are NOT in profiles.json
  // (exclude "default" since its data lives at the base dir, not a subdir)
  const rawNames = getRawProfileNames().filter(n => !jsonNames.has(n));

  if (jsonProfiles.length === 0 && rawNames.length === 0) {
    console.log('\n❌ No profiles found.\n');
    process.exit(0);
  }

  // Build a flat numbered list combining both groups
  const entries = []; // { name, source: 'json'|'raw', jsonEntry? }

  if (jsonProfiles.length > 0) {
    console.log('\n── Profiles (profiles.json) ──\n');
    jsonProfiles.forEach(p => {
      entries.push({ name: p.name, source: 'json', jsonEntry: p });
      const status = p.is_logged_in ? '✅ logged in' : '❌ not logged in';
      console.log(`   ${entries.length}. ${p.name.padEnd(22)} ${status}`);
    });
  }

  if (rawNames.length > 0) {
    console.log('\n── Raw profiles (chrome_profile/ only) ──\n');
    rawNames.forEach(name => {
      entries.push({ name, source: 'raw' });
      console.log(`   ${entries.length}. ${name}`);
    });
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await prompt(rl, '\nEnter number to delete (or q to quit): ')).trim();
  rl.close();

  if (answer.toLowerCase() === 'q') {
    console.log('\n👋 Cancelled.\n');
    process.exit(0);
  }

  const num = parseInt(answer);
  if (isNaN(num) || num < 1 || num > entries.length) {
    console.log('\n❌ Invalid selection.\n');
    process.exit(1);
  }

  const target = entries[num - 1];
  console.log(`\n⚠️  Deleting profile: ${target.name} (${target.source === 'json' ? 'profiles.json' : 'raw'})`);

  // Kill Chrome if running
  const launcher = new ChromeLauncher(target.name);
  if (await launcher.isChromeRunning()) {
    console.log('🔴 Chrome is running — closing it first...');
    await launcher.close();
  }

  // Remove from profiles.json (only if it was a json profile)
  if (target.source === 'json') {
    const updated = jsonProfiles.filter(p => p.name !== target.name);
    saveProfiles(updated);
    console.log(`✅ Removed "${target.name}" from profiles.json`);
  }

  // Delete chrome_profile/NAME/ directory
  const profileDir = getProfileUserDataDir(target.name);
  if (fs.existsSync(profileDir)) {
    fs.rmSync(profileDir, { recursive: true, force: true });
    console.log(`🗑️  Deleted ${profileDir}`);
  } else {
    console.log(`ℹ️  No Chrome profile directory found at ${profileDir}`);
  }

  console.log(`\n✅ Profile "${target.name}" fully deleted.\n`);
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
