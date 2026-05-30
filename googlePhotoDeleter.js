/**
 * GOOGLE PHOTOS ULTIMATE-ROBUST DELETION SUITE (ANTI-ZOOM TERMINAL)
 * Logic: [Unlock] -> [Zoom] -> [Scan] -> [Select] -> [Submit] -> [Passive Sync Watch] -> [Normalized UI Shell]
 */

window.STOP_AUTOMATION = false;
const processedIds = new Set();
let totalDeleted = 0;

// Dynamic Backoff & UI Tracking States
let consecutiveServerFailures = 0;
let serverThrottledDelay = 0; 
let currentStatusText = "Initializing...";
let countdownIntervalTimer = null;
let globalSequenceId = 0;
let hydrationDirection = 1; // 1 = down, -1 = up

const CONFIG = {
    selectors: {
        checkbox: 'div[role="checkbox"], .ckGgle',
        deleteButton: 'button[aria-label*="Delete"], div[data-delete-origin] button, [data-delete-origin] button',
        photoLink: 'a[href*="./photo/"], div[role="gridcell"] a',
        zoomSlider: 'div[role="slider"][aria-orientation="vertical"]',
        scrollContainer: 'div[jsrenderer="EvS76e"], .S6caFf, div[jsmodel][jsdata], div[jsname="bN97Pc"]',
        lockedElements: 'c-wiz[aria-hidden="true"], [inert], .EE97S',
        textNodes: 'div, span, [role="status"], p, a'
    },
    delays: {
        postClick: 60,
        modalWait: 1500,
        scrollWait: 5000,      
        networkCooldown: 3000   
    },
    backoff: {
        baseUnit: 120000,       // 2 Minutes base cooldown unit
        maxCap: 900000          // 15 Minutes maximum sleep ceiling
    }
};

// TERMINAL INTERNALS PIPELINE
function writeToTerminal(message, hexColor = "#e8eaed", isBold = false) {
    const termBody = document.getElementById('hud-terminal-body');
    if (!termBody) {
        console.log(message);
        return;
    }

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const logLine = document.createElement('div');
    logLine.style = `margin-bottom: 3px; color: ${hexColor}; font-weight: ${isBold ? 'bold' : 'normal'}; font-family: monospace; font-size: 11px; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
    
    const timeSpan = document.createElement('span');
    timeSpan.style = "color: #5f6368; margin-right: 6px; font-variant-numeric: tabular-nums;";
    timeSpan.textContent = `[${timestamp}]`;
    
    const msgSpan = document.createElement('span');
    msgSpan.textContent = message;

    logLine.appendChild(timeSpan);
    logLine.appendChild(msgSpan);
    termBody.appendChild(logLine);

    termBody.scrollTop = termBody.scrollHeight;

    if (termBody.children.length > 200) termBody.firstChild.remove();
}

function applyZoomCompensation() {
    const container = document.getElementById('automation-dashboard-container');
    if (!container) return;

    const currentZoom = window.devicePixelRatio || 1;
    const inverseScale = 1 / currentZoom;

    container.style.transformOrigin = 'top left';
    container.style.transform = `scale(${inverseScale})`;
    container.style.top = `${15 * currentZoom}px`;
    container.style.left = `${15 * currentZoom}px`;
}

// INJECT INVARIANT SCROLLBAR STYLE SHEET (Neutralizes native giant triangle arrows)
function injectScrollbarSanitizer() {
    const styleId = 'hud-scrollbar-sanitizer';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        /* Enforce absolute pixel caps regardless of browser layout scale multipliers */
        .hud-scroll-area::-webkit-scrollbar {
            width: 8px !important;
            height: 8px !important;
        }
        /* Completely delete the native browser arrow boxes */
        .hud-scroll-area::-webkit-scrollbar-button,
        .hud-scroll-area::-webkit-scrollbar-button:start,
        .hud-scroll-area::-webkit-scrollbar-button:end {
            display: none !important;
            width: 0px !important;
            height: 0px !important;
        }
        .hud-scroll-area::-webkit-scrollbar-track {
            background: #171717 !important;
            border-radius: 4px !important;
        }
        .hud-scroll-area::-webkit-scrollbar-thumb {
            background: #3c4043 !important;
            border-radius: 4px !important;
            border: none !important;
        }
        .hud-scroll-area::-webkit-scrollbar-thumb:hover {
            background: #5f6368 !important;
        }
    `;
    document.head.appendChild(style);
}

