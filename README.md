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
- Total deleted counter
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

## Feature Details

### 1) In-Page Dashboard (HUD)

The script creates a fixed, dark panel in the top-left with:

- STOP AUTOMATION button
- Engine status text
- Total files purged counter
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
- Hard timeout ceiling of 20 minutes for a wait cycle

### 6) Layout Hydration / Discovery Movement

The script forces controlled scrolling and directional reversal near top/bottom boundaries to keep lazy-loaded content flowing into the DOM.

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

- MAX_BATCH (currently 50)
- HARD_MAX_TIMEOUT for sync wait (20 minutes)

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

- Script appears idle:
- It may be in sync wait mode or hydration wait mode; check status and terminal panel.

- Never starts deleting files or strange errors:
- Something may be full or corrupt in the Google Photos single page application.  To fix:
    1. In your browser's developer's tools, click "Application" -> "Clear site data".
    2. Use Clear Cache browser extension to clear the cache; or
    3. Reload the page.

## Disclaimer

Use at your own risk. You are responsible for what account and content this runs against. Always test with a small sample before long unattended runs.


