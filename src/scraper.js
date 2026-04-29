/**
 * Truecaller Scraper - Chrome Stays Open Forever
 */

const { chromium } = require('playwright');
const fs = require('fs');
const csv = require('csv-parser');
const { createObjectCsvWriter } = require('csv-writer');
const config = require('./config');
const Utils = require('./utils');
const ChromeLauncher = require('./chrome-launcher');
const GoogleSheets = require('./google-sheets');

class TruecallerScraper {
  /**
   * @param {string|object} source - CSV path string, or { type: 'google-sheets', url } for CSV export
   * @param {string} profile - Chrome profile name (separate from your main Chrome)
   */
  constructor(source, profile = 'default', options = {}) {
    this.source = typeof source === 'string' ? { type: 'csv', path: source } : source;
    this.profile = profile;
    // maxCount: null = no limit, N = stop after N rows processed this run
    this.maxCount = options.maxCount ?? null;

    const srcPath = this.source.type === 'csv' ? this.source.path : 'gsheet';
    const timestamp = Utils.getTimestamp();
    const basename = srcPath.split('/').pop().replace('.csv', '') || 'results';
    this.outputPath = `${config.paths.output}/${basename}_results_${timestamp}.csv`;

    this.browser = null;
    this.context = null;
    this.page = null;
    this.chromeLauncher = new ChromeLauncher(profile);
  }

  /**
   * Type text like a human
   */
  async humanType(selector, text) {
    const element = await this.page.$(selector);
    if (!element) return false;

    console.log(`   ⌨️  Typing: ${text}`);
    
    for (const char of text) {
      await element.type(char);
      await Utils.sleep(config.delays.typingMin, config.delays.typingMax);
    }

    return true;
  }

  /**
   * Click element with human-like delay
   */
  async humanClick(selector) {
  console.log('🖱 Clicking element...', selector);

  await this.page.waitForSelector(selector, { timeout: 5000 });

  await Utils.sleep(config.delays.mouseMoveMin, config.delays.mouseMoveMax);

  await this.page.click(selector);

  return true;
}

  /**
   * Disconnect Playwright and close the Chrome process (profile data is preserved)
   */
  async closeAll() {
    if (this.browser) {
      try { await this.browser.close(); } catch (e) {}
      this.browser = null;
    }
    await this.chromeLauncher.close();
  }

  /**
   * Check if the current profile is logged in to Truecaller.
   * Navigates to homepage and looks for the "Sign in" CTA.
   * Returns true if logged in, false if not.
   */
  async checkLoginStatus() {
    try {
      await this.page.goto(config.truecallerUrl, { waitUntil: 'domcontentloaded' });
      await Utils.sleep(2000, 3000);
      // Sign-in link is present in the DOM only when NOT logged in
      const signInLink = await this.page.$('[data-cy="TcAccount:desktop"] a[href="#sign-in"]');
      return signInLink === null;
    } catch (e) {
      console.log(`⚠️  Login check failed: ${e.message}`);
      return false;
    }
  }

