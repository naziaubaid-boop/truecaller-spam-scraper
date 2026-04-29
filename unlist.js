/**
 * Truecaller Unlister - Entry Point
 *
 * Unlists all "name spam" numbers in a CSV from Truecaller.
 * No Truecaller login required.
 *
 * Usage:
 *   npm run unlist                     # uses "default" Chrome profile
 *   node unlist.js --profile=NAME      # use a specific Chrome profile
 */

const path = require('path');
const readline = require('readline');
const os = require('os');
const { exec } = require('child_process');
const TruecallerUnlister = require('./src/unlister');
const config = require('./src/config');
const Utils = require('./src/utils');

function playCompletionSound() {
  try {
    const platform = os.platform();
    if (platform === 'darwin') exec('afplay /System/Library/Sounds/Glass.aiff');
    else if (platform === 'linux') exec('paplay /usr/share/sounds/freedesktop/stereo/complete.oga 2>/dev/null || true');
    else if (platform === 'win32') exec('powershell -c "[console]::beep(1000,500)"');
  } catch (e) {}
  process.stdout.write('\x07');
}

function selectFile(csvFiles, autoSec = 5) {
  return new Promise(resolve => {
    console.log('\n📂 Available files:\n');
    csvFiles.forEach((f, i) => console.log(`   ${i + 1}. ${f}`));

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const finish = (fileName) => { rl.close(); resolve(fileName); };

    if (csvFiles.length === 1) {
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
      rl.question('\nSelect file number: ', answer => {
        const num = parseInt(answer.trim());
        const selected = (num >= 1 && num <= csvFiles.length) ? csvFiles[num - 1] : csvFiles[0];
        console.log(`→ Selected: ${selected}`);
        finish(selected);
      });
    }
  });
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('🔓 TRUECALLER UNLISTER');
  console.log('='.repeat(60));

  Utils.ensureDir(config.paths.input);

  // --profile=NAME pins to a specific Chrome profile (no login needed, any profile works)
  const profileArg = (process.argv.find(a => a.startsWith('--profile=')) || '').split('=')[1] || 'default';
  console.log(`\n📌 Chrome profile: ${profileArg}`);

  const csvFiles = Utils.listCsvFiles(config.paths.input);
  if (csvFiles.length === 0) {
    console.log('\n❌ No CSV files found in data/\n');
    playCompletionSound();
    process.exit(0);
  }

  const selectedFile = await selectFile(csvFiles);
  const csvPath = path.join(config.paths.input, selectedFile);

  console.log('\n' + '='.repeat(60));
  console.log(`📄 Processing: ${selectedFile}`);
  console.log('='.repeat(60));

  const unlister = new TruecallerUnlister(csvPath, profileArg);
  const result = await unlister.process();

  console.log('\n' + '='.repeat(60));
  console.log('🏁 ALL DONE');
  console.log('='.repeat(60));

  if (result.status === 'stopped') {
    console.log('⚠️  Stopped early — fix the issue and re-run.');
    console.log('   Already-processed numbers will be skipped on next run.');
  } else if (result.status === 'complete') {
    console.log('✨ All name-spam numbers processed.');
  }

  console.log('');
  playCompletionSound();
  process.exit(0);
}

process.on('SIGINT', () => {
  console.log('\n\n👋 Stopped.');
  process.exit(0);
});

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
