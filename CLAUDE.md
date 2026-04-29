# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start                        # Run with default Chrome profile
npm run start:k0385              # Run with "k0385" Chrome profile
npm run start:tcnew              # Run with "tcnew" Chrome profile
node index.js --profile=NAME     # Run with any named Chrome profile
npm run create-profile           # Add or re-login a Chrome profile
npm run delete-profile           # Delete a profile and its Chrome data
npm run unlist                   # Unlist "name spam" numbers from Truecaller
node unlist.js --profile=NAME    # Unlist using a specific Chrome profile
```

No build step or test suite exists. Running the script is interactive — it prompts for data source selection.

## Architecture

**Entry point:** `index.js` — parses `--profile=NAME` CLI arg, lists CSV files in `data/input/`, prompts user to select a data source (local CSV, custom path, or Google Sheets URL), then instantiates and runs `TruecallerScraper`.

**Core flow (`src/scraper.js` — `TruecallerScraper`):**
1. Reads data from CSV or Google Sheets
2. Launches (or connects to already-running) Chrome via `ChromeLauncher`
3. Connects Playwright to Chrome using CDP over the profile's debug port
4. Waits for user to log in to Truecaller manually (login is saved in Chrome profile)
5. For each unprocessed row: types the number, submits, extracts result, writes back to CSV
6. Saves results after every row (resilient to interruptions)

**Chrome profile isolation (`src/chrome-launcher.js` — `ChromeLauncher`):**
- Each named profile gets a deterministic debug port (base 9222 + hash offset 0–7)
- Profile data stored in `chrome_profile/NAME/` (gitignored)
- Chrome is launched detached (`unref()`), so it keeps running after the Node script exits
- If Chrome is already running on the profile's port, it connects to it instead of launching a new instance

**Spam status classification (`scraper.js` — `computeSpamStatus`):**
Derived from three signals extracted from the Truecaller result page:
- `color`: hex extracted from the circular profile avatar's `style` attribute
- `is_likely_biz`: presence of `details.search-warning` chip with "Likely a business" text
- `name`: whether it shows a real name or echoes back the phone number digits

| Color | `is_likely_biz` | Name shows number? | Result |
|---|---|---|---|
| `#ff4130` or `#119d62` | any | any | `red spam` |
| `#0087ff` | true | yes | `likely a business` |
| `#0087ff` | true | no | `name spam` |
| `#0087ff` | false | yes | `not spam` |
| `#0087ff` | false | no | `name spam` |

**Data sources and output:**
- **Local CSV** (`data/input/`): must have `caller_id` or `number` column; results written back in-place
- **Google Sheets**: sheet must be shared "Anyone with link can view"; data fetched via CSV export URL (no auth); results written to `data/output/`
- Rows with a valid `spam_status` (`red spam`, `name spam`, `likely a business`, `not spam`) are skipped on re-run

**Config (`src/config.js`):**
- All timing delays (human-like typing, between-number waits) are centralized here
- Chrome executable path is auto-detected per OS
- Profile port mapping: `default` → 9222, named profiles → 9222 + (sum of char codes % 8)

**Utilities (`src/utils.js`):**
- `cleanPhoneNumber`: strips country code prefix before searching. Handles both `+917737851235` and `917737851235` (LibreOffice removes the `+` when saving CSVs) — strips `+` if present, then strips the country code if length > 10.
- `preparePhoneForUnlisting`: ensures a `+` prefix for the unlisting page. If the number already has `+` it is returned as-is; otherwise `+` is prepended (e.g. `917737851235` → `+917737851235`).
- `nameMatchesNumber`: compares last 10 digits of name and phone number to detect "number echoed as name"
- `extractHexColor`: parses hex or rgb() from CSS style strings

## Key Selectors (may break if Truecaller updates UI)

- Profile avatar (color extraction): `div[data-astro-cid-vtzuftsq].relative.rounded-full.shadow-lg`
- Name: `div.flex-none.font-bold.break-all`
- Business chip: `details.search-warning`
- Search input (result page): `#phone-number`
- Search input (home page): `input[data-cy="TcSearchBar:input"]`, `form.search-bar--on-image input[type="tel"]`
