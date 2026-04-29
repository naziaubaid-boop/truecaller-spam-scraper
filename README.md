# 🚀 Truecaller Spam Scraper

An automated tool that checks phone numbers on Truecaller and identifies spam status using browser automation.

---

## 🔍 Problem Statement

Manually checking large sets of phone numbers on Truecaller is:

* Time-consuming
* Repetitive
* Not scalable

This tool automates the entire process.

---

## ⚙️ Features

* Bulk phone number processing
* Automated browser interaction using Playwright
* Handles input clearing & human-like typing
* Extracts:

  * Spam status
  * Name
  * Business flag
* Saves results to CSV
* Retry & delay handling to avoid detection

---

## 🛠️ Tech Stack

* Node.js
* Playwright
* JavaScript

---

## 📂 Project Structure

* `src/` → Core scraper logic
* `data/` → Input/output files
* `profiles.json` → Profile handling

---

## ▶️ How to Run

```
npm install
npm run start
```

---

## 📊 Output

Results are stored in:

```
data/number.csv
```

---

## 🚧 Improvements (Future Scope)

* CAPTCHA handling improvement
* Proxy rotation
* API-based approach (if available)
* Dashboard for results

---

## 👩‍💻 Author

Nazia Fatima