// TRUSTED-DOM WIDE-PROFILE HUD ENGINE
function setupDashboardUI() {
    const existing = document.getElementById('automation-dashboard-container');
    if (existing) existing.remove();

    injectScrollbarSanitizer();

    // EXPANDED CHASSIS HULL (520px Width Block)
    const container = document.createElement('div');
    container.id = 'automation-dashboard-container';
    container.style = "position:fixed;top:15px;left:15px;z-index:100000;background:#202124;color:#e8eaed;padding:20px;width:520px;border-radius:12px;box-shadow: 0 12px 36px rgba(0,0,0,0.7);font-family:sans-serif;border:1px solid #3c4043;font-size:13px;line-height:1.4;transition: transform 0.1s ease-out;box-sizing:border-box;";

    // Stop Button
    const stopBtn = document.createElement('button');
    stopBtn.id = 'stop-automation-btn';
    stopBtn.textContent = "🛑 STOP AUTOMATION";
    stopBtn.style = "width:100%;background:#d93025;color:white;padding:12px;font-weight:bold;cursor:pointer;border:none;border-radius:6px;box-shadow: 0 2px 4px rgba(0,0,0,0.3);font-size:14px;margin-bottom:15px;";
    stopBtn.onclick = () => { 
        window.STOP_AUTOMATION = true; 
        updateStatus("Shutting Down...");
        writeToTerminal("🛑 Stop sequence pulled manually. Ending loops...", "#ff3333", true);
    };
    container.appendChild(stopBtn);

    // Live Metrics HUD Panel
    const hud = document.createElement('div');
    hud.style = "background:#292a2d;padding:12px;border-radius:8px;border:1px solid #5f6368;margin-bottom:15px;";
    
    const statusRow = document.createElement('div');
    statusRow.style = "margin-bottom:6px;";
    const statusLabel = document.createElement('strong');
    statusLabel.textContent = "Engine Status: ";
    const statusVal = document.createElement('span');
    statusVal.id = 'hud-status-text';
    statusVal.style = "color:#8ab4f8;font-weight:bold;";
    statusVal.textContent = "Initializing...";
    statusRow.appendChild(statusLabel);
    statusRow.appendChild(statusVal);
    hud.appendChild(statusRow);

    const counterRow = document.createElement('div');
    counterRow.style = "margin-bottom:6px;";
    const counterLabel = document.createElement('strong');
    counterLabel.textContent = "Total Files Purged: ";
    const counterVal = document.createElement('span');
    counterVal.id = 'hud-total-counter';
    counterVal.style = "color:#81c995;font-weight:bold;";
    counterVal.textContent = "0";
    counterRow.appendChild(counterLabel);
    counterRow.appendChild(counterVal);
    hud.appendChild(counterRow);

    const cooldownPanel = document.createElement('div');
    cooldownPanel.id = 'hud-cooldown-panel';
    cooldownPanel.style = "display:none;margin-top:8px;padding-top:8px;border-top:1px dashed #5f6368;color:#fcb714;";
    
    const intervalRow = document.createElement('div');
    const intervalLabel = document.createElement('strong');
    intervalLabel.textContent = "Cooldown Interval: ";
    const intervalVal = document.createElement('span');
    intervalVal.id = 'hud-total-cooldown';
    intervalVal.textContent = "0m 0s";
    intervalRow.appendChild(intervalLabel);
    intervalRow.appendChild(intervalVal);
    cooldownPanel.appendChild(intervalRow);

    const remainingRow = document.createElement('div');
    const remainingLabel = document.createElement('strong');
    remainingLabel.textContent = "Time Remaining: ";
    const remainingVal = document.createElement('span');
    remainingVal.id = 'hud-remaining-cooldown';
    remainingVal.style = "font-weight:bold;font-variant-numeric:tabular-nums;";
    remainingVal.textContent = "0m 0s";
    remainingRow.appendChild(remainingLabel);
    remainingRow.appendChild(remainingVal);
    cooldownPanel.appendChild(remainingRow);

    hud.appendChild(cooldownPanel);
    container.appendChild(hud);

    // Ledger Header Text
    const tableHeader = document.createElement('div');
    tableHeader.style = "font-weight:bold;margin-bottom:6px;color:#9aa0a6;text-transform:uppercase;font-size:11px;letter-spacing:0.5px;";
    tableHeader.textContent = "Live Batch Processing Ledger";
    container.appendChild(tableHeader);

    // Confined Scrollable Audit Table Box (Attached Sanitizer Class)
    const scrollBox = document.createElement('div');
    scrollBox.className = 'hud-scroll-area';
    scrollBox.style = "max-height:140px;overflow-y:auto;background:#171717;border-radius:6px;border:1px solid #3c4043;margin-bottom:15px;padding-right:2px;";
    
    const table = document.createElement('table');
    table.id = 'hud-audit-table';
    table.style = "width:100%;border-collapse:collapse;font-size:11px;text-align:left;table-layout:fixed;";
    
    const thead = document.createElement('thead');
    thead.style = "position:sticky;top:0;background:#303134;color:#9aa0a6;box-shadow:0 1px 0 #3c4043;z-index:1;";
    const headerRow = document.createElement('tr');
    
    const thId = document.createElement('th');
    thId.style = "padding:6px 8px;";
    thId.textContent = "File Identifier Reference";
    
    const thSub = document.createElement('th');
    thSub.style = "padding:6px 8px;width:80px;";
    thSub.textContent = "Submitted";
    
    const thStat = document.createElement('th');
    thStat.style = "padding:6px 8px;width:130px;"; // Increased width space for alignment sanity
    thStat.textContent = "Status";
    
    headerRow.appendChild(thId);
    headerRow.appendChild(thSub);
    headerRow.appendChild(thStat);
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    tbody.id = 'hud-audit-tbody';
    table.appendChild(tbody);
    scrollBox.appendChild(table);
    container.appendChild(scrollBox);

    // Micro-Terminal Console Output Area (Attached Sanitizer Class)
    const terminalHeader = document.createElement('div');
    terminalHeader.style = "font-weight:bold;margin-bottom:6px;color:#9aa0a6;text-transform:uppercase;font-size:11px;letter-spacing:0.5px;";
    terminalHeader.textContent = "System Console Output";
    container.appendChild(terminalHeader);

    const terminalShell = document.createElement('div');
    terminalShell.id = 'hud-terminal-body';
    terminalShell.className = 'hud-scroll-area';
    terminalShell.style = "height:120px;overflow-y:auto;background:#0c0c0d;border-radius:6px;border:1px solid #3c4043;padding:8px 10px;box-sizing:border-box;scroll-behavior:smooth;";
    container.appendChild(terminalShell);

    document.body.appendChild(container);

    applyZoomCompensation();
    window.removeEventListener('resize', applyZoomCompensation);
    window.addEventListener('resize', applyZoomCompensation);
}

