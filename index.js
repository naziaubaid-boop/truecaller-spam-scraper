/**
 * Truecaller Scraper - Automated Run
 *
 * Lists CSVs from data/, lets you pick one (auto-picks after 5s if only one exists).
 * Processes it using logged-in Chrome profiles, rotating automatically on rate limit.
 * Plays a sound and exits when done.
 *
 * Usage:
 *   npm start
 *
 * Setup (one-time per profile):
 *   npm run create-profile
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const readline = require('readline');
const TruecallerScraper = require('./src/scraper');
const config = require('./src/config');
const Utils = require('./src/utils');

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

function playCompletionSound() {
  try {
    const platform = os.platform();
    if (platform === 'darwin') {
      exec('afplay /System/Library/Sounds/Glass.aiff');
    } else if (platform === 'linux') {
      exec('paplay /usr/share/sounds/freedesktop/stereo/complete.oga 2>/dev/null || aplay /usr/share/sounds/alsa/Front_Center.wav 2>/dev/null');
    } else if (platform === 'win32') {
      exec('powershell -c "[console]::beep(1000,500)"');
    }
  } catch (e) {
    // Sound is non-critical
  }
  process.stdout.write('\x07');
}

function warnSessionExpired(profileName) {
  const platform = os.platform();
  try {
    if (platform === 'darwin') {
      // Basso = low warning thud, distinct from Glass (completion)
      exec('afplay /System/Library/Sounds/Basso.aiff');
      // Native macOS notification
      const msg = `Profile "${profileName}" is logged out of Truecaller. Re-login with: npm run create-profile`;
      exec(`osascript -e 'display notification "${msg}" with title "Truecaller Scraper" subtitle "Session Expired ⚠️"'`);
    } else if (platform === 'linux') {
      exec('paplay /usr/share/sounds/freedesktop/stereo/dialog-warning.oga 2>/dev/null || true');
      exec(`notify-send "Truecaller Scraper" "Profile '${profileName}' is logged out. Re-login with: npm run create-profile" --urgency=normal 2>/dev/null || true`);
    } else if (platform === 'win32') {
      exec('powershell -c "[console]::beep(400,800)"');
      exec(`powershell -c "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Profile ${profileName} is logged out of Truecaller.', 'Session Expired')"`);
    }
  } catch (e) {
    // Notification is non-critical
  }
  process.stdout.write('\x07');
}

/**
 * Show file list and wait for selection.
 * If only one file: auto-picks after `autoSec` seconds with a live countdown.
 * If multiple files: waits indefinitely for user to type a number.
 * Returns the selected file name.
 */
