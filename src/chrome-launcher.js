/**
 * Chrome Launcher Helper
 * Uses a separate Chrome profile so your main Chrome stays untouched.
 * Profile: --profile=NAME creates chrome_profile/NAME (separate login, tabs)
 */

const { spawn } = require('child_process');
const config = require('./config');
const Utils = require('./utils');
const fs = require('fs');

class ChromeLauncher {
  constructor(profile = 'default') {
    this.profile = profile;
    this.chromeProcess = null;
    this.isRunning = false;
    this.debugPort = config.getProfilePort(profile);
    this.userDataDir = config.getProfileUserDataDir(profile);
  }

  /**
   * Check if Chrome is already running on this profile's debug port
   */
  async isChromeRunning() {
    try {
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(`http://localhost:${this.debugPort}/json/version`, {
        timeout: 2000,
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Launch Chrome with remote debugging (separate profile - won't touch your main Chrome)
   */
  async launch() {
    const running = await this.isChromeRunning();
    if (running) {
      console.log(`✅ Chrome already running (profile: ${this.profile}, port: ${this.debugPort})\n`);
      this.isRunning = true;
      return true;
    }

    console.log(`🚀 Launching Chrome (profile: ${this.profile}) - your main Chrome stays open!\n`);

    Utils.ensureDir(this.userDataDir);

    const args = [
      `--remote-debugging-port=${this.debugPort}`,
      `--user-data-dir=${this.userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-popup-blocking',
      '--disable-notifications',
      '--password-store=basic', // use fixed key instead of macOS Keychain → profiles are portable across Macs
      config.truecallerUrl,
    ];

    this.chromeProcess = spawn(config.chrome.executablePath, args, {
      detached: true,
      stdio: 'ignore',
    });

    // Unref so it runs independently
    this.chromeProcess.unref();

    // Wait for Chrome to start
    console.log('⏳ Waiting for Chrome to start...');
    for (let i = 0; i < 30; i++) {
      await Utils.sleep(1000);
      if (await this.isChromeRunning()) {
        console.log('✅ Chrome is ready!\n');
        this.isRunning = true;
        return true;
      }
    }

    throw new Error('Failed to start Chrome');
  }

  /**
   * Kill the Chrome process for this profile (profile data is preserved)
   */
  async close() {
    if (!(await this.isChromeRunning())) return;

    console.log(`🔴 Closing Chrome (profile: ${this.profile})...`);
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    try {
      if (process.platform === 'win32') {
        await execAsync(
          `for /f "tokens=5" %a in ('netstat -aon ^| findstr :${this.debugPort}') do taskkill /pid %a /t /f`
        );
      } else {
        // -sTCP:LISTEN ensures we only get the process LISTENING on the port (Chrome),
        // not Node.js which has an established connection to it via Playwright/CDP
        await execAsync(`lsof -t -i:${this.debugPort} -sTCP:LISTEN | xargs kill 2>/dev/null; exit 0`);
      }
      await Utils.sleep(500);
      this.isRunning = false;
      console.log(`✅ Chrome closed (profile: ${this.profile})\n`);
    } catch (e) {
      // Already closed or error — ignore
    }
  }

  /**
   * Delete the Chrome profile data directory (call after close())
   */
  clearData() {
    if (fs.existsSync(this.userDataDir)) {
      fs.rmSync(this.userDataDir, { recursive: true, force: true });
      console.log(`🗑️  Cleared profile data: ${this.userDataDir}`);
    }
  }

  /**
   * Get WebSocket debugger URL
   */
  async getDebuggerUrl() {
    try {
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(`http://localhost:${this.debugPort}/json/version`);
      const data = await response.json();
      return data.webSocketDebuggerUrl;
    } catch (error) {
      throw new Error('Failed to get Chrome debugger URL');
    }
  }
}

module.exports = ChromeLauncher;