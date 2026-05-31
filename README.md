## Google Photos Robust Bulk Deleter

A browser-console JavaScript automation script designed to repeatedly select photos in Google Photos and move them to trash in resilient, throttle-aware batches.

This project exists because deleting a large library manually in the Google Photos UI can be painfully slow and unreliable. The script focuses on surviving transient UI glitches, backend throttling, and long-running sync behavior while giving you a live status dashboard.

## Backstory

This tool came out of a very real migration and account-cleanup frustration:

- Long-time Picasa workflows were disrupted after product and API changes.
- Even after moving away from Google Photos, account storage pressure remained.
- Existing scripts and extensions were often brittle or failed entirely.
- Manual deletion guidance from support was not practical for large libraries.

So this script was built and iterated specifically to keep working in hostile real-world conditions: flaky UI state, network/server errors, and very large delete jobs.

## What This Script Does

- Injects an on-page control dashboard (HUD) with:
- Live engine status
- Total deleted counter with discovered total estimate (shows `(est)` when heuristic)
- Sync controls (`Never wait` toggle and per-cycle skip button)
- Cooldown panel with countdown timer
- Batch audit ledger (selected/submitted/result)
- Scrollable terminal-style event log
- Adds a one-click emergency stop button.
- Continuously scans for photos not yet processed.
- Randomizes candidate selection to reduce repeated local-pattern misses.
- Selects up to 50 photos per batch.
- Clicks delete, confirms in modal, then waits for Google Photos movement/sync activity to settle.
- Tracks per-item status transitions in a ledger.
- Applies passive server-throttle detection by monitoring fetch failures and HTTP 429/5xx responses.
- Applies exponential cooldown backoff when strain is detected.
- Recovers automatically after cooldown and continues.
- Periodically re-hydrates the viewport (scroll/navigation nudges) to force lazy-loaded content to appear.
- Removes certain UI lock attributes (aria-hidden/inert) that can block interaction.
- Requests a Screen Wake Lock so the computer does not fall asleep during long unattended runs.
- Uses active-run tokens so re-pasting the script supersedes and stops the previous run.

## Feature Details

### 1) In-Page Dashboard (HUD)

The script creates a fixed, dark panel in the top-left with:

- STOP AUTOMATION button
- Engine status text
- Total files purged counter (for example: `150 / 2012 (est)`)
- Sync wait controls (`Never wait` and dynamic `Skip N Moving Statements`)
- Cooldown interval + remaining time
- Live batch ledger (most recent first)
- Console log feed with timestamps

The HUD is zoom-compensated so it remains usable when browser/device zoom changes.

### 2) Passive Error and Throttle Shield

- Adds an unhandled promise rejection guard for noisy runtime worker errors.
- Wraps window.fetch to detect server/network stress:
- HTTP 429, 503, 504, and other 5xx responses
- Network drop exceptions
- Triggers cooldown lock when server strain is detected.

### 3) Exponential Backoff Cooldowns

- Base cooldown: 2 minutes
- Exponential growth per consecutive failure
- Max cooldown cap: 15 minutes
- Visual countdown in HUD while paused

### 4) Batch Selection and Deletion Pipeline

Per loop cycle:

- Unlock blocked DOM regions (where possible)
- Gather unprocessed photo links
- Randomize pool, take up to 50 targets
- Toggle checkboxes with short inter-click delay
- Submit delete and confirm in modal
- Wait for async movement to trash
- Mark each ledger row status
- Increase global deleted count on success

### 5) Sync Wait Gate

After submit, the script waits for ongoing movement indicators to clear before continuing.

- Watches page text for moving-to-trash messages
- Requires multiple clean scans before declaring sync complete
- Lets you bypass the current wait cycle with a skip button
- Lets you disable waits for future cycles using `Never wait`
- Hard timeout ceiling of 20 minutes for a wait cycle

### 6) Run Isolation (Safe Re-paste Behavior)

The script uses run tokens on `window` so only the newest pasted run remains active.

- A newly pasted run marks the previous run for stop.
- Sleep/wait paths are abort-aware, so old loops unwind quickly.
- Manual stop targets the active run token instead of relying only on a global boolean.

### 7) Layout Hydration / Discovery Movement

The script forces controlled scrolling and directional reversal near top/bottom boundaries to keep lazy-loaded content flowing into the DOM.

### 8) Screen Wake Lock

The script requests a Screen Wake Lock via the standard W3C `navigator.wakeLock` API (available in Chrome 84+). This prevents the operating system from sleeping the display during long unattended runs — no separate utility or YouTube video required.

