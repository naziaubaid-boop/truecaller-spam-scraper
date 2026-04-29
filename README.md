# Truecaller Scraper & Unlister

Automates two things against a CSV of phone numbers:

1. **Spam Checker** — looks up each number on Truecaller and records its spam status (`red spam`, `name spam`, `likely a business`, `not spam`)
2. **Unlister** — submits an unlisting request on Truecaller for numbers flagged as `name spam`

Uses your real Google Chrome (separate profiles, no interference with your personal browser) controlled via Playwright over CDP.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js** v18+ | [nodejs.org](https://nodejs.org) — check with `node -v` |
| **Google Chrome** | Must be installed at the default path for your OS |
| **Truecaller account** | Required for spam checking only (not for unlisting) |

---

## Installation

```bash
# 1. Clone or copy the project folder
cd truecaller-scraper

# 2. Install dependencies
npm install
```

That's it. No build step.

---

## Project Structure

```
truecaller-scraper/
├── data/
│   └── numbers.csv          # Put your input CSVs here
├── chrome_profile/          # Chrome profile data (auto-created, gitignored)
├── profiles.json            # Registered Chrome profiles (auto-managed)
├── index.js                 # Entry point — spam checker
├── unlist.js                # Entry point — unlister
├── setup-profile.js         # Profile creation wizard
├── delete-profile.js        # Profile deletion tool
└── src/
    ├── scraper.js           # Core scraping logic
    ├── unlister.js          # Core unlisting logic
    ├── chrome-launcher.js   # Chrome launch / kill helper
    ├── config.js            # Paths, ports, delays
    └── utils.js             # Shared utilities
```

---

## Commands Reference

| Command | What it does |
|---|---|
| `npm run create-profile` | Add or re-login a Chrome profile (interactive wizard) |
| `npm run delete-profile` | Delete a profile and its Chrome data |
| `npm start` | Run spam checker using all logged-in profiles |
| `node index.js --profile=NAME` | Run spam checker pinned to one profile |
| `npm run unlist` | Run unlister using the `default` Chrome profile |
| `node unlist.js --profile=NAME` | Run unlister using a specific Chrome profile |

---

## Part 1 — Spam Checker

### Step 1: Create a Chrome profile

Each profile is a separate Chrome login. You need at least one to use the scraper.

```bash
npm run create-profile
```

The wizard will:
1. Ask for a name (e.g. `kishor`) and your last 4 phone digits → profile becomes `kishor_4321`
2. Open Chrome at `truecaller.com`
3. You log in manually (enter phone → approve in the Truecaller app)
4. You confirm → profile is saved to `profiles.json` as logged in

> **Chrome stays open** after setup. The script connects to it on the next run.

### Step 2: Prepare your CSV

Place your CSV in the `data/` folder. It must have a column containing phone numbers. Any of these column names are accepted:

| Column name | Notes |
|---|---|
| `caller_id` | Standard name used throughout the tool |
| `number` | Alias — treated the same as `caller_id` |
| `primary_number` | Alias — original column name is preserved in output |
| `raw_phone_number` | Alias — original column name is preserved in output |

Example with `primary_number`:
```
primary_number
+918047364643
+918047364646
+919876543210
```

**Column order is preserved.** Result columns (`phone_number_truecaller_status`, `color`, etc.) are appended after your original columns — your existing columns are never moved or renamed.

Country code prefix is stripped automatically before searching. Both formats are supported — with or without the leading `+`:

| CSV value | Searched as |
|---|---|
| `+917737851235` | `7737851235` |
| `917737851235` | `7737851235` |
| `7737851235` | `7737851235` |

> **LibreOffice note:** LibreOffice Calc strips the leading `+` when saving CSVs. This is handled automatically — numbers like `917737851235` are treated the same as `+917737851235`.

### Step 3: Run the scraper

```bash
npm start
```

- Lists all CSVs in `data/` — auto-picks if there's only one (5s countdown)
- Rotates through all logged-in profiles automatically
- If a profile hits the rate limit, switches to the next one
- Saves results after every row (safe to interrupt and re-run)
- Plays a sound when complete

**Pin to a specific profile:**
```bash
node index.js --profile=kishor_4321
```

### Output columns added to your CSV

| Column | Values | Description |
|---|---|---|
| `spam_status` | `red spam` / `name spam` / `likely a business` / `not spam` | Final classification |
| `color` | e.g. `red(#ff4130)` | Avatar color extracted from the result page |
| `is_likely_biz` | `true` / `false` | Whether Truecaller shows a "Likely a business" chip |
| `name` | string | Name shown on Truecaller result |
| `processed_at` | datetime | When this row was processed |
| `spam_check_profile` | profile name | Which Chrome profile ran this check |

### Spam status logic

| Avatar color | `is_likely_biz` | Name shows number? | Result |
|---|---|---|---|
| `#ff4130` (red) or `#119d62` (green) | any | any | `red spam` |
| `#0087ff` (blue) | yes | yes | `likely a business` |
| `#0087ff` (blue) | yes | no | `name spam` |
| `#0087ff` (blue) | no | yes | `not spam` |
| `#0087ff` (blue) | no | no | `name spam` |

### Re-running / resuming

Rows that already have a valid `spam_status` are skipped automatically. Just re-run `npm start` to pick up where you left off.

### Limiting rows per profile (`max_spam_count`)

You can cap how many rows each profile processes per run by adding `max_spam_count` to its entry in `profiles.json`. Edit the file manually:

```json
[
  { "name": "kishor_4321", "is_logged_in": true, "max_spam_count": 50 },
  { "name": "work_5678",   "is_logged_in": true, "max_spam_count": 0  },
  { "name": "backup_9999", "is_logged_in": true }
]
```

| `max_spam_count` value | Behaviour |
|---|---|
| absent / not set | No limit — runs until rate-limited or all rows done |
| `0` | Profile is skipped entirely |
| `50` | Stops after processing 50 rows, rotates to the next profile |

> Already-completed rows (with a valid `spam_status`) don't count toward the limit — only rows actually processed in the current run do.

---

## Part 2 — Unlister

Unlists numbers with `spam_status = name spam` from Truecaller's public unlisting page. **No Truecaller login required** — any Chrome profile works.

### Step 1: Run the spam checker first

The unlister only processes rows where `spam_status` is exactly `name spam`. Run the scraper first to populate that column.

### Step 2: Run the unlister

```bash
npm run unlist
```

Or with a specific Chrome profile (useful to avoid CAPTCHA bans):

```bash
node unlist.js --profile=fresh1
```

> If you pass a profile name that is **not** in `profiles.json` (a "fresh" profile), its Chrome data is automatically deleted after the run.

> **LibreOffice note:** If LibreOffice stripped the `+` from your numbers (e.g. `917737851235` instead of `+917737851235`), the unlister adds it back automatically before submitting.

### What it does per number

1. Opens `truecaller.com/unlisting`
2. Accepts cookie consent if present (first run on a fresh profile)
3. Clicks **"No, I want to unlist"**
4. Enters the phone number
5. Clicks the reCAPTCHA checkbox (auto-passes on clean IPs)
6. Answers **Q1:** "Do you still have access to this number?" → Yes
7. Answers **Q2:** "Are you able to send and receive SMS?" → Yes
8. Selects reason: "I don't want Truecaller to show my name"
9. Submits, reads the modal result, saves to CSV
10. Waits 10–15 seconds before the next number

### CAPTCHA handling

- Auto-pass is expected on clean residential IPs
- If CAPTCHA doesn't pass within 10s, an **alert sound plays** and you see:
  ```
  🧩 Possible image CAPTCHA — please solve it in the browser!
  ⏳ Waiting up to 60s for manual solve...
  ```
- Solve the image challenge manually in the Chrome window
- Script detects when it's done and continues automatically
- If not solved within 60s → script stops, Chrome is closed (and data deleted if it was a fresh profile)

### Output columns added to your CSV

| Column | Values | Description |
|---|---|---|
| `unlist_status` | `yes` / `no` / `failed` | `yes` = Truecaller confirmed "Unlisted" |
| `unlist_output` | string | The modal title shown (e.g. "Unlisted", "Already Unlisted") |
| `unlist_profile` | profile name | Which Chrome profile ran the unlisting |
| `unlisted_at` | datetime | When the unlisting was submitted |

### Re-running

Rows with `unlist_status = yes` or `no` are skipped on re-run. Only `failed` or empty rows are retried.

---

## Profile Management

### Multiple profiles (for spam checking)

Having multiple logged-in profiles lets the scraper keep going when one hits Truecaller's rate limit.

```bash
npm run create-profile   # run multiple times to add more profiles
npm start                # rotates through all logged-in profiles automatically
```

### Session expired

When a Truecaller session expires, the scraper marks that profile as logged out in `profiles.json` and moves to the next profile. Re-login with:

```bash
npm run create-profile   # select the same profile name to re-login
```

### Deleting a profile

```bash
npm run delete-profile
```

Shows two lists:
- **Profiles (profiles.json)** — registered profiles with login status
- **Raw profiles (chrome_profile/ only)** — leftover Chrome directories not in JSON (e.g. temporary unlister profiles)

Select a number to delete. This removes the entry from `profiles.json` and deletes the Chrome data directory.

---

## Tips

- **Fresh profiles for unlisting** — Truecaller's unlisting page uses reCAPTCHA. Using a new/fresh profile (not logged in to anything) on a clean IP gives the best auto-pass rate. Create them with any name not in `profiles.json`.
- **Cooldown** — The unlister waits 10–15s between numbers to avoid triggering rate limits.
- **Safe to interrupt** — Both the scraper and unlister save after every row. Press `Ctrl+C` to stop; just re-run to continue.
- **Chrome stays open** — The scraper launches Chrome detached. It keeps running after the Node script exits, and is reused on the next run. The unlister closes Chrome when done.
- **Multiple scripts at once** — Each profile uses a unique debug port (derived from the profile name), so you can run multiple profiles in parallel without conflicts.