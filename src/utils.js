/**
 * Simple Utility Functions
 */

const fs = require('fs');

class Utils {
  /**
   * Get random delay between min and max
   */
  static randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Sleep with random delay
   */
  static async sleep(min, max = null) {
    const delay = max ? this.randomDelay(min, max) : min;
    console.log(`   ⏱️  Waiting ${(delay / 1000).toFixed(1)}s...`);
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Ensure directory exists
   */
  static ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Get timestamp for filenames
   */
  static getTimestamp() {
    const now = new Date();
    return now.toISOString()
      .replace(/[-:]/g, '')
      .split('.')[0]
      .replace('T', '_');
  }

  /**
   * Get formatted datetime for CSV
   */
  static getFormattedDateTime() {
    const now = new Date();
    return now.toISOString()
      .replace('T', ' ')
      .substring(0, 19);
  }

  /**
   * Clean phone number - FIXED VERSION
   * Removes country code prefix like +91, +1, etc.
   * Keeps only the actual phone number digits
   */
  static cleanPhoneNumber(phoneNumber) {
    // Remove spaces
    let cleaned = phoneNumber.replace(/\s+/g, '').trim();

    // Strip leading + if present (LibreOffice often removes it, so we handle both cases below)
    if (cleaned.startsWith('+')) {
      cleaned = cleaned.substring(1);
    }

    // Strip country code prefix when number is longer than 10 digits.
    // Handles +91.../91... (India), +1.../1... (US/Canada), and other 1-3 digit codes.
    if (cleaned.length > 10) {
      if (cleaned.startsWith('91') && cleaned.length - 2 >= 10) {
        cleaned = cleaned.substring(2);
      } else if (cleaned.startsWith('1') && cleaned.length - 1 >= 10) {
        cleaned = cleaned.substring(1);
      } else if (cleaned.length - 2 >= 10) {
        // Generic: assume 2-digit country code
        cleaned = cleaned.substring(2);
      } else {
        cleaned = cleaned.substring(1);
      }
    }

    return cleaned;
  }

  /**
   * Ensure phone number has a + prefix for use on the unlisting page.
   * LibreOffice strips the leading + when saving CSVs, so 917737851235 → +917737851235.
   * Numbers that already have + are returned unchanged.
   */
  static preparePhoneForUnlisting(phoneNumber) {
    const cleaned = phoneNumber.replace(/\s+/g, '').trim();
    return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  }

  /**
   * Format a color value for CSV storage: "name(hex)" for known colors, raw value otherwise.
   * e.g. "#ff4130" → "red(#ff4130)", "no_color_in_div" → "no_color_in_div"
   */
  static formatColor(color) {
    const colorNames = {
      '#ff4130': 'red',
      '#119d62': 'green',
      '#0087ff': 'blue',
    };
    const name = colorNames[(color || '').toLowerCase()];
    return name ? `${name}(${color})` : (color || '');
  }

  /**
   * Extract hex color from style string
   */
  static extractHexColor(styleString) {
    if (!styleString) return null;
    
    // Match hex colors (#RRGGBB or #RGB)
    const hexMatch = styleString.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/);
    if (hexMatch) {
      return hexMatch[0].toLowerCase();
    }

    // Match rgb colors and convert to hex
    const rgbMatch = styleString.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1]);
      const g = parseInt(rgbMatch[2]);
      const b = parseInt(rgbMatch[3]);
      return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    }

    return null;
  }

  /**
   * Get last 10 digits from a string (phone number or name that might contain number)
   */
  static getLast10Digits(str) {
    if (!str) return '';
    const digits = str.replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : digits;
  }

  /**
   * Check if name displays the phone number (compare last 10 digits)
   */
  static nameMatchesNumber(phoneNumber, name) {
    if (!name || !phoneNumber) return false;
    const searchLast10 = this.getLast10Digits(phoneNumber);
    const nameLast10 = this.getLast10Digits(name);
    return searchLast10 && nameLast10 && searchLast10 === nameLast10;
  }

  /**
   * List CSV files in directory
   */
  static listCsvFiles(dirPath) {
    if (!fs.existsSync(dirPath)) {
      return [];
    }
    return fs.readdirSync(dirPath).filter(file => file.endsWith('.csv'));
  }
}

module.exports = Utils;