  /**
   * Search for a phone number.
   * Handles two layouts: search result page (#phone-number) and home page (TcSearchBar).
   */
  async searchNumber(phoneNumber) {
    try {
      console.log(`\n🔍 Searching: ${phoneNumber}`);

      // Try search result page input first (#phone-number), then home page (TcSearchBar)
      let inputSelector;
      let submitSelector;
      try {
  await this.page.waitForSelector('#phone-number', { timeout: 5000 });
  inputSelector = '#phone-number';
  submitSelector = null; // 👈 VERY IMPORTANT
  console.log('🔴 Using search result page form');
} catch (e) {
  const homeInput = await this.page.waitForSelector(
    'input[data-cy="TcSearchBar:input"], form.search-bar--on-image input[type="tel"]',
    { timeout: config.timeouts.default }
  );

  if (homeInput) {
    inputSelector = 'input[data-cy="TcSearchBar:input"], form.search-bar--on-image input[type="tel"]';
    submitSelector = 'button[data-cy="TcSearchBar:submit"], form.search-bar--on-image button[type="submit"]';
    console.log('🔴 Using home page form');
  } else {
    throw new Error('No search input found');
  }
}

      try {
  await this.page.waitForSelector('select[data-cy="TcSearchBar:select"]', { timeout: 5000 });

  await this.page.selectOption('select[data-cy="TcSearchBar:select"]', 'in');

  console.log("🌍 Selected country: India (+91)");

  await Utils.sleep(500, 1000);

} catch (e) {
  console.log("⚠️ Country selection skipped:", e.message);
}
// Clear field
      console.log('   🧹 Clearing input field...');
      const phoneInput = await this.page.$(inputSelector);
      await phoneInput.click({ clickCount: 3 });
      await Utils.sleep(200, 400);
      await this.page.keyboard.press('Backspace');
      await Utils.sleep(config.delays.afterFillMin, config.delays.afterFillMax);

      // Type number
      const cleanNumber = Utils.cleanPhoneNumber(phoneNumber);
      await this.humanType(inputSelector, cleanNumber);

      // Random delay before clicking
      await Utils.sleep(config.delays.afterFillMin, config.delays.afterFillMax);

      console.log("Submit selector:", submitSelector);

console.log("🚀 Submitting using Enter key");
await this.page.keyboard.press('Enter');

      // Wait for results
      await Utils.sleep(config.delays.afterSearchMin, config.delays.afterSearchMax);

      return true;
    } catch (error) {
      console.log(`   ❌ Search failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Extracts color, is_likely_biz, and name from the search result page.
   * Returns { color, is_likely_biz, name } or null for rate limit.
   * Rate limit is only checked when profile div is NOT found - avoids false positives
   * (e.g. "download truecaller" appears in footer/banners on normal result pages).
   */
  async extractResult(phoneNumber) {
    console.log('   🎨 Extracting result details...');

    await Utils.sleep(config.delays.beforeExtractMin, config.delays.beforeExtractMax);

    try {
      // 1. FIRST try to find main circle color - if found, we have a valid result
      let color = null;
      let profileFound = false;
      try {
        // Astro-island components can load async - wait longer for profile to render
        const profileDiv = await this.page.waitForSelector(
          'div[data-astro-cid-vtzuftsq].relative.rounded-full.shadow-lg',
          { timeout: 10000 }
        );
        const style = await profileDiv.getAttribute('style');
        color = Utils.extractHexColor(style) || 'no_color_in_div';
        profileFound = true;
      } catch (e) {
        // Profile div not found - check page content
        const pageContent = await this.page.content();

        // Only rate limit when we see the ACTUAL rate limit message (avoids false positives:
        // "oops"/"too many requests" can appear in scripts, JSON, footers on normal pages)
        if (pageContent.toLowerCase().includes('no result')) {
          console.error('   🛑 Rate limit detected.');
          return null;
        }

        if (pageContent.includes('No result for') || pageContent.includes('Not found')) {
          color = 'number_not_found';
        } else {
          color = 'error_extraction_failed';
        }
      }

      // 2. Name from div.flex-none.font-bold.break-all
      let name = '';
      try {
        const nameDiv = await this.page.$('div.flex-none.font-bold.break-all');
        if (nameDiv) {
          name = (await nameDiv.textContent()).trim();
        }
      } catch (e) {
        // Ignore
      }

      // 3. is_likely_biz: true if chip exists (details.search-warning with "Likely a business")
      //    empty if color is red (#ff4130) or no chip
      let is_likely_biz = '';
      const isRed = color && color.toLowerCase() === '#ff4130';
      if (!isRed) {
        try {
          const chip = await this.page.$('details.search-warning');
          if (chip) {
            const chipText = await chip.textContent();
            if (chipText && chipText.toLowerCase().includes('likely a business')) {
              is_likely_biz = 'true';
            }
          }
        } catch (e) {
          // Ignore
        }
      }

      return { color, is_likely_biz, name };
    } catch (error) {
      console.error(`   ❌ Extract failed: ${error.message}`);
      return { color: 'error_extraction_failed', is_likely_biz: '', name: '' };
    }
  }

  /**
   * Compute phone_number_truecaller_status from extracted result
   * 1. #ff4130 → spam
   * 2. #119D62 → spam
   * 3. #0087ff + is_likely_biz + (name is text or "Likely a business") → name_spam
   * 4. #0087ff + is_likely_biz + name shows number → likely a business
   * 5. #0087ff + !is_likely_biz + name shows number → not_spam
   * 6. #0087ff + !is_likely_biz + name shows text → name_spam
   */
  computeSpamStatus(phoneNumber, color, is_likely_biz, name) {
    const c = (color || '').toLowerCase();
    const isBiz = is_likely_biz === 'true' || is_likely_biz === true;
    const nameShowsNumber = Utils.nameMatchesNumber(phoneNumber, name);

    if (c === '#ff4130') return 'spam';
    if (c === '#119d62') return 'spam';

    if (c === '#0087ff') {
      if (isBiz) {
        return nameShowsNumber ? 'likely a business' : 'name_spam';
      }
      return nameShowsNumber ? 'not_spam' : 'name_spam';
    }

    return ''; // Unknown color
  }

  /**
   * Log complete row in clearly visible format
   */
  logUpdatedRow(row) {
    const cols = ['caller_id', 'phone_number_truecaller_status', 'color', 'is_likely_biz', 'name', 'processed_at', 'spam_check_profile'];
    console.log('\n   📝 Updated row:');
    console.log('   ' + '─'.repeat(60));
    cols.forEach(c => {
      const val = ((row[c] ?? '').toString() || '(empty)').trim();
      console.log(`   │ ${c.padEnd(14)} │ ${val}`);
    });
    console.log('   ' + '─'.repeat(60) + '\n');
  }

  /**
   * Check if row needs processing (skip if already has valid phone_number_truecaller_status)
   * Re-process rows with error states (error_extraction_failed, search_failed, etc.)
   */
  needsProcessing(row) {
    const validStatuses = ['spam', 'name_spam', 'likely a business', 'not_spam'];

    if (validStatuses.includes((row.phone_number_truecaller_status || '').trim())) {
      return false; // Already complete
    }
    // Needs processing: empty phone_number_truecaller_status OR has error state (retry)
    return true;
  }

  /**
   * Read data from CSV or Google Sheets
   */
  async readData() {
    if (this.source.type === 'csv') {
      return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(this.source.path)
          .pipe(csv())
          .on('data', (data) => results.push(data))
          .on('end', () => {
            console.log(`✅ CSV loaded: ${results.length} numbers\n`);
            resolve(results);
          })
          .on('error', (error) => reject(error));
      });
    }

    if (this.source.type === 'google-sheets' && this.source.url) {
      const data = await GoogleSheets.readFromSheetCsv(this.source.url);
      console.log(`✅ Google Sheet loaded: ${data.length} numbers\n`);
      return data;
    }

    throw new Error(`Unknown source type: ${this.source.type}`);
  }

  /**
   * Write results: local CSV = update input file in-place, Google Sheet = new file in data/output
   */
  async writeData(data) {
    const writePath = this.source.type === 'csv' ? this.source.path : this.outputPath;
    const knownHeaders = ['caller_id', 'phone_number_truecaller_status', 'color', 'is_likely_biz', 'name', 'processed_at', 'spam_check_profile', 'unlist_status', 'unlist_output', 'unlist_profile', 'unlisted_at'];
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
      path: writePath,
      header: headers.map(h => ({ id: h, title: h })),
    });
    await csvWriter.writeRecords(data);
    console.log(`   💾 Saved to: ${writePath}`);
  }

  /**
   * Validate CSV
   */
  validateCsv(data) {
    if (data.length === 0) {
      console.log('❌ CSV is empty');
      return false;
    }

    if (!('caller_id' in data[0]) && !('number' in data[0]) && !('primary_number' in data[0]) && !('raw_phone_number' in data[0])) {
      console.log('❌ CSV must have "caller_id", "number", "primary_number", or "raw_phone_number" column');
      return false;
    }

    return true;
  }

  /**
   * Main process
   */
  async process() {
    try {
      console.log('\n' + '='.repeat(60));
      console.log('🚀 STARTING SCRAPER - CHROME NEVER CLOSES');
      console.log('='.repeat(60));

      // Ensure directories exist
      Utils.ensureDir(config.paths.output);
      Utils.ensureDir(config.paths.logs);

      // Read CSV
      const sourceDesc = this.source.type === 'csv' ? this.source.path : (this.source.url || this.source.spreadsheetId);
      console.log(`\n📂 Reading: ${sourceDesc}`);
      const csvData = await this.readData();
      // Capture original column order before mapping so writeData can preserve it
      this.originalColumns = csvData.length > 0 ? Object.keys(csvData[0]) : [];

      if (!this.validateCsv(csvData)) {
        return { status: 'error' };
      }

      // Prepare data
      const processedData = csvData.map(row => ({
        ...row,
        caller_id: row.caller_id || row.number || row.primary_number || row.raw_phone_number,
        color: row.color || '',
        is_likely_biz: row.is_likely_biz || '',
        name: row.name || '',
        phone_number_truecaller_status: row.phone_number_truecaller_status || '',
        processed_at: row.processed_at || '',
        spam_check_profile: row.spam_check_profile || '',
      }));

      const pendingCount = processedData.filter(row => this.needsProcessing(row)).length;
      if (pendingCount < processedData.length) {
        console.log(`📌 ${processedData.length - pendingCount} rows already done, ${pendingCount} to process\n`);
      }

      // Launch Chrome (or connect to existing)
      await this.chromeLauncher.launch();

      // Connect Playwright to Chrome
      console.log('🔗 Connecting Playwright to Chrome...');
      const debuggerUrl = await this.chromeLauncher.getDebuggerUrl();
      this.browser = await chromium.connectOverCDP(debuggerUrl);
      
      // Get contexts
      const contexts = this.browser.contexts();
      this.context = contexts[0];
      
      // Get or create page
      const pages = this.context.pages();
      if (pages.length > 0) {
        this.page = pages[0];
        console.log('✅ Using existing tab\n');
      } else {
        this.page = await this.context.newPage();
      }

      // Check login status via DOM
      console.log('🔍 Checking login status...');
      const isLoggedIn = await this.checkLoginStatus();
      if (!isLoggedIn) {
        console.log(`🔒 Not logged in for profile "${this.profile}"`);
        await this.closeAll();
        return { status: 'session_expired' };
      }
      console.log('✅ Logged in!\n');

      // Process each number (skip rows that already have valid phone_number_truecaller_status)
      let successful = 0;
      let failed = 0;
      let skipped = 0;
      let processedThisRun = 0; // counts rows actually processed in this run (not skips)

      for (let i = 0; i < processedData.length; i++) {
        const row = processedData[i];
        const phoneNumber = row.caller_id || row.number;

        if (!this.needsProcessing(row)) {
          skipped++;
          continue;
        }

        console.log('\n' + '='.repeat(60));
        console.log(`📱 NUMBER ${i + 1} of ${processedData.length}${skipped > 0 ? ` (${skipped} skipped - already done)` : ''}`);
        console.log('='.repeat(60));

        // Search
        const searchSuccess = await this.searchNumber(phoneNumber);

        if (!searchSuccess) {
          row.color = 'search_failed';
          row.is_likely_biz = '';
          row.name = '';
          row.phone_number_truecaller_status = '';
          row.processed_at = Utils.getFormattedDateTime();
          row.spam_check_profile = this.profile;
          this.logUpdatedRow(row);
          failed++;
          await this.writeData(processedData);
          continue;
        }

        // Extract result (color, is_likely_biz, name)
        const result = await this.extractResult(phoneNumber);

        if (result === null) {
          console.log('\n⛔ RATE LIMIT - Switching profile');
          row.color = 'rate_limited';
          row.is_likely_biz = '';
          row.name = '';
          row.phone_number_truecaller_status = '';
          row.processed_at = Utils.getFormattedDateTime();
          row.spam_check_profile = this.profile;
          this.logUpdatedRow(row);
          await this.writeData(processedData);
          await this.closeAll();
          return { status: 'rate_limited' };
        }

        if (result.color === 'error_extraction_failed') {
          console.log('\n⛔ EXTRACTION FAILED - Stopping (page structure may have changed)');
          row.color = 'error_extraction_failed';
          row.is_likely_biz = '';
          row.name = '';
          row.phone_number_truecaller_status = '';
          row.processed_at = Utils.getFormattedDateTime();
          row.spam_check_profile = this.profile;
          this.logUpdatedRow(row);
          await this.writeData(processedData);
          await this.closeAll();
          return { status: 'extraction_failed' };
        }

        row.color = Utils.formatColor(result.color);
        row.is_likely_biz = result.is_likely_biz;
        row.name = result.name;
        row.phone_number_truecaller_status = this.computeSpamStatus(phoneNumber, result.color, result.is_likely_biz, result.name);
        row.processed_at = Utils.getFormattedDateTime();
        row.spam_check_profile = this.profile;

        this.logUpdatedRow(row);

        if (!['error', 'no_color', 'no_color_in_div', 'error_extraction_failed'].includes(result.color)) {
          successful++;
        } else {
          failed++;
        }

        processedThisRun++;
        await this.writeData(processedData);

        // Stop if this profile has hit its max_spam_count limit
        if (this.maxCount !== null && processedThisRun >= this.maxCount) {
          console.log(`\n📊 Reached max_spam_count limit (${this.maxCount}) for profile "${this.profile}" — stopping.`);
          await this.closeAll();
          return { status: 'limit_reached' };
        }

        // Delay before next number
        if (i < processedData.length - 1) {
          console.log('\n⏸️  Taking a break before next number...');
          await Utils.sleep(
            config.delays.betweenNumbersMin,
            config.delays.betweenNumbersMax
          );
        }
      }

      // Disconnect Playwright and close Chrome
      await this.closeAll();

      // Summary
      console.log('\n' + '='.repeat(60));
      console.log('✅ PROCESSING COMPLETE');
      console.log('='.repeat(60));
      console.log(`📊 Total: ${processedData.length}`);
      if (skipped > 0) {
        console.log(`⏭️  Skipped (already done): ${skipped}`);
      }
      console.log(`✅ Success: ${successful}`);
      console.log(`❌ Failed: ${failed}`);
      const outputPath = this.source.type === 'csv' ? this.source.path : this.outputPath;
      console.log(`💾 Output: ${outputPath}`);
      console.log('='.repeat(60) + '\n');

      return { status: 'complete' };

    } catch (error) {
      console.log(`\n❌ ERROR: ${error.message}\n`);
      await this.closeAll();
      return { status: 'error' };
    }
  }
}

module.exports = TruecallerScraper;