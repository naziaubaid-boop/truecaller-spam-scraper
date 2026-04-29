/**
 * Truecaller Unlister
 * Unlists "name spam" numbers from Truecaller.
 * No login required — uses the public unlisting page.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const csv = require('csv-parser');
const { createObjectCsvWriter } = require('csv-writer');
const config = require('./config');
const Utils = require('./utils');
const ChromeLauncher = require('./chrome-launcher');

const UNLISTING_URL = 'https://www.truecaller.com/unlisting';
const PROFILES_FILE = require('path').join(__dirname, '..', 'profiles.json');

function isKnownProfile(name) {
  try {
    const profiles = JSON.parse(require('fs').readFileSync(PROFILES_FILE, 'utf8'));
    return profiles.some(p => p.name === name);
  } catch (e) {
    return false;
  }
}

class TruecallerUnlister {
  /**
   * @param {string} csvPath - Path to the CSV file
   * @param {string} profile  - Chrome profile name
   */
  constructor(csvPath, profile = 'default') {
    this.csvPath = csvPath;
    this.profile = profile;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.chromeLauncher = new ChromeLauncher(profile);
    this.cookiesAccepted = false; // only need to accept once per session
  }

  // ─── Chrome / Playwright ────────────────────────────────────────────────────

  async closeAll(clearData = false) {
    if (this.browser) {
      try { await this.browser.close(); } catch (e) {}
      this.browser = null;
    }
    await this.chromeLauncher.close();
    if (clearData) this.chromeLauncher.clearData();
  }

  // ─── CSV ────────────────────────────────────────────────────────────────────

  async readData() {
    return new Promise((resolve, reject) => {
      const results = [];
      fs.createReadStream(this.csvPath)
        .pipe(csv())
        .on('data', data => results.push(data))
        .on('end', () => {
          console.log(`✅ CSV loaded: ${results.length} rows`);
          resolve(results);
        })
        .on('error', reject);
    });
  }

  async writeData(data) {
    const knownHeaders = [
      'caller_id', 'phone_number_truecaller_status', 'color', 'is_likely_biz', 'name',
      'processed_at', 'spam_check_profile',
      'unlist_status', 'unlist_output', 'unlist_profile', 'unlisted_at',
    ];
    // Preserve original column order — original columns come first, then any new result columns.
    // If the original CSV used an alias for caller_id (number/primary_number/raw_phone_number),
    // don't add a separate caller_id column — the alias already holds the same data.
    const originalCols = this.originalColumns || [];
    const callerIdAliases = ['number', 'primary_number', 'raw_phone_number'];
    const hasCallerIdAlias = originalCols.some(h => callerIdAliases.includes(h));
    const newCols = knownHeaders.filter(h => {
      if (originalCols.includes(h)) return false;
      if (h === 'caller_id' && hasCallerIdAlias) return false;
      return true;
    });
    const allDataKeys = data.length > 0 ? Object.keys(data[0]) : [];
    const remainingCols = allDataKeys.filter(h => !originalCols.includes(h) && !newCols.includes(h));
    const headers = [...originalCols, ...newCols, ...remainingCols];

    const csvWriter = createObjectCsvWriter({
      path: this.csvPath,
      header: headers.map(h => ({ id: h, title: h })),
    });
    await csvWriter.writeRecords(data);
    console.log(`   💾 Saved to: ${this.csvPath}`);
  }

  // ─── Page helpers ───────────────────────────────────────────────────────────

  async acceptCookiesIfPresent() {
    if (this.cookiesAccepted) return;
    try {
      // The consent banner loads inside an iframe — wait up to 5s for it to appear
      await this.page.waitForSelector('iframe[src*="cookies.truecaller.com"]', { timeout: 5000 });
      console.log('   🍪 Accepting cookies...');
      // Click the button inside the iframe using frameLocator
      const frame = this.page.frameLocator('iframe[src*="cookies.truecaller.com"]');
      await frame.locator('#btn-accept-all').click({ timeout: 5000 });
      // Wait for the iframe to fully detach — it blocks other clicks if still in DOM
      await this.page.waitForSelector('iframe[src*="cookies.truecaller.com"]', {
        state: 'detached',
        timeout: 5000,
      }).catch(() => {});
      await Utils.sleep(2500, 4000);
      this.cookiesAccepted = true;
    } catch (e) {
      // Banner not present (already accepted on this profile) — continue
    }
  }

  /**
   * Click the reCAPTCHA checkbox.
   * Returns true if clicked, false on error.
   * Whether it passed is determined by whether Q1 appears afterwards (step 4).
   */
  async clickRecaptcha() {
    try {
      console.log('   🤖 Clicking reCAPTCHA checkbox...');
      const frame = this.page.frameLocator('iframe[title="reCAPTCHA"]');
      await frame.locator('#recaptcha-anchor').click({ timeout: 10000 });
      return true;
    } catch (e) {
      console.log(`   ⚠️  reCAPTCHA click failed: ${e.message}`);
      return false;
    }
  }

  // ─── Unlisting flow ─────────────────────────────────────────────────────────

  /**
   * Run the full unlisting flow for one phone number.
   * Returns: { status: 'yes'|'no'|'failed', modalTitle: string, reason?: string }
   *   status 'yes'    — modal said "Unlisted"
   *   status 'no'     — modal appeared but said something other than "Unlisted"
   *   status 'failed' — technical failure (captcha, page error, etc.)
   *   reason 'captcha' — internal flag for consecutive captcha tracking only
   */
  async unlistNumber(phoneNumber) {
    const FAIL = (reason = '') => ({ status: 'failed', modalTitle: '', reason });

    try {
      // Refresh page reference — the stored reference can go stale if Chrome
      // closed/replaced the tab between runs
      const pages = this.context.pages();
      this.page = pages.length > 0 ? pages[0] : await this.context.newPage();

      // Navigate fresh each time so page state is clean
      // timeout: 0 = no timeout — fresh profiles can be slow to load
      console.log('   🌐 Loading unlisting page...');
      await this.page.goto(UNLISTING_URL, { waitUntil: 'domcontentloaded', timeout: 0 });
      await Utils.sleep(2500, 4000);

      await this.acceptCookiesIfPresent();

      // ── Step 1: Click "No, I want to unlist" ──────────────────────────────
      try {
        await this.page.waitForSelector('button.outline-btn', { timeout: 10000 });
        const outlineBtns = await this.page.$$('button.outline-btn');
        let clicked = false;
        for (const btn of outlineBtns) {
          const text = await btn.textContent();
          if (text && text.toLowerCase().includes('unlist')) {
            console.log('   🖱️  Clicking "No, I want to unlist"...');
            await btn.click();
            clicked = true;
            break;
          }
        }
        if (!clicked) throw new Error('Unlist button not found');
        await Utils.sleep(2500, 4000);
      } catch (e) {
        console.log(`   ❌ Could not click unlist button: ${e.message}`);
        return FAIL();
      }

      // ── Step 2: Enter phone number ────────────────────────────────────────
      try {
        await this.page.waitForSelector('#phonenumber', { timeout: 10000 });
        // Ensure + prefix — LibreOffice strips it when saving CSVs
        const phoneToEnter = Utils.preparePhoneForUnlisting(phoneNumber);
        console.log(`   ⌨️  Entering: ${phoneToEnter}`);
        await this.page.click('#phonenumber', { clickCount: 3 });
        await Utils.sleep(500, 800);
        await this.page.type('#phonenumber', phoneToEnter, { delay: 80 });
        await Utils.sleep(2500, 4000);
      } catch (e) {
        console.log(`   ❌ Could not enter phone number: ${e.message}`);
        return FAIL();
      }

      // ── Step 3: Click reCAPTCHA checkbox ─────────────────────────────────
      if (!await this.clickRecaptcha()) return FAIL('captcha');

      // ── Step 4: Wait for Q1 — proves CAPTCHA passed ──────────────────────
      // Phase 1: silent 10s wait — normal auto-pass takes ~2-5s.
      // Phase 2: if still not passed, alert user (image challenge) and give 60s to solve manually.
      {
        console.log('   ⏳ Waiting for CAPTCHA to pass...');
        const q1Locator = this.page.locator('h6', { hasText: 'Do you still have access' });
        let passed = false;

        // Phase 1: 10s silent wait
        try {
          await q1Locator.waitFor({ timeout: 10000 });
          passed = true;
        } catch (e) { /* not yet */ }

        if (!passed) {
          // Alert: terminal bell + macOS sound
          process.stdout.write('\x07');
          try { require('child_process').exec('afplay /System/Library/Sounds/Ping.aiff'); } catch (e) {}
          console.log('\n   🧩 Possible image CAPTCHA — please solve it in the browser!');
          console.log('   ⏳ Waiting up to 60s for manual solve...\n');

          // Phase 2: poll every 2s for up to 60s
          for (let t = 0; t < 30 && !passed; t++) {
            await new Promise(r => setTimeout(r, 2000));
            passed = (await q1Locator.count()) > 0;
          }
        }

        if (!passed) {
          console.log('   ❌ CAPTCHA not resolved within 60s — stopping.');
          return FAIL('captcha');
        }
        console.log('   ✅ reCAPTCHA passed!');
      }

      // ── Step 5: Q1 — "Do you still have access to this phone number?" → Yes
      try {
        const q1 = this.page.locator('.my-8').filter({
          has: this.page.locator('h6', { hasText: 'Do you still have access' }),
        });
        await Utils.sleep(2500, 4000);
        await q1.locator('button', { hasText: 'Yes' }).click({ timeout: 8000 });
        console.log('   ✅ Q1: Yes (have access)');
      } catch (e) {
        console.log(`   ❌ Q1 failed: ${e.message}`);
        return FAIL();
      }

      // ── Step 6: Q2 — "Are you able to send and receive SMSs?" → Yes ───────
      try {
        // Q2 appears after Q1 is answered
        await this.page.locator('h6', { hasText: 'send and receive SMS' })
          .waitFor({ timeout: 10000 });
        await Utils.sleep(2500, 4000);
        const q2 = this.page.locator('.my-8').filter({
          has: this.page.locator('h6', { hasText: 'send and receive SMS' }),
        });
        await q2.locator('button', { hasText: 'Yes' }).click({ timeout: 8000 });
        console.log('   ✅ Q2: Yes (can SMS)');
      } catch (e) {
        console.log(`   ❌ Q2 failed: ${e.message}`);
        return FAIL();
      }

      // ── Step 7: Select reason (appears after Q2 is answered) ─────────────
      try {
        await this.page.waitForSelector(
          'input[value="dont-want-truecaller-to-show-name"]',
          { timeout: 10000 }
        );
        await Utils.sleep(2500, 4000);
        await this.page.click('input[value="dont-want-truecaller-to-show-name"]');
        console.log('   ☑️  Selected: "I don\'t want Truecaller to show my name"');
      } catch (e) {
        console.log(`   ❌ Reason selection failed: ${e.message}`);
        return FAIL();
      }

      // ── Step 8: Click Unlist submit ───────────────────────────────────────
      try {
        await this.page.waitForSelector('button.btn[type="submit"]', { timeout: 8000 });
        await Utils.sleep(2500, 4000);
        await this.page.click('button.btn[type="submit"]');
        console.log('   🖱️  Clicking Unlist...');
        await Utils.sleep(4000, 6000); // modal takes a moment to appear
      } catch (e) {
        console.log(`   ❌ Unlist submit failed: ${e.message}`);
        return FAIL();
      }

      // ── Step 9: Read modal and dismiss ───────────────────────────────────
      // Active modal has .shadow class — hidden modals don't, so we use that to target exactly one.
      try {
        await this.page.waitForSelector('.modal__content.shadow', { timeout: 15000 });
        const h4 = await this.page.$('.modal__content.shadow h4');
        const modalTitle = h4 ? (await h4.textContent()).trim() : '';
        console.log(`   📋 Modal: "${modalTitle}"`);

        // Determine result NOW — before any close attempt.
        // If Truecaller confirmed "Unlisted", that's final regardless of close failures.
        const status = modalTitle === 'Unlisted' ? 'yes' : 'no';

        await Utils.sleep(2500, 4000);

        // 1st attempt: X close button
        let closed = false;
        console.log('   🖱️  Closing modal: trying X button...');
        try {
          await this.page.click('.modal__close', { timeout: 3000 });
          await this.page.waitForSelector('.modal__content.shadow', { state: 'detached', timeout: 3000 }).catch(() => {});
          closed = !(await this.page.$('.modal__content.shadow'));
          console.log(closed ? '   ✅ Modal closed via X' : '   ⚠️  X clicked but modal still open');
        } catch (e) {
          console.log(`   ⚠️  X button click failed: ${e.message}`);
        }

        // 2nd attempt: OK or Dismiss button
        if (!closed) {
          console.log('   🖱️  Closing modal: trying OK/Dismiss button...');
          try {
            await this.page.locator('.modal__content.shadow .flex.justify-end button')
              .click({ timeout: 5000 });
            console.log('   ✅ Modal closed via OK/Dismiss');
          } catch (e) {
            console.log(`   ⚠️  OK/Dismiss click failed: ${e.message} — continuing anyway`);
          }
        }

        await Utils.sleep(2500, 4000);
        return { status, modalTitle };
      } catch (e) {
        console.log(`   ❌ Modal not found: ${e.message}`);
        return FAIL();
      }

    } catch (error) {
      console.log(`   ❌ Unexpected error: ${error.message}`);
      return FAIL();
    }
  }

  // ─── Main process ────────────────────────────────────────────────────────────

  needsProcessing(row) {
    // Skip 'yes' and 'no' (both are final modal outcomes). Retry 'failed' and empty.
    return !['yes', 'no'].includes((row.unlist_status || '').trim());
  }

  async process() {
    try {
      console.log('\n' + '='.repeat(60));
      console.log('🔓 TRUECALLER UNLISTER');
      console.log('='.repeat(60));

      const csvData = await this.readData();
      // Capture original column order before mapping so writeData can preserve it
      this.originalColumns = csvData.length > 0 ? Object.keys(csvData[0]) : [];

      const allData = csvData.map(row => ({
        ...row,
        caller_id: row.caller_id || row.number || row.primary_number || row.raw_phone_number || '',
        phone_number_truecaller_status: row.phone_number_truecaller_status || '',
        unlist_status: row.unlist_status || '',
        unlist_output: row.unlist_output || '',
        unlist_profile: row.unlist_profile || '',
        unlisted_at: row.unlisted_at || '',
      }));

      // Only rows where phone_number_truecaller_status is exactly 'name_spam' and not yet done
      const targets = allData.filter(row =>
        (row.phone_number_truecaller_status || '').trim() === 'name_spam' && this.needsProcessing(row)
      );

      const alreadyDone = allData.filter(row =>
        (row.phone_number_truecaller_status || '').trim() === 'name_spam' && !this.needsProcessing(row)
      ).length;

      console.log(`\n📊 "name_spam" rows: ${targets.length + alreadyDone} total`);
      if (alreadyDone > 0) console.log(`   ↳ ${alreadyDone} already done`);
      console.log(`   ↳ ${targets.length} to process`);

      if (targets.length === 0) {
        console.log('\n✅ Nothing to process.\n');
        return { status: 'complete', unlisted: 0, alreadyUnlisted: alreadyDone, captchaBlocked: 0, failed: 0 };
      }

      // Launch Chrome (no login needed — any profile works)
      await this.chromeLauncher.launch();
      console.log('🔗 Connecting Playwright to Chrome...');
      const debuggerUrl = await this.chromeLauncher.getDebuggerUrl();
      this.browser = await chromium.connectOverCDP(debuggerUrl);
      const contexts = this.browser.contexts();
      this.context = contexts[0];
      const pages = this.context.pages();
      this.page = pages.length > 0 ? pages[0] : await this.context.newPage();

      const isTempProfile = !isKnownProfile(this.profile);

      let unlisted = 0;
      let alreadyUnlisted = 0;
      let captchaBlocked = 0;
      let failed = 0;

      for (let i = 0; i < targets.length; i++) {
        const row = targets[i];
        const phoneNumber = row.caller_id;

        console.log('\n' + '='.repeat(60));
        console.log(`🔓 UNLIST ${i + 1} of ${targets.length}: ${phoneNumber}`);
        console.log('='.repeat(60));

        const { status, modalTitle, reason } = await this.unlistNumber(phoneNumber);

        // Update the matching row in allData
        const dataRow = allData.find(r => (r.caller_id || r.number) === phoneNumber);
        if (dataRow) {
          dataRow.unlist_status = status;
          dataRow.unlist_output = modalTitle;
          dataRow.unlist_profile = this.profile;
          dataRow.unlisted_at = Utils.getFormattedDateTime();
          if (status === 'yes') dataRow.phone_number_truecaller_status = 'not_spam';
          else if (status === 'no') dataRow.phone_number_truecaller_status = 'spam';
          // on 'failed' — leave phone_number_truecaller_status unchanged
        }

        await this.writeData(allData);

        switch (status) {
          case 'yes':
            console.log(`\n✅ Unlisted: ${phoneNumber}`);
            unlisted++;
            break;
          case 'no':
            console.log(`\nℹ️  Modal response: "${modalTitle}" — ${phoneNumber}`);
            alreadyUnlisted++;
            break;
          default: // 'failed'
            failed++;
            if (reason === 'captcha') captchaBlocked++;
            console.log(`\n⛔ Stopping after failure on ${phoneNumber} — fix and re-run.`);
            await this.closeAll(isTempProfile);
            return { status: 'stopped', unlisted, alreadyUnlisted, captchaBlocked, failed };
        }

        if (i < targets.length - 1) {
          console.log('\n⏸️  Cooling down before next number...');
          await Utils.sleep(10000, 15000);
        }
      }

      await this.closeAll(isTempProfile);

      console.log('\n' + '='.repeat(60));
      console.log('✅ UNLISTING COMPLETE');
      console.log('='.repeat(60));
      console.log(`✅ Yes (unlisted):    ${unlisted}`);
      console.log(`ℹ️  No (other modal):  ${alreadyUnlisted}`);
      console.log(`❌ Failed:            ${failed}${captchaBlocked ? ` (incl. ${captchaBlocked} captcha)` : ''}`);
      console.log('='.repeat(60) + '\n');

      return { status: 'complete', unlisted, alreadyUnlisted, captchaBlocked, failed };

    } catch (error) {
      console.log(`\n❌ ERROR: ${error.message}\n`);
      await this.closeAll(!isKnownProfile(this.profile));
      return { status: 'error' };
    }
  }
}

module.exports = TruecallerUnlister;