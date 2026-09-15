# Bulk Individual Email Sender for Gmail

A Manifest V3 browser extension built with the **Plasmo Framework** (React & TypeScript) that allows you to send personalized individual emails to multiple recipients directly through your active Gmail session via automated webmail compose.

Each recipient receives an individual 1-on-1 email (no CC or BCC exposure) with customized merge tags (e.g. `{{First Name}}`, `{{Company|there}}`).

---

## Key Features

- **Personalized Mail Merge**: Use dynamic tokens like `{{First Name}}`, `{{Company}}`, `{{Role}}` in the Subject line and Body.
- **Fallback Syntax**: Supports default values when fields are empty, e.g. `{{First Name|there}}` or `{{Company|your team}}`.
- **Flexible Contact Import (CSV or Direct Paste)**:
  - **CSV File Import**: Drag and drop CSV files with automatic delimiter detection (comma, semicolon, tab).
  - **Direct Paste Emails / Text**: Paste emails directly into the extension in any format:
    - Simple line-separated or comma/semicolon-separated list (`user1@gmail.com`, `user2@company.com`).
    - Formatted contacts with names (`John Doe <john@gmail.com>`).
    - Raw copied columns from Google Sheets or Excel.
    - Freeform text with embedded email addresses.
  - **Append Mode**: Choose to replace or append to your existing recipient list without losing previously added contacts.
- **Live Render Preview**: Step through recipients (`< 1 / 5 >`) to preview the exact evaluated subject and body for each person before sending.
- **Gmail Web Automation Engine**: Injects into `mail.google.com` to automate individual compose windows, recipient input, subject line, body rendering, and send confirmation.
- **Anti-Spam Throttling Controls**: Configurable delay (e.g. 5–15 seconds) with randomized jitter between sends to preserve Gmail account reputation and prevent rate limiting.
- **Real-Time Queue Management**: Live progress bar, Sent / Failed / Pending counters, activity logs, and pause / resume / stop controls.
- **Retry Failed**: One-click reset and retry for any recipients that encountered temporary errors.
- **Dual Interface**:
  - **Chrome Side Panel**: Fast, compact workflow docked right alongside Gmail.
  - **Full-Screen Dashboard**: Dedicated tab (`tabs/dashboard.html`) for searching, filtering, and exporting results to CSV.

---

## How to Install & Run in Chrome

### Option 1: Load the Built Extension (Production Build)

1. Open Google Chrome.
2. Navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle switch in the top-right corner).
4. Click **Load unpacked**.
5. Select the folder:
   ```
   /opt/homebrew/var/www/bulk-email-sender/build/chrome-mv3-prod
   ```
6. The extension **Bulk Individual Email Sender for Gmail** is now installed!

---

### Option 2: Live Development Mode (with Hot Reload)

To make changes and test with instant hot reloading:

```bash
cd /opt/homebrew/var/www/bulk-email-sender
npm run dev
```

Then in `chrome://extensions/`, click **Load unpacked** and select:
```
/opt/homebrew/var/www/bulk-email-sender/build/chrome-mv3-dev
```

---

## How to Use

1. **Open Gmail**: Navigate to [mail.google.com](https://mail.google.com/) and make sure you are signed in.
2. **Open the Side Panel**:
   - Click the extension icon in Chrome's toolbar, or click the Chrome Side Panel icon and choose **Mail Merge for Gmail**.
3. **Import Recipients**:
   - Drag & drop `sample-contacts.csv` (or your own CSV) into the **Recipients** tab, or click **Load Demo Contacts**.
   - Verify the detected Email column.
4. **Compose Template**:
   - Switch to **Compose & Preview**.
   - Enter your Subject and Body. Click any token chip (e.g. `+ {{First Name}}`) to insert it.
   - Use the `<` and `>` buttons in the **Live Render Preview** box to see how the email looks for each recipient.
5. **Queue & Send**:
   - Switch to **Queue & Send**.
   - Adjust the delay slider (default 5–12s).
   - Click **▶ Start Bulk Send**.
   - The extension will automatically open compose windows in Gmail, fill personalized content, send each email, and report live progress!
6. **Dashboard & Reports**:
   - Click **Full Tab ↗** to open the full dashboard where you can search recipients, inspect failures, and click **📥 Export Report (CSV)**.
