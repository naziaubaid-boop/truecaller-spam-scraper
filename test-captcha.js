/**
 * Captcha Test Script
 * Opens the Truecaller unlisting page and attempts to solve the reCAPTCHA
 * by clicking the checkbox with real Chrome.
 *
 * Run: node test-captcha.js
 * Run with specific profile: node test-captcha.js --profile=default
 *
 * Look for one of three results:
 *   ✅ AUTO-PASSED  — checkbox ticked automatically, no image challenge
 *   🖼️  CHALLENGE    — image grid appeared (manual solve needed)
 *   ❌ BLOCKED      — reCAPTCHA refused / error
 */

const { chromium } = require('playwright');
const ChromeLauncher = require('./src/chrome-launcher');
const Utils = require('./src/utils');

const UNLIST_URL = 'https://www.truecaller.com/unlisting';
const PROFILE = (process.argv.find(a => a.startsWith('--profile=')) || '--profile=default').split('=')[1];

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('🧪 CAPTCHA TEST — Truecaller Unlisting Page');
  console.log('='.repeat(60));
  console.log(`Profile : ${PROFILE}`);
  console.log(`URL     : ${UNLIST_URL}\n`);

  const launcher = new ChromeLauncher(PROFILE);
  await launcher.launch();

  const debuggerUrl = await launcher.getDebuggerUrl();
  const browser = await chromium.connectOverCDP(debuggerUrl);
  const context = browser.contexts()[0];

  // Open in a new tab so we don't disturb existing tabs
  const page = await context.newPage();

  console.log('🌐 Navigating to unlisting page...');
  await page.goto(UNLIST_URL, { waitUntil: 'domcontentloaded' });
  await Utils.sleep(2000, 3000);

  // Step 1: click "No, I want to unlist"
  console.log('🖱️  Clicking "No, I want to unlist"...');
  try {
    await page.click('a[href="/change-number"].outline-btn, button.outline-btn', { timeout: 8000 });
    await Utils.sleep(1500, 2000);
  } catch (e) {
    // Try text-based selector as fallback
    try {
      await page.getByText('No, I want to unlist').click({ timeout: 5000 });
      await Utils.sleep(1500, 2000);
    } catch (e2) {
      console.log('⚠️  Could not find "No, I want to unlist" button — page may have changed.');
      console.log('    Check the Chrome window and try clicking it manually, then press Enter here.');
      await waitForEnter();
    }
  }

  // Step 2: fill in a test phone number
  console.log('⌨️  Entering test phone number...');
  try {
    await page.fill('#phonenumber', '+917737848583', { timeout: 5000 });
    await Utils.sleep(500, 1000);
  } catch (e) {
    console.log('⚠️  Phone number input not found yet — may still be loading.');
  }

  // Step 3: try to click the reCAPTCHA checkbox inside the iframe
  console.log('\n🤖 Attempting to click reCAPTCHA checkbox...');
  await Utils.sleep(1000, 1500);

  let result = 'unknown';

  try {
    const recaptchaFrame = page.frameLocator('iframe[title="reCAPTCHA"]');
    const checkbox = recaptchaFrame.locator('#recaptcha-anchor');

    await checkbox.waitFor({ timeout: 8000 });
    await checkbox.click();

    console.log('   Clicked. Waiting to see if it auto-passes...');
    await Utils.sleep(3000, 4000);

    // Check outcomes
    const isChecked = await recaptchaFrame.locator('.recaptcha-checkbox-checked').isVisible().catch(() => false);
    const hasChallenge = await page.locator('iframe[title="recaptcha challenge expires in two minutes"]').isVisible().catch(() => false);

    if (isChecked && !hasChallenge) {
      result = 'auto-passed';
      console.log('\n✅ AUTO-PASSED — reCAPTCHA solved without image challenge!');
      console.log('   Full automation is possible with this profile.\n');
    } else if (hasChallenge) {
      result = 'challenge';
      console.log('\n🖼️  CHALLENGE — Image grid appeared.');
      console.log('   Auto-solve failed. Options:');
      console.log('   1. Use a 2captcha/Anti-captcha paid service (~$1/1000 solves)');
      console.log('   2. Wait for user to manually solve each captcha (script pauses)');
      console.log('   3. Use a more established Chrome profile with browsing history\n');
    } else {
      result = 'unknown';
      console.log('\n❓ UNCERTAIN — Could not detect outcome clearly.');
      console.log('   Check the Chrome window to see the current state.\n');
    }

  } catch (e) {
    result = 'blocked';
    console.log(`\n❌ BLOCKED — Could not interact with reCAPTCHA: ${e.message}\n`);
  }

  console.log('='.repeat(60));
  console.log(`Result: ${result.toUpperCase()}`);
  console.log('='.repeat(60));
  console.log('\nChrome window left open for inspection.');
  console.log('Press Ctrl+C to exit.\n');

  await browser.close();
}

function waitForEnter() {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question('Press Enter to continue...', () => { rl.close(); resolve(); }));
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