- The lock is acquired at startup and released cleanly when you click STOP AUTOMATION.
- If the browser auto-releases the lock because the tab becomes hidden (e.g., you minimize the window), the script detects this and re-acquires the lock automatically when the tab becomes visible again.
- If the API is unavailable (older browser, or a plain HTTP page), a warning is logged to the HUD terminal and the script continues without it.

Note: the lock is tied to the tab being *visible*, not just open. Switching to another browser window is fine. Minimizing the Google Photos window will release the lock until you restore it.

### 9) Server Strain Detection Scope (Important)

The passive strain monitor currently wraps `window.fetch` in the page context.

- It does react to failed fetch responses such as 429/503/504 and other 5xx.
- It does trigger exponential cooldown when those responses are seen through that fetch path.
- It may not see every failing request visible in DevTools (for example, some worker/XHR/internal traffic).

Google Photos likely has its own internal retry and recovery behavior. That behavior is opaque and may change, so this script treats Google-side recovery as best effort and still applies conservative backoff on signals it can observe.

## Safety, Behavior, and Limits

Important:

- This moves items to trash, it does not permanently delete from trash.
- Run only while viewing the intended Google Photos scope (for example, main photos view).
- Google UI structure can change; selectors may need periodic updates.
- Browser automation in DevTools console is inherently best-effort and may break with major UI rollouts.
- Keep the tab active and avoid manual interactions while running, unless stopping.

Recommended:

- Start with a small run to validate behavior on your account first.
- Monitor the HUD and stop button availability.
- Verify trash contents afterward.

## How to Run

### Prerequisites

- Desktop browser with Google Photos open and fully loaded
- Signed into the account you intend to clean up
- Access to browser DevTools Console

### Steps

1. Open Google Photos in your browser.
2. Open DevTools Console.
3. Paste the full contents of googlePhotoDeleter.js.
    - Your Google Chrome will give you a warning and require confirmation from you to allow pasting and executing scripts while viewing Google's page.
4. Press Enter to start.
5. Watch the HUD for status, cooldowns, and progress.
6. Click STOP AUTOMATION in the HUD to halt safely.

## Configuration Knobs (In Script)

The CONFIG object exposes the main tuning points:

- selectors:
- checkbox
- deleteButton
- photoLink
- zoomSlider
- scrollContainer
- lockedElements
- textNodes

- delays:
- postClick
- modalWait
- scrollWait
- networkCooldown

- backoff:
- baseUnit
- maxCap

Also notable runtime state:

- `CONFIG.batch.maxSize` (currently 50)
- Sync wait hard timeout (20 minutes)
- `syncNeverWait` and per-cycle `syncSkipRequested` (controlled from HUD)
- Run tokens for active/superseded stop behavior

## Status Labels You May See

- Selected
- Submitted
- Purged Clean
- Timeout Severed
- Ceiling Broken
- Context Split

These are per-item ledger states and help diagnose what happened during each batch.

## Troubleshooting

- No items selected:
- Ensure you are in a photo grid view.
- Scroll manually once, then let script continue.

- Delete button not found:
- UI language or layout may differ; update selector expressions.

- Repeated cooldowns:
- Backend is likely throttling. Let it recover; the script will resume.

- You can see 504 in DevTools, but no cooldown message appears:
- The request may not have passed through this script's wrapped `window.fetch` path.
- Google Photos may be retrying internally before your automation path sees a strain signal.
- Treat this as a visibility limitation, not proof that backoff was removed.

- Script appears idle:
- It may be in sync wait mode or hydration wait mode; check status and terminal panel.

- Wake lock warning appears in the HUD terminal:
- Your browser does not support the Screen Wake Lock API, or the page is served over plain HTTP instead of HTTPS. Use a current version of Chrome and ensure the page URL begins with `https://`. As a fallback, keep a video playing in another tab to prevent system sleep.

- Sync wait stays above about 2 minutes for multiple batches (especially after batch 1), or
- The script never starts deleting, or
- You see repeated strange UI/runtime errors.
- Likely cause:
- Google Photos site data or cache is stale/corrupted, and the single-page app is in a bad state.
- To fix:
    1. Open DevTools, go to Application, then click Clear site data.
    2. Reload Google Photos with a hard refresh.
    3. If issues continue, clear browser cache for photos.google.com (or use your cache extension), then reload again.
    4. Restart the script.
- Note:
- The first sync cycle can be slower than later cycles. Treat it as a problem only if the delay repeats across multiple batches.

## Disclaimer

Use at your own risk. You are responsible for what account and content this runs against. Always test with a small sample before long unattended runs.