function selectFile(csvFiles, autoSec = 5) {
  return new Promise(resolve => {
    console.log('\n📂 Available files:\n');
    csvFiles.forEach((f, i) => console.log(`   ${i + 1}. ${f}`));

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const finish = (fileName) => {
      rl.close();
      resolve(fileName);
    };

    if (csvFiles.length === 1) {
      // Single file — countdown then auto-pick
      let remaining = autoSec;
      process.stdout.write(`\nPress Enter to confirm, or wait ${remaining}s to auto-select: `);

      const tick = setInterval(() => {
        remaining--;
        if (remaining > 0) {
          process.stdout.write(`\rPress Enter to confirm, or wait ${remaining}s to auto-select: `);
        } else {
          clearInterval(tick);
          process.stdout.write(`\n→ Auto-selected: ${csvFiles[0]}\n`);
          finish(csvFiles[0]);
        }
      }, 1000);

      rl.once('line', () => {
        clearInterval(tick);
        process.stdout.write(`→ Selected: ${csvFiles[0]}\n`);
        finish(csvFiles[0]);
      });

    } else {
      // Multiple files — require explicit selection
      rl.question('\nSelect file number: ', answer => {
        const num = parseInt(answer.trim());
        const selected = (num >= 1 && num <= csvFiles.length)
          ? csvFiles[num - 1]
          : csvFiles[0];
        console.log(`→ Selected: ${selected}`);
        finish(selected);
      });
    }
  });
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('🤖 TRUECALLER SCRAPER - AUTOMATED RUN');
  console.log('='.repeat(60));

  Utils.ensureDir(config.paths.input);
  Utils.ensureDir(config.paths.output);
  Utils.ensureDir(config.paths.logs);

  // Load profiles
  const allProfiles = loadProfiles();

  // --profile=NAME pins to a specific profile
  const profileArg = (process.argv.find(a => a.startsWith('--profile=')) || '').split('=')[1];
  let loggedInProfiles;

  if (profileArg) {
    const pinned = allProfiles.find(p => p.name === profileArg);
    if (!pinned) {
      console.log(`\n❌ Profile "${profileArg}" not found in profiles.json`);
      console.log('   Run: npm run create-profile\n');
      process.exit(1);
    }
    if (!pinned.is_logged_in) {
      console.log(`\n❌ Profile "${profileArg}" exists but is not logged in.`);
      console.log('   Run: npm run create-profile  (to re-login)\n');
      process.exit(1);
    }
    loggedInProfiles = [pinned];
    console.log(`\n📌 Pinned to profile: ${profileArg}`);
  } else {
    loggedInProfiles = allProfiles.filter(p => p.is_logged_in);
  }

  if (loggedInProfiles.length === 0) {
    console.log('\n❌ No logged-in profiles found.');
    console.log('   Run: npm run create-profile\n');
    process.exit(1);
  }

  // List CSV files in data/
  const csvFiles = Utils.listCsvFiles(config.paths.input);
  if (csvFiles.length === 0) {
    console.log('\n❌ No CSV files found in data/\n');
    playCompletionSound();
    process.exit(0);
  }

  console.log(`\n👤 Profiles: ${loggedInProfiles.map(p => p.name).join(', ')}`);

  // Select which file to process
  const selectedFile = await selectFile(csvFiles);
  const csvPath = path.join(config.paths.input, selectedFile);

  console.log('\n' + '='.repeat(60));
  console.log(`📄 Processing: ${selectedFile}`);
  console.log('='.repeat(60));

  // Rotate through profiles until file is complete or all profiles exhausted
  let profileIndex = 0;
  let fileComplete = false;

  while (profileIndex < loggedInProfiles.length && !fileComplete) {
    const profile = loggedInProfiles[profileIndex];

    // max_spam_count: absent/undefined = no limit, 0 = skip this profile, N = stop after N rows
    const maxCount = 'max_spam_count' in profile ? profile.max_spam_count : null;
    if (maxCount === 0) {
      console.log(`\n⏭️  Profile "${profile.name}" has max_spam_count = 0 — skipping.`);
      profileIndex++;
      continue;
    }

    const limitMsg = maxCount !== null ? ` (limit: ${maxCount} rows)` : '';
    console.log(`\n📌 Profile: ${profile.name}${limitMsg}`);

    const scraper = new TruecallerScraper({ type: 'csv', path: csvPath }, profile.name, { maxCount });
    const result = await scraper.process();

    switch (result.status) {
      case 'complete':
        fileComplete = true;
        console.log(`\n✅ Completed: ${selectedFile}`);
        break;

      case 'limit_reached':
        console.log(`\n📊 Profile "${profile.name}" hit its max_spam_count limit — switching to next profile...`);
        profileIndex++;
        break;

      case 'rate_limited':
        console.log(`\n⚡ Rate limited on "${profile.name}" — switching to next profile...`);
        profileIndex++;
        break;

      case 'session_expired': {
        console.log(`\n🔒 Session expired for "${profile.name}" — marking as logged out`);
        const entry = allProfiles.find(p => p.name === profile.name);
        if (entry) {
          entry.is_logged_in = false;
          entry.updated_at = new Date().toISOString();
        }
        saveProfiles(allProfiles);
        warnSessionExpired(profile.name);
        profileIndex++;
        break;
      }

      default:
        console.log(`\n⚠️  Unexpected status "${result.status}" for "${profile.name}" — skipping`);
        profileIndex++;
    }
  }

  if (!fileComplete) {
    console.log(`\n⚠️  All profiles exhausted — some rows may remain unprocessed.`);
    console.log('   Add more profiles with: npm run create-profile');
  }

  console.log('\n' + '='.repeat(60));
  console.log('🏁 ALL DONE');
  console.log('='.repeat(60));
  console.log('✨ All Chrome windows closed.\n');

  playCompletionSound();
  // process.exit(0);
}

process.on('SIGINT', () => {
  console.log('\n\n👋 Stopped — Chrome may still be open if interrupted mid-run.');
  process.exit(0);
});

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
