/**
 * Configuration for Truecaller Scraper with Remote Chrome
 */

const path = require('path');
const os = require('os');

// Get default Chrome path based on OS
function getChromePath() {
  const platform = os.platform();
  
  if (platform === 'win32') {
    // Windows
    const paths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
    ];
    for (const p of paths) {
      if (require('fs').existsSync(p)) return p;
    }
  } else if (platform === 'darwin') {
    // macOS
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  } else {
    // Linux
    const paths = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    ];
    for (const p of paths) {
      if (require('fs').existsSync(p)) return p;
    }
  }
  
  return null;
}

/**
 * Get debug port for a profile (each profile gets unique port for multiple Chrome instances)
 */
function getProfilePort(profile) {
  const basePort = 9222;
  if (!profile || profile === 'default') return basePort;
  const hash = [...profile].reduce((s, c) => s + c.charCodeAt(0), 0) % 8;
  return basePort + hash;
}

function getProfileUserDataDir(profile) {
  const base = path.resolve(__dirname, '..', 'chrome_profile');
  return profile && profile !== 'default' ? path.join(base, profile) : base;
}

const config = {
  // Paths
  paths: {
    base: path.resolve(__dirname, '..'),
    input: path.resolve(__dirname, '..', 'data'),
    output: path.resolve(__dirname, '..', 'data', 'output'),
    logs: path.resolve(__dirname, '..', 'logs'),
    chromeProfileBase: path.resolve(__dirname, '..', 'chrome_profile'),
  },

  // Profile helpers (call with profile name from CLI)
  getProfilePort,
  getProfileUserDataDir,

  // Truecaller URL
  truecallerUrl: 'https://www.truecaller.com',

  // Chrome settings (default - override with profile)
  chrome: {
    executablePath: getChromePath(),
    debugPort: 9222,
  },

  // Browser settings
  browser: {
    headless: false,
    slowMo: 100,
  },

  // Human-like delays (in milliseconds)
  delays: {
    typingMin: 50,
    typingMax: 150,
    afterSearchMin: 3000,
    afterSearchMax: 5000,
    beforeExtractMin: 2000,
    beforeExtractMax: 4000,
    betweenNumbersMin: 3000,
    betweenNumbersMax: 7000,
    mouseMoveMin: 100,
    mouseMoveMax: 300,
    afterFillMin: 500,
    afterFillMax: 1500,
  },

  // Timeouts
  timeouts: {
    default: 30000,
    search: 10000,
    result: 15000,
  },
};

module.exports = config;