// UI State Mutators
function updateStatus(status) {
    currentStatusText = status;
    const el = document.getElementById('hud-status-text');
    if (el) el.textContent = status;
}

function updatePurgeCount(count) {
    const el = document.getElementById('hud-total-counter');
    if (el) el.textContent = count;
}

function addLedgerRow(id, href, status) {
    const tbody = document.getElementById('hud-audit-tbody');
    if (!tbody) return;

    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const fileId = href.split('/').filter(Boolean).pop()?.substring(0, 22) || `Item #${id}`; // Expanded structural visibility string

    const row = document.createElement('tr');
    row.id = `ledger-row-${id}`;
    row.style = "border-bottom:1px solid #292a2d;color:#e8eaed;height:26px;"; 
    
    const tdId = document.createElement('td');
    tdId.style = "padding:4px 8px;font-family:monospace;color:#9aa0a6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    tdId.title = href;
    tdId.textContent = fileId;
    
    const tdTime = document.createElement('td');
    tdTime.style = "padding:4px 8px;color:#9aa0a6;font-variant-numeric:tabular-nums;";
    tdTime.textContent = timeString;
    
    const tdStatus = document.createElement('td');
    tdStatus.id = `ledger-status-${id}`;
    tdStatus.style = "padding:4px 8px;font-weight:bold;color:#fcb714;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    tdStatus.textContent = status;

    row.appendChild(tdId);
    row.appendChild(tdTime);
    row.appendChild(tdStatus);
    
    tbody.insertBefore(row, tbody.firstChild); 
    if (tbody.children.length > 100) tbody.lastChild.remove(); 
}

function updateLedgerRowStatus(id, newStatus, colorHex) {
    const cell = document.getElementById(`ledger-status-${id}`);
    if (cell) {
        cell.textContent = newStatus;
        cell.style.color = colorHex;
    }
}

function startVisualCountdown(durationMs) {
    clearInterval(countdownIntervalTimer);
    const panel = document.getElementById('hud-cooldown-panel');
    const totalEl = document.getElementById('hud-total-cooldown');
    const remainEl = document.getElementById('hud-remaining-cooldown');
    if (!panel || !totalEl || !remainEl) return;

    panel.style.display = 'block';
    
    const formatTime = (ms) => {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${minutes}m ${seconds}s`;
    };

    totalEl.textContent = formatTime(durationMs);
    const targetWakeTime = Date.now() + durationMs;

    countdownIntervalTimer = setInterval(() => {
        const remaining = Math.max(0, targetWakeTime - Date.now());
        remainEl.textContent = formatTime(remaining);
        
        if (remaining <= 0) {
            clearInterval(countdownIntervalTimer);
            panel.style.display = 'none';
        }
    }, 250);
}

// 2. PASSIVE RUNTIME UNHANDLED EXCEPTION SHIELD
window.addEventListener('unhandledrejection', (event) => {
    if (event.reason && (String(event.reason).includes('RpcError') || String(event.reason).includes('CUIERROR'))) {
        writeToTerminal("🛡️ Thread Shield: Parallel execution worker crash neutralized safely.", "#9aa0a6");
        event.preventDefault(); 
    }
});

const originalFetch = window.fetch;
window.fetch = async (...args) => {
    try {
        const response = await originalFetch(...args);
        if (!response.ok && (response.status === 504 || response.status === 429 || response.status === 503 || response.status >= 500)) {
            if (serverThrottledDelay === 0) {
                triggerServerLockdown(`HTTP Status ${response.status}`);
            }
        }
        return response;
    } catch (networkError) {
        if (serverThrottledDelay === 0) {
            triggerServerLockdown("Network Dropout Exception");
        }
        throw networkError;
    }
};

function triggerServerLockdown(statusType) {
    consecutiveServerFailures++;
    const calculatedSleep = Math.min(CONFIG.backoff.baseUnit * Math.pow(2, consecutiveServerFailures - 1), CONFIG.backoff.maxCap);
    serverThrottledDelay = calculatedSleep;
    
    writeToTerminal(`⚠️ PASSIVE MONITOR DETECTED SERVER STRAIN (${statusType})`, "#ff3333", true);
}

// 3. CORE AUTOMATION WORKFLOWS
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function unlockDOM() {
    const locked = document.querySelectorAll(CONFIG.selectors.lockedElements);
    locked.forEach(el => {
        el.removeAttribute('aria-hidden');
        el.removeAttribute('inert');
        el.style.pointerEvents = 'auto';
        el.style.visibility = 'visible';
    });
}

function forceDeselectAllCurrent() {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.querySelectorAll(CONFIG.selectors.checkbox).forEach(cb => {
        if (cb.getAttribute('aria-checked') === 'true') cb.click();
    });
}

async function optimizeZoom() {
    const slider = document.querySelector(CONFIG.selectors.zoomSlider);
    if (slider) {
        slider.focus();
        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
        await sleep(1500);
    }
}

async function waitForAsyncMovementToComplete(batchTrackingIds) {
    updateStatus("Syncing with Cloud...");
    const initialBreather = Math.max(3000, batchTrackingIds.length * 150);
    writeToTerminal(`[Sync] Relinquishing pipeline execution for ${(initialBreather / 1000).toFixed(1)}s to let handoff complete...`, "#8ab4f8");
    await sleep(initialBreather);

    const startTime = Date.now();
    const HARD_MAX_TIMEOUT = 1200000; 
    let consecutiveClearScans = 0;

    while (Date.now() - startTime < HARD_MAX_TIMEOUT) {
        if (window.STOP_AUTOMATION) break;

        if (serverThrottledDelay > 0) {
            writeToTerminal("[Sync] Network drop triggered backend lock. Evacuating synchronization wait gate.", "#fcb714");
            batchTrackingIds.forEach(id => updateLedgerRowStatus(id, "Timeout Severed", "#ff3333"));
            return;
        }

        const textFoundOnPage = Array.from(document.querySelectorAll(CONFIG.selectors.textNodes))
            .some(el => {
                if (!el) return false;
                const content = el.textContent || "";
                return content.includes("Moving") && (content.includes("trash") || content.includes("Trash"));
            });

        if (textFoundOnPage) {
            consecutiveClearScans = 0; 
            const elapsedMinutes = ((Date.now() - startTime) / 60000).toFixed(1);
            updateStatus(`Syncing (${elapsedMinutes}m)...`);
            await sleep(4000); 
        } else {
            consecutiveClearScans++;
            if (consecutiveClearScans >= 3) {
                writeToTerminal("[Sync] Core cloud transaction tracking layers verified clean.", "#8ab4f8");
                await sleep(1500); 
                return;
            }
            await sleep(2500); 
        }
    }
    if (Date.now() - startTime >= HARD_MAX_TIMEOUT) {
        writeToTerminal("🛑 Timeout limit breached while awaiting transaction stack fulfillment.", "#ff3333", true);
        batchTrackingIds.forEach(id => updateLedgerRowStatus(id, "Ceiling Broken", "#ff3333"));
    }
}

async function forceHydrate() {
    updateStatus("Hydrating Layout...");
    writeToTerminal("[Nav] Realignment of active layout viewport window tracking...", "#9aa0a6");
    const scroller = document.querySelector(CONFIG.selectors.scrollContainer) || window;
    const photos = document.querySelectorAll(CONFIG.selectors.photoLink);
    
    if (photos.length > 0) {
        const lastPhoto = photos[photos.length - 1];
        lastPhoto.focus();
        lastPhoto.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    }
    
    const target = (scroller === window) ? document.body : scroller;

    if (scroller !== window) {
        const nearBottom =
            scroller.scrollTop + scroller.clientHeight >=
            scroller.scrollHeight - 100;

        const nearTop =
            scroller.scrollTop <= 100;

        if (nearBottom) hydrationDirection = -1;
        if (nearTop) hydrationDirection = 1;
    }

    const delta = 2500 * hydrationDirection;

    target.dispatchEvent(
        new WheelEvent('wheel', {
            deltaY: delta,
            bubbles: true
        })
    );

    if (scroller.scrollBy) {
        scroller.scrollBy(0, delta);
    }
    
    await sleep(CONFIG.delays.scrollWait);
}

// 4. MAIN PROGRAM MANAGEMENT ENGINE EXECUTION LOOP
async function start() {
    window.STOP_AUTOMATION = false;
    serverThrottledDelay = 0;
    consecutiveServerFailures = 0;
    globalSequenceId = 0;

    setupDashboardUI();
    writeToTerminal("🚀 Initializing Wide-Chassis Normalized Automation System...", "#8ab4f8", true);
    updateStatus("Configuring Viewport...");
    await optimizeZoom();
    forceDeselectAllCurrent(); 

    while (!window.STOP_AUTOMATION) {
        try {
            if (serverThrottledDelay > 0) {
                updateStatus("Cooling Down Server...");
                writeToTerminal(`[Lockdown] Halting operations for ${(serverThrottledDelay / 1000).toFixed(0)}s to let cluster recover...`, "#fcb714", true);
                startVisualCountdown(serverThrottledDelay);
                
                await sleep(serverThrottledDelay); 
                
                writeToTerminal("[Lockdown] Cooling window elapsed. Recovering processing loop...", "#81c995");
                serverThrottledDelay = 0; 
                forceDeselectAllCurrent(); 
                continue; 
            }

            unlockDOM();
            updateStatus("Selecting Targets...");

            const available = Array.from(document.querySelectorAll(CONFIG.selectors.photoLink))
                .filter(link => !processedIds.has(link.href));

            if (available.length === 0) {
                updateStatus("Searching Elements...");
                await forceHydrate();
                continue;
            }

            const randomizedAvailable = available.sort(() => 0.5 - Math.random());
            let batch = [];
            let batchTrackingIds = [];
            const MAX_BATCH = 50; 
            
            writeToTerminal(`[Batch] Aggregating ${MAX_BATCH} random photo target matrices...`, "#9aa0a6");

            for (const link of randomizedAvailable.slice(0, MAX_BATCH)) {
                if (window.STOP_AUTOMATION) break;
                
                const cb = link.querySelector(CONFIG.selectors.checkbox) || link.parentElement.querySelector(CONFIG.selectors.checkbox);
                if (cb && cb.getAttribute('aria-checked') !== 'true') {
                    if (link.style) link.style.pointerEvents = 'auto';
                    if (cb.style) cb.style.pointerEvents = 'auto';
                    
                    cb.click();
                    await sleep(CONFIG.delays.postClick);
                    
                    if (cb.getAttribute('aria-checked') === 'true' || cb.classList.contains('R9S78b')) {
                        processedIds.add(link.href); 
                        batch.push(link);
                        
                        globalSequenceId++;
                        batchTrackingIds.push(globalSequenceId);
                        addLedgerRow(globalSequenceId, link.href, "Selected");
                    }
                }
            }

            if (batch.length > 0 && !window.STOP_AUTOMATION) {
                const delBtn = document.querySelector(CONFIG.selectors.deleteButton);
                if (delBtn && delBtn.offsetParent !== null) {
                    delBtn.click();
                    await sleep(CONFIG.delays.modalWait);
                    
                    const confBtn = Array.from(document.querySelectorAll('button'))
                        .find(b => (b.textContent.includes('Move to trash') || b.textContent.includes('Delete')) && b.offsetParent !== null);

                    if (confBtn) {
                        batchTrackingIds.forEach(id => updateLedgerRowStatus(id, "Submitted", "#fcb714"));
                        updateStatus("Executing Deletion...");
                        
                        writeToTerminal(`📡 Dispatched batch request payload for ${batch.length} files...`, "#fcb714");
                        confBtn.click();
                        
                        await waitForAsyncMovementToComplete(batchTrackingIds);
                        
                        if (serverThrottledDelay === 0) {
                            if (consecutiveServerFailures > 0) consecutiveServerFailures--;
                            totalDeleted += batch.length;
                            
                            updatePurgeCount(totalDeleted);
                            batchTrackingIds.forEach(id => updateLedgerRowStatus(id, "Purged Clean", "#81c995"));
                            writeToTerminal(`✅ Success verification logged. Total Cumulative Purged: ${totalDeleted}`, "#81c995", true);
                            
                            await sleep(CONFIG.delays.networkCooldown);
                        }
                    }
                } else {
                    writeToTerminal("⚠️ Interface selection tracking lost context. Clearing layouts.", "#fcb714");
                    batchTrackingIds.forEach(id => updateLedgerRowStatus(id, "Context Split", "#ff3333"));
                    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                    await sleep(2000);
                }
            }

            await forceHydrate();

        } catch (err) {
            writeToTerminal(`⚠️ Pipeline Exception Handled: ${err.message}`, "#ff3333");
            await sleep(3000);
        } finally {
            if (window.STOP_AUTOMATION) {
                forceDeselectAllCurrent();
            }
        }
    }
    
    clearInterval(countdownIntervalTimer);
    window.removeEventListener('resize', applyZoomCompensation);
    updateStatus("Terminated.");
    writeToTerminal(`🏁 Engine halted cleanly. Session run summary: ${totalDeleted} deleted files.`, "#81c995", true);
}

start();