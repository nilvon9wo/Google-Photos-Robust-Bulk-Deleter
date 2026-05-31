window.STOP_AUTOMATION = false;

const processedPhotoUrls = new Set();
let consecutiveServerFailures = 0;
let countdownIntervalTimer = null;
let currentStatusText = "Initializing...";
let deltaY = 2500;
let globalSequenceId = 0;
let syncSkipRequested = false;
let syncNeverWait = false;
let serverThrottledDelay = 0;
let totalDeleted = 0;
let wakeLockSentinel = null;

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
        baseUnit: 120000,
        maxCap: 900000
    },
    batch: {
        maxSize: 50
    }
};

const sleep = (ms) => new Promise((resolve) => 
    setTimeout(resolve, ms));

const ACTIVE_RUN_TOKEN = `gprbd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
window.__GPRBD_ACTIVE_RUN_TOKEN = ACTIVE_RUN_TOKEN;

function shouldAbortRun() {
    const supersededByNewerRun = window.__GPRBD_ACTIVE_RUN_TOKEN !== ACTIVE_RUN_TOKEN;
    return window.STOP_AUTOMATION || supersededByNewerRun;
}

async function start() {
    await initializeRun();
    while (!shouldAbortRun()) {
        try {
            await processSingleCycle();
        } catch (error) {
            writeToTerminal(`⚠️ Pipeline Exception Handled: ${error.message}`, '#ff3333');
            await sleep(3000);            
        } finally {
            if (shouldAbortRun()) {
                forceDeselectAllCurrent();
            }
        }
    }
    cleanupAfterStop();
}

async function initializeRun() {
    resetRunState();
    setupDashboardUI();
    writeToTerminal('🚀 Initializing Wide-Chassis Normalized Automation System...', '#8ab4f8', true);
    updateStatus('Configuring Viewport...');
    await optimizeZoom();
    forceDeselectAllCurrent();
    await acquireWakeLock();
    installVisibilityChangeHandler();
}

async function acquireWakeLock() {
    if (!wakeLockIsSupported()) {
        writeToTerminal('⚠️ Wake Lock API unavailable — computer may sleep during long runs.', '#fcb714');
        return;
    }

    try {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        wakeLockSentinel.addEventListener('release', onWakeLockReleased);
        writeToTerminal('☀️ Wake lock acquired. Computer will stay awake.', '#81c995');
    } catch (err) {
        writeToTerminal(`⚠️ Wake lock request failed: ${err.message}`, '#fcb714');
    }
}

function wakeLockIsSupported() {
    return 'wakeLock' in navigator;
}

function onWakeLockReleased() {
    wakeLockSentinel = null;
    writeToTerminal('⚠️ Wake lock released (tab hidden). Will re-acquire when visible.', '#fcb714');
}

function installVisibilityChangeHandler() {
    document.addEventListener('visibilitychange', onPageVisibilityChanged);
}

async function onPageVisibilityChanged() {
    const isVisible = document.visibilityState === 'visible';
    const isRunning = !shouldAbortRun();
    const needsWakeLock = !wakeLockSentinel;

    if (isVisible && isRunning && needsWakeLock) {
        await acquireWakeLock();
    }
}

async function processSingleCycle() {
    if (await processCooldownIfRequired()) {
        return;
    }

    unlockDOM();
    updateStatus('Selecting Targets...');
    const availableLinks = getAvailablePhotoLinks();

    if (availableLinks.length === 0) {
        await handleNoAvailableTargets();
        return;
    }

    const candidates = chooseBatchCandidates(availableLinks);
    const selection = await selectBatchLinks(candidates);
    await processDeletionIfBatchSelected(selection);
    await forceHydrate();
}

async function processCooldownIfRequired() {
    if (serverThrottledDelay <= 0) {
        return false;
    }

    updateStatus('Cooling Down Server...');
    const cooldownSeconds = (serverThrottledDelay / 1000).toFixed(0);
    const cooldownMessage = `[Lockdown] Halting operations for ${cooldownSeconds}s to let cluster recover...`;
    writeToTerminal(cooldownMessage, '#fcb714', true);
    startVisualCountdown(serverThrottledDelay);
    await sleep(serverThrottledDelay);
    writeToTerminal('[Lockdown] Cooling window elapsed. Recovering processing loop...', '#81c995');
    serverThrottledDelay = 0;
    forceDeselectAllCurrent();
    return true;
}

async function handleNoAvailableTargets() {
    updateStatus('Searching Elements...');
    await forceHydrate();
}

async function processDeletionIfBatchSelected(selection) {
    writeToTerminal(`[Batch] Selection preflight: ${selection.selectedLinks.length} targets selected from link candidates.`, '#8ab4f8');
    await submitBatchDeletion(selection.selectedLinks.length, selection.trackingIds);

    if (isAtEndOfGallery() || hasNoLinksSelected(selection)) {
        await restart();
        return;
    }

    if (shouldAbortRun()) {
        return;
    }
}

function isAtEndOfGallery() {
    const scroller = getHydrationScroller();
    if (!scroller) {
        return false;
    }

    const total = scroller.scrollHeight;
    const current = scroller.scrollTop + scroller.clientHeight;
    if (scroller.scrollTop < 200) {
        return false;
    }

    const isAtBottom = (current / total) > 0.99;
    if (isAtBottom) {
        writeToTerminal(`[Restart] Bottom detected: ${Math.round(current)}/${total}`, '#fcb714');
    }
    return isAtBottom;
}

function hasNoLinksSelected(selection) {
    const hasNoLinksSelected = selection.selectedLinks.length === 0;
    if (hasNoLinksSelected) {
        writeToTerminal('[Restart] Link selection returned 0. Assuming viewport drift; jumping to top anchor.', '#fcb714', true);
    }
    return hasNoLinksSelected;
}

async function restart() {
    updateStatus('Restarting...');
    await jumpScrollerToTop();
    dispatchHomeToPage();
    forceDeselectAllCurrent();
    await sleep(Math.max(1200, CONFIG.delays.postClick * 10));
}

async function jumpScrollerToTop(scroller) {
    writeToTerminal(`[Restart] Resetting ${actualScroller.tagName} position...`, '#ff3333');
    const actualScroller = getActualScroller();

    actualScroller.scrollTop = 0;
    const internalContainer = actualScroller.querySelector('[style*="transform"]');
    if (internalContainer) {
        internalContainer.style.transform = 'translateY(0px)';
    }

    actualScroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    window.dispatchEvent(new Event('resize'));
    actualScroller.dispatchEvent(new KeyboardEvent('keydown', { 
        key: 'Home', 
        keyCode: 36, 
        bubbles: true 
    }));

    writeToTerminal('[Restart] SPA View Re-initialized at Top.', '#81c995');
}

function getActualScroller() {
    return document.querySelector('c-wiz.yDSiEe.uGCjIb') || 
           document.querySelector('.yDSiEe.uGCjIb');
}

function dispatchHomeToPage() {
    const eventInit = {
        key: 'Home',
        bubbles: true
    };
    const event = new KeyboardEvent('keydown', eventInit);
    window.dispatchEvent(event);
    document.dispatchEvent(event);
}

function getAvailablePhotoLinks() {
    const allLinks = Array.from(document.querySelectorAll(CONFIG.selectors.photoLink));
    return allLinks.filter((link) => !processedPhotoUrls.has(link.href));
}

function chooseBatchCandidates(availableLinks) {
    const maxBatchSize = CONFIG.batch.maxSize;
    writeToTerminal(`[Batch] Aggregating ${maxBatchSize} random photo target matrices...`, '#9aa0a6');
    const randomizedLinks = availableLinks.sort(compareRandomly);
    return randomizedLinks.slice(0, maxBatchSize);
}

function compareRandomly() {
    return 0.5 - Math.random();
}

async function selectBatchLinks(batchCandidates) {
    const selectedLinks = [];
    const trackingIds = [];

    for (const link of batchCandidates) {
        if (shouldAbortRun()) {
            break;
        }

        await attemptToSelectLink(link, selectedLinks, trackingIds);
    }

    return {
        selectedLinks,
        trackingIds
    };
}

async function attemptToSelectLink(link, selectedLinks, trackingIds) {
    const checkbox = resolveCheckboxFromLink(link);

    if (!canSelectCheckbox(checkbox)) {
        return;
    }

    restorePointerEvents(link, checkbox);
    checkbox.click();
    await sleep(CONFIG.delays.postClick);

    if (isCheckboxSelected(checkbox)) {
        trackSelectedLink(link, selectedLinks, trackingIds);
    }
}

function resolveCheckboxFromLink(link) {
    const nestedCheckbox = link.querySelector(CONFIG.selectors.checkbox);

    if (nestedCheckbox) {
        return nestedCheckbox;
    }

    if (!link.parentElement) {
        return null;
    }

    return link.parentElement.querySelector(CONFIG.selectors.checkbox);
}

function canSelectCheckbox(checkbox) {
    return checkbox && checkbox.getAttribute('aria-checked') !== 'true';
}

function restorePointerEvents(link, checkbox) {
    if (link.style) {
        link.style.pointerEvents = 'auto';
    }

    if (checkbox.style) {
        checkbox.style.pointerEvents = 'auto';
    }
}

function isCheckboxSelected(checkbox) {
    return checkbox.getAttribute('aria-checked') === 'true' || checkbox.classList.contains('R9S78b');
}

function trackSelectedLink(link, batchLinks, trackingIds) {
    processedPhotoUrls.add(link.href);
    batchLinks.push(link);
    globalSequenceId += 1;
    trackingIds.push(globalSequenceId);
    addLedgerRow(globalSequenceId, link.href, 'Selected');
}

async function submitBatchDeletion(batchSize, trackingIds) {
    const deleteButton = getVisibleDeleteButton();

    if (!deleteButton) {
        await handleMissingDeleteButton(trackingIds);
        return;
    }

    deleteButton.click();
    await sleep(CONFIG.delays.modalWait);
    const confirmButton = getVisibleConfirmationButton();

    if (!confirmButton) {
        return;
    }

    await confirmBatchDeletion(confirmButton, batchSize, trackingIds);
}

function getVisibleDeleteButton() {
    const deleteButton = document.querySelector(CONFIG.selectors.deleteButton);

    if (!deleteButton) {
        return null;
    }

    return deleteButton.offsetParent !== null ? deleteButton : null;
}

function getVisibleConfirmationButton() {
    const allButtons = Array.from(document.querySelectorAll('button'));
    const isDeleteLabel = (text) => text.includes('Move to trash') || text.includes('Delete');
    return allButtons.find((button) => isDeleteLabel(button.textContent) && button.offsetParent !== null);
}

async function confirmBatchDeletion(confirmButton, batchSize, trackingIds) {
    markBatchAsSubmitted(trackingIds);
    updateStatus('Executing Deletion...');
    writeToTerminal(`📡 Dispatched batch request payload for ${batchSize} files...`, '#fcb714');
    confirmButton.click();
    await waitForAsyncMovementToComplete(trackingIds);
    await handleSuccessfulBatchDeletion(batchSize, trackingIds);
}

function markBatchAsSubmitted(trackingIds) {
    trackingIds.forEach((id) => {
        updateLedgerRowStatus(id, 'Submitted', '#fcb714');
    });
}

async function handleSuccessfulBatchDeletion(batchSize, trackingIds) {
    if (serverThrottledDelay !== 0) {
        return;
    }

    if (consecutiveServerFailures > 0) {
        consecutiveServerFailures -= 1;
    }

    totalDeleted += batchSize;
    updatePurgeCount(totalDeleted);
    markBatchAsPurged(trackingIds);
    writeToTerminal(`✅ Success verification logged. Total Cumulative Purged: ${totalDeleted}`, '#81c995', true);
    await sleep(CONFIG.delays.networkCooldown);
}

function markBatchAsPurged(trackingIds) {
    trackingIds.forEach((id) => {
        updateLedgerRowStatus(id, 'Purged Clean', '#81c995');
    });
}

async function handleMissingDeleteButton(trackingIds) {
    writeToTerminal('⚠️ Interface selection tracking lost context. Clearing layouts.', '#fcb714');
    markBatchAsContextSplit(trackingIds);
    const escapeEventInit = {
        key: 'Escape',
        bubbles: true
    };

    window.dispatchEvent(new KeyboardEvent('keydown', escapeEventInit));
    await sleep(2000);
}

function markBatchAsContextSplit(trackingIds) {
    trackingIds.forEach((id) => {
        updateLedgerRowStatus(id, 'Context Split', '#ff3333');
    });
}

async function waitForAsyncMovementToComplete(batchTrackingIds) {
    if (syncNeverWait) {
        writeToTerminal('[Sync] "Never wait" enabled. Skipping movement wait gate for this cycle.', '#fcb714');
        return;
    }

    updateStatus('Syncing with Cloud...');
    const initialBreather = Math.max(3000, batchTrackingIds.length * 150);
    const breatherSeconds = (initialBreather / 1000).toFixed(1);
    const syncMessage = `[Sync] Relinquishing pipeline execution for ${breatherSeconds}s to let handoff complete...`;
    writeToTerminal(syncMessage, '#8ab4f8');
    await sleep(initialBreather);
    writeToTerminal('[Sync] Relinquish window elapsed. Entering cloud movement scan gate...', '#8ab4f8');
    await runSyncGate(batchTrackingIds);
}

async function runSyncGate(batchTrackingIds) {
    const startTime = Date.now();
    const hardMaxTimeoutMs = 1200000;
    let consecutiveClearScans = 0;
    syncSkipRequested = false;
    setSyncWaitUiState(true, 3);

    try {
        while (Date.now() - startTime < hardMaxTimeoutMs) {
            if (syncSkipRequested) {
                writeToTerminal('[Sync] Skip requested by user. Exiting wait gate for this cycle.', '#fcb714', true);
                return;
            }

            if (syncNeverWait) {
                writeToTerminal('[Sync] "Never wait" enabled during active cycle. Exiting wait gate.', '#fcb714', true);
                return;
            }

            setSyncWaitUiState(true, Math.max(1, 3 - consecutiveClearScans));
            const result = await runSingleSyncScan(batchTrackingIds, startTime, consecutiveClearScans);

            if (result.exit) {
                return;
            }

            consecutiveClearScans = result.consecutiveClearScans;
        }

        writeToTerminal('🛑 Timeout limit breached while awaiting transaction stack fulfillment.', '#ff3333', true);
        markBatchAsCeilingBroken(batchTrackingIds);
    } finally {
        setSyncWaitUiState(false, 0);
    }
}

async function runSingleSyncScan(batchTrackingIds, startTime, consecutiveClearScans) {
    if (shouldAbortRun()) {
        return {
            exit: true,
            consecutiveClearScans
        };
    }

    if (serverThrottledDelay > 0) {
        return handleSyncLockdown(batchTrackingIds, consecutiveClearScans);
    }

    if (isCloudMovementTextPresent()) {
        return handleActiveSync(startTime);
    }

    return handleClearSync(consecutiveClearScans);
}

function handleSyncLockdown(batchTrackingIds, consecutiveClearScans) {
    writeToTerminal('[Sync] Network drop triggered backend lock. Evacuating synchronization wait gate.', '#fcb714');
    markBatchAsTimeoutSevered(batchTrackingIds);
    return {
        exit: true,
        consecutiveClearScans
    };
}

function markBatchAsTimeoutSevered(batchTrackingIds) {
    batchTrackingIds.forEach((id) => {
        updateLedgerRowStatus(id, 'Timeout Severed', '#ff3333');
    });
}

async function handleActiveSync(startTime) {
    const elapsedMinutes = ((Date.now() - startTime) / 60000).toFixed(1);
    updateStatus(`Syncing (${elapsedMinutes}m)...`);
    await sleep(4000);
    return {
        exit: false,
        consecutiveClearScans: 0
    };
}

async function handleClearSync(consecutiveClearScans) {
    const updatedClearScans = consecutiveClearScans + 1;
    writeToTerminal(`[Sync] Movement text absent. Clean scan ${updatedClearScans}/3.`, '#8ab4f8');

    if (updatedClearScans < 3) {
        return waitForMoreClearScans(updatedClearScans);
    }

    writeToTerminal('[Sync] Core cloud transaction tracking layers verified clean.', '#8ab4f8');
    await sleep(1500);
    return {
        exit: true,
        consecutiveClearScans: updatedClearScans
    };
}

async function waitForMoreClearScans(consecutiveClearScans) {
    await sleep(2500);
    return {
        exit: false,
        consecutiveClearScans
    };
}

function markBatchAsCeilingBroken(batchTrackingIds) {
    batchTrackingIds.forEach((id) => {
        updateLedgerRowStatus(id, 'Ceiling Broken', '#ff3333');
    });
}

function isCloudMovementTextPresent() {
    const textNodes = Array.from(document.querySelectorAll(CONFIG.selectors.textNodes));
    return textNodes.some((node) => hasMovementToTrashText(node));
}

function hasMovementToTrashText(node) {
    const content = (node && node.textContent) || '';
    const mentionsTrash = content.includes('trash') || content.includes('Trash');
    return content.includes('Moving') && mentionsTrash;
}

async function forceHydrate() {
    updateStatus('Hydrating Layout...');
    writeToTerminal('[Nav] Realignment of active layout viewport window tracking...', '#9aa0a6');
    const scroller = getHydrationScroller();
    nudgeLastPhotoIntoFocus();
    scrollHydrationContainer(scroller);
    await sleep(CONFIG.delays.scrollWait);
}

function scrollHydrationContainer(scroller) {
    if (scroller.scrollBy) {
        scroller.scrollBy(0, deltaY);
        return;
    }

    target.dispatchEvent(new WheelEvent('wheel', {
        deltaY: deltaY,
        bubbles: true
    }));
}

function getHydrationScroller() {
    const candidates = Array.from(document.querySelectorAll(CONFIG.selectors.scrollContainer));
    const scrollableCandidates = candidates.filter(isLikelyScrollableElement);

    if (scrollableCandidates.length > 0) {
        return scrollableCandidates.sort(compareScrollableRange)[0];
    }

    return document.scrollingElement || document.documentElement || window;
}

function isLikelyScrollableElement(element) {
    if (!element || element.offsetParent === null) {
        return false;
    }

    return element.scrollHeight - element.clientHeight > 40;
}

function compareScrollableRange(a, b) {
    const aRange = a.scrollHeight - a.clientHeight;
    const bRange = b.scrollHeight - b.clientHeight;
    return bRange - aRange;
}

function nudgeLastPhotoIntoFocus() {
    const photos = document.querySelectorAll(CONFIG.selectors.photoLink);

    if (photos.length === 0) {
        return;
    }

    const lastPhoto = photos[photos.length - 1];
    lastPhoto.focus();
    const arrowDownEventInit = {
        key: 'ArrowDown',
        bubbles: true
    };

    lastPhoto.dispatchEvent(new KeyboardEvent('keydown', arrowDownEventInit));
}

function cleanupAfterStop() {
    clearInterval(countdownIntervalTimer);
    hideCooldownPanel();
    releaseWakeLock();
    document.removeEventListener('visibilitychange', onPageVisibilityChanged);
    window.removeEventListener('resize', applyZoomCompensation);
    updateStatus('Terminated.');
    writeToTerminal(`🏁 Engine halted cleanly. Session run summary: ${totalDeleted} deleted files.`, '#81c995', true);
}

async function releaseWakeLock() {
    if (!wakeLockSentinel) {
        return;
    }

    await wakeLockSentinel.release();
    wakeLockSentinel = null;
    writeToTerminal('Wake lock released cleanly on stop.', '#9aa0a6');
}

function hideCooldownPanel() {
    const panel = document.getElementById('hud-cooldown-panel');

    if (panel) {
        panel.style.display = 'none';
    }
}

function resetRunState() {
    window.STOP_AUTOMATION = false;
    serverThrottledDelay = 0;
    consecutiveServerFailures = 0;
    globalSequenceId = 0;
}

function unlockDOM() {
    const lockedElements = document.querySelectorAll(CONFIG.selectors.lockedElements);
    lockedElements.forEach(enableInteractionForElement);
}

function enableInteractionForElement(element) {
    element.removeAttribute('aria-hidden');
    element.removeAttribute('inert');
    element.style.pointerEvents = 'auto';
    element.style.visibility = 'visible';
}

function forceDeselectAllCurrent() {
    dispatchEscapeToPage();
    const checkboxes = document.querySelectorAll(CONFIG.selectors.checkbox);
    checkboxes.forEach((checkbox) => {
        if (checkbox.getAttribute('aria-checked') === 'true') {
            checkbox.click();
        }
    });
}

function dispatchEscapeToPage() {
    const eventInit = {
        key: 'Escape',
        bubbles: true
    };
    const event = new KeyboardEvent('keydown', eventInit);
    window.dispatchEvent(event);
    document.dispatchEvent(event);
}

async function optimizeZoom() {
    const zoomSlider = document.querySelector(CONFIG.selectors.zoomSlider);

    if (!zoomSlider) {
        return;
    }

    zoomSlider.focus();
    const pageDownEventInit = {
        key: 'PageDown',
        bubbles: true
    };
    zoomSlider.dispatchEvent(new KeyboardEvent('keydown', pageDownEventInit));
    await sleep(1500);
}

function setupDashboardUI() {
    removeExistingDashboard();
    injectScrollbarSanitizer();
    const container = createDashboardContainer();
    appendChildren(container, dashboardSections());
    document.body.appendChild(container);
    attachZoomCompensationHandler();
}

function removeExistingDashboard() {
    const existingDashboard = document.getElementById('automation-dashboard-container');

    if (existingDashboard) {
        existingDashboard.remove();
    }
}

function injectScrollbarSanitizer() {
    const styleId = 'hud-scrollbar-sanitizer';

    if (document.getElementById(styleId)) {
        return;
    }

    const styleTag = createElement('style', { id: styleId });
    styleTag.textContent = scrollbarSanitizerCss();
    document.head.appendChild(styleTag);
}

function scrollbarSanitizerCss() {
    return `.hud-scroll-area::-webkit-scrollbar { width: 8px !important; height: 8px !important; }
        .hud-scroll-area::-webkit-scrollbar-button,
        .hud-scroll-area::-webkit-scrollbar-button:start,
        .hud-scroll-area::-webkit-scrollbar-button:end {
            display: none !important;
            width: 0px !important;
            height: 0px !important;
        }
        .hud-scroll-area::-webkit-scrollbar-track { background: #171717 !important; border-radius: 4px !important; }
        .hud-scroll-area::-webkit-scrollbar-thumb {
            background: #3c4043 !important;
            border-radius: 4px !important;
            border: none !important;
        }
        .hud-scroll-area::-webkit-scrollbar-thumb:hover { background: #5f6368 !important; }`;
}

function createDashboardContainer() {
    const containerStyle = joinCssRules([
        'position:fixed',
        'top:15px',
        'left:15px',
        'z-index:100000',
        'background:#202124',
        'color:#e8eaed',
        'padding:20px',
        'width:520px',
        'border-radius:12px',
        'box-shadow: 0 12px 36px rgba(0,0,0,0.7)',
        'font-family:sans-serif',
        'border:1px solid #3c4043',
        'font-size:13px',
        'line-height:1.4',
        'transition: transform 0.1s ease-out',
        'box-sizing:border-box'
    ]);

    return createElement('div', {
        id: 'automation-dashboard-container',
        style: containerStyle
    });
}

function dashboardSections() {
    return [
        createDashboardTitle(),
        createConfigPanel(),
        createStopButton(),
        createMetricsPanel(),
        createLedgerHeader(),
        createLedgerArea(),
        createTerminalHeader(),
        createTerminalBody()
    ];
}

function createDashboardTitle() {
    const titleStyle = joinCssRules([
        'font-size:18px',
        'font-weight:700',
        'line-height:1.2',
        'margin-bottom:12px',
        'color:#e8eaed'
    ]);
    return createElement('div', {
        style: titleStyle,
        text: 'Google Photos Robust Bulk Deleter'
    });
}

function createConfigPanel() {
    const panelStyle = joinCssRules([
        'background:#292a2d',
        'padding:10px 12px',
        'border-radius:8px',
        'border:1px solid #5f6368',
        'margin-bottom:15px'
    ]);
    const panel = createElement('div', { style: panelStyle });
    const header = createConfigPanelHeader();
    const grid = createConfigFieldGrid();
    appendChildren(panel, [header, grid]);
    return panel;
}

function createConfigPanelHeader() {
    const headerStyle = joinCssRules([
        'font-weight:bold',
        'margin-bottom:8px',
        'color:#9aa0a6',
        'text-transform:uppercase',
        'font-size:11px',
        'letter-spacing:0.5px'
    ]);
    return createElement('div', {
        style: headerStyle,
        text: 'Live Configuration'
    });
}

function createConfigFieldGrid() {
    const gridStyle = joinCssRules([
        'display:grid',
        'grid-template-columns:1fr 1fr',
        'gap:6px 12px'
    ]);
    const grid = createElement('div', { style: gridStyle });
    appendChildren(grid, buildConfigFieldElements());
    return grid;
}

function buildConfigFieldElements() {
    return configFieldDefinitions().map((field) => createConfigFieldCell(field));
}

function configFieldDefinitions() {
    return [
        {
            label: 'Post-Click Delay (ms)',
            group: 'delays',
            key: 'postClick',
            min: 0
        },
        {
            label: 'Modal Wait (ms)',
            group: 'delays',
            key: 'modalWait',
            min: 0
        },
        {
            label: 'Scroll Wait (ms)',
            group: 'delays',
            key: 'scrollWait',
            min: 0
        },
        {
            label: 'Network Cooldown (ms)',
            group: 'delays',
            key: 'networkCooldown',
            min: 0
        },
        {
            label: 'Backoff Base Unit (ms)',
            group: 'backoff',
            key: 'baseUnit',
            min: 1000
        },
        {
            label: 'Backoff Max Cap (ms)',
            group: 'backoff',
            key: 'maxCap',
            min: 1000
        },
        {
            label: 'Max Batch Size',
            group: 'batch',
            key: 'maxSize',
            min: 1
        }
    ];
}

function createConfigFieldCell(field) {
    const cellStyle = joinCssRules([
        'display:flex',
        'flex-direction:column',
        'gap:2px'
    ]);
    const cell = createElement('div', { style: cellStyle });
    const label = createConfigFieldLabel(field.label);
    const input = createConfigFieldInput(field);
    appendChildren(cell, [label, input]);
    return cell;
}

function createConfigFieldLabel(text) {
    const labelStyle = joinCssRules([
        'font-size:10px',
        'color:#9aa0a6',
        'text-transform:uppercase',
        'letter-spacing:0.3px'
    ]);
    return createElement('div', {
        style: labelStyle,
        text
    });
}

function createConfigFieldInput(field) {
    const inputStyle = joinCssRules([
        'background:#171717',
        'border:1px solid #3c4043',
        'border-radius:4px',
        'color:#e8eaed',
        'font-size:12px',
        'padding:4px 6px',
        'width:100%',
        'box-sizing:border-box',
        'font-family:monospace'
    ]);
    const input = createElement('input', { style: inputStyle });
    input.type = 'number';
    input.min = String(field.min);
    input.value = String(CONFIG[field.group][field.key]);
    input.oninput = () => applyConfigFieldChange(input, field);
    return input;
}

function applyConfigFieldChange(input, field) {
    const parsed = parseInt(input.value, 10);
    const isValid = !isNaN(parsed) && parsed >= field.min;
    if (isValid) {
        CONFIG[field.group][field.key] = parsed;
        input.style.borderColor = '#3c4043';
    } else {
        input.style.borderColor = '#ff3333';
    }
}

function createStopButton() {
    const buttonStyle = joinCssRules([
        'width:100%',
        'background:#d93025',
        'color:white',
        'padding:12px',
        'font-weight:bold',
        'cursor:pointer',
        'border:none',
        'border-radius:6px',
        'box-shadow: 0 2px 4px rgba(0,0,0,0.3)',
        'font-size:14px',
        'margin-bottom:15px'
    ]);

    const stopButton = createElement('button', {
        id: 'stop-automation-btn',
        text: '🛑 STOP AUTOMATION',
        style: buttonStyle
    });
    stopButton.onclick = handleManualStopRequest;
    return stopButton;
}

function handleManualStopRequest() {
    window.STOP_AUTOMATION = true;
    updateStatus('Shutting Down...');
    writeToTerminal('🛑 Stop sequence pulled manually. Ending loops...', '#ff3333', true);
}

function createMetricsPanel() {
    const panelStyle = joinCssRules([
        'background:#292a2d',
        'padding:12px',
        'border-radius:8px',
        'border:1px solid #5f6368',
        'margin-bottom:15px'
    ]);
    const panel = createElement('div', { style: panelStyle });
    appendChildren(panel, [
        createTotalPurgedRow(),
        createStatusRow(),
        createSyncWaitControlRow(),
        createCooldownPanel()
    ]);
    return panel;
}

function createSyncWaitControlRow() {
    const row = createElement('div', {
        id: 'hud-sync-wait-controls',
        style: 'margin-top:8px;margin-bottom:6px;display:flex;align-items:center;gap:10px;'
    });

    const skipButton = createElement('button', {
        id: 'hud-sync-skip-btn',
        text: 'Skip 3 Moving Statements',
        style: joinCssRules([
            'display:none',
            'background:#fcb714',
            'color:#202124',
            'border:none',
            'border-radius:6px',
            'padding:12px',
            'font-size:11px',
            'font-weight:bold',
            'cursor:pointer'
        ])
    });
    skipButton.onclick = handleSyncSkipButtonPressed;

    const neverWaitWrap = createElement('label', {
        style: 'display:flex;align-items:center;gap:6px;font-size:16px;color:#fcb714;cursor:pointer;user-select:none;'
    });

    const neverWaitCheckbox = document.createElement('input');
    neverWaitCheckbox.id = 'hud-sync-neverwait-checkbox';
    neverWaitCheckbox.type = 'checkbox';
    neverWaitCheckbox.checked = false;
    neverWaitCheckbox.onchange = handleSyncNeverWaitToggled;

    const neverWaitText = createElement('span', {
        text: 'Never wait'
    });

    appendChildren(neverWaitWrap, [neverWaitCheckbox, neverWaitText]);
    appendChildren(row, [skipButton, neverWaitWrap]);
    return row;
}

function setSyncWaitUiState(isActive, remainingStatements) {
    const skipButton = document.getElementById('hud-sync-skip-btn');

    if (!skipButton) {
        return;
    }

    if (!isActive) {
        skipButton.style.display = 'none';
        skipButton.disabled = true;
        return;
    }

    const remaining = Math.max(1, remainingStatements || 3);
    skipButton.textContent = `Skip ${remaining} Moving Statements`;
    skipButton.style.display = 'inline-block';
    skipButton.disabled = false;
}

function handleSyncSkipButtonPressed() {
    syncSkipRequested = true;
    writeToTerminal('[Sync] Skip button pressed. Current wait cycle will be bypassed.', '#fcb714');
}

function handleSyncNeverWaitToggled(event) {
    syncNeverWait = !!event.target.checked;
    if (syncNeverWait) {
        syncSkipRequested = true;
        writeToTerminal('[Sync] "Never wait" enabled. Future cycles will bypass wait gate.', '#fcb714', true);
        return;
    }

    writeToTerminal('[Sync] "Never wait" disabled. Wait gate restored for future cycles.', '#9aa0a6');
}

function createStatusRow() {
    const row = createElement('div', { style: 'margin-bottom:6px;' });
    const statusLabel = createElement('strong', { text: 'Engine Status: ' });
    const statusStyle = joinCssRules(['color:#8ab4f8', 'font-weight:bold']);
    const statusValue = createElement('span', {
        id: 'hud-status-text',
        style: statusStyle,
        text: 'Initializing...'
    });
    appendChildren(row, [statusLabel, statusValue]);
    return row;
}

function createTotalPurgedRow() {
    const row = createElement('div', { style: 'margin-bottom:6px;' });
    const countLabel = createElement('strong', { text: 'Total Files Purged: ' });
    const counterStyle = joinCssRules(['color:#81c995', 'font-weight:bold']);
    const countValue = createElement('span', {
        id: 'hud-total-counter',
        style: counterStyle,
        text: '0'
    });
    appendChildren(row, [countLabel, countValue]);
    return row;
}

function createCooldownPanel() {
    const panel = createElement('div', {
        id: 'hud-cooldown-panel',
        style: 'display:none;margin-top:8px;padding-top:8px;border-top:1px dashed #5f6368;color:#fcb714;'
    });
    appendChildren(panel, [createCooldownIntervalRow(), createCooldownRemainingRow()]);
    return panel;
}

function createCooldownIntervalRow() {
    const row = createElement('div');
    const label = createElement('strong', { text: 'Cooldown Interval: ' });
    const value = createElement('span', {
        id: 'hud-total-cooldown',
        text: '0m 0s'
    });
    appendChildren(row, [label, value]);
    return row;
}

function createCooldownRemainingRow() {
    const row = createElement('div');
    const label = createElement('strong', { text: 'Time Remaining: ' });
    const valueStyle = joinCssRules(['font-weight:bold', 'font-variant-numeric:tabular-nums']);
    const value = createElement('span', {
        id: 'hud-remaining-cooldown',
        style: valueStyle,
        text: '0m 0s'
    });
    appendChildren(row, [label, value]);
    return row;
}

function createLedgerHeader() {
    const headerStyle = joinCssRules([
        'font-weight:bold',
        'margin-bottom:6px',
        'color:#9aa0a6',
        'text-transform:uppercase',
        'font-size:11px',
        'letter-spacing:0.5px'
    ]);
    return createElement('div', {
        style: headerStyle,
        text: 'Live Batch Processing Ledger'
    });
}

function createLedgerArea() {
    const scrollAreaStyle = joinCssRules([
        'max-height:140px',
        'overflow-y:auto',
        'background:#171717',
        'border-radius:6px',
        'border:1px solid #3c4043',
        'margin-bottom:15px',
        'padding-right:2px'
    ]);
    const scrollArea = createElement('div', {
        className: 'hud-scroll-area',
        style: scrollAreaStyle
    });
    scrollArea.appendChild(createLedgerTable());
    return scrollArea;
}

function createLedgerTable() {
    const table = createElement('table', {
        id: 'hud-audit-table',
        style: 'width:100%;border-collapse:collapse;font-size:11px;text-align:left;table-layout:fixed;'
    });
    appendChildren(table, [createLedgerHead(), createElement('tbody', { id: 'hud-audit-tbody' })]);
    return table;
}

function createLedgerHead() {
    const head = createElement('thead', {
        style: 'position:sticky;top:0;background:#303134;color:#9aa0a6;box-shadow:0 1px 0 #3c4043;z-index:1;'
    });
    const row = createElement('tr');
    const idHeader = createElement('th', {
        style: 'padding:6px 8px;',
        text: 'File Identifier Reference'
    });
    const submittedHeader = createElement('th', {
        style: 'padding:6px 8px;width:80px;',
        text: 'Submitted'
    });
    const statusHeader = createElement('th', {
        style: 'padding:6px 8px;width:130px;',
        text: 'Status'
    });
    appendChildren(row, [idHeader, submittedHeader, statusHeader]);
    head.appendChild(row);
    return head;
}

function createTerminalHeader() {
    const headerStyle = joinCssRules([
        'font-weight:bold',
        'margin-bottom:6px',
        'color:#9aa0a6',
        'text-transform:uppercase',
        'font-size:11px',
        'letter-spacing:0.5px'
    ]);
    return createElement('div', {
        style: headerStyle,
        text: 'System Console Output'
    });
}

function createTerminalBody() {
    const terminalStyle = joinCssRules([
        'height:120px',
        'overflow-y:auto',
        'background:#0c0c0d',
        'border-radius:6px',
        'border:1px solid #3c4043',
        'padding:8px 10px',
        'box-sizing:border-box',
        'scroll-behavior:smooth'
    ]);
    return createElement('div', {
        id: 'hud-terminal-body',
        className: 'hud-scroll-area',
        style: terminalStyle
    });
}

function attachZoomCompensationHandler() {
    applyZoomCompensation();
    window.removeEventListener('resize', applyZoomCompensation);
    window.addEventListener('resize', applyZoomCompensation);
}

function applyZoomCompensation() {
    const dashboard = document.getElementById('automation-dashboard-container');

    if (!dashboard) {
        return;
    }

    const zoom = window.devicePixelRatio || 1;
    dashboard.style.transformOrigin = 'top left';
    dashboard.style.transform = `scale(${1 / zoom})`;
    dashboard.style.top = `${15 * zoom}px`;
    dashboard.style.left = `${15 * zoom}px`;
}

function addLedgerRow(sequenceId, href, statusText) {
    const ledgerBody = document.getElementById('hud-audit-tbody');

    if (!ledgerBody) {
        return;
    }

    const row = createLedgerRow(sequenceId, href, statusText);
    ledgerBody.insertBefore(row, ledgerBody.firstChild);

    if (ledgerBody.children.length > 100) {
        ledgerBody.lastChild.remove();
    }
}

function createLedgerRow(sequenceId, href, statusText) {
    const row = createElement('tr', {
        id: `ledger-row-${sequenceId}`,
        style: 'border-bottom:1px solid #292a2d;color:#e8eaed;height:26px;'
    });
    const referenceCell = createLedgerReferenceCell(sequenceId, href);
    const timeCell = createLedgerTimeCell();
    const statusCell = createLedgerStatusCell(sequenceId, statusText);
    appendChildren(row, [referenceCell, timeCell, statusCell]);
    return row;
}

function createLedgerReferenceCell(sequenceId, href) {
    const cellStyle = joinCssRules([
        'padding:4px 8px',
        'font-family:monospace',
        'color:#9aa0a6',
        'white-space:nowrap',
        'overflow:hidden',
        'text-overflow:ellipsis'
    ]);
    return createElement('td', {
        style: cellStyle,
        title: href,
        text: ledgerReferenceFromHref(href, sequenceId)
    });
}

function createLedgerTimeCell() {
    return createElement('td', {
        style: 'padding:4px 8px;color:#9aa0a6;font-variant-numeric:tabular-nums;',
        text: getTimestamp()
    });
}

function createLedgerStatusCell(sequenceId, statusText) {
    const cellStyle = joinCssRules([
        'padding:4px 8px',
        'font-weight:bold',
        'color:#fcb714',
        'white-space:nowrap',
        'overflow:hidden',
        'text-overflow:ellipsis'
    ]);
    return createElement('td', {
        id: `ledger-status-${sequenceId}`,
        style: cellStyle,
        text: statusText
    });
}

function ledgerReferenceFromHref(href, fallbackId) {
    const pathSegments = href.split('/');
    const nonEmptySegments = pathSegments.filter(Boolean);
    const lastSegment = nonEmptySegments.pop();

    if (!lastSegment) {
        return `Item #${fallbackId}`;
    }

    return lastSegment.substring(0, 22);
}

function updateLedgerRowStatus(sequenceId, newStatus, colorHex) {
    const statusCell = document.getElementById(`ledger-status-${sequenceId}`);

    if (!statusCell) {
        return;
    }

    statusCell.textContent = newStatus;
    statusCell.style.color = colorHex;
}

function updateStatus(statusText) {
    currentStatusText = statusText;
    const statusElement = document.getElementById('hud-status-text');

    if (statusElement) {
        statusElement.textContent = statusText;
    }
}

function updatePurgeCount(newCount) {
    const counterElement = document.getElementById('hud-total-counter');

    if (counterElement) {
        counterElement.textContent = newCount;
    }
}

function startVisualCountdown(durationMs) {
    clearInterval(countdownIntervalTimer);
    const panel = document.getElementById('hud-cooldown-panel');
    const total = document.getElementById('hud-total-cooldown');
    const remaining = document.getElementById('hud-remaining-cooldown');

    if (!panel || !total || !remaining) {
        return;
    }

    initializeCooldownPanel(durationMs, panel, total);
    countdownIntervalTimer = startCooldownTicker(durationMs, panel, remaining);
}

function initializeCooldownPanel(durationMs, panel, totalElement) {
    panel.style.display = 'block';
    totalElement.textContent = formatDurationMs(durationMs);
}

function startCooldownTicker(durationMs, panel, remainingElement) {
    const wakeAt = Date.now() + durationMs;
    return setInterval(() => updateCooldownDisplay(wakeAt, panel, remainingElement), 250);
}

function updateCooldownDisplay(wakeAt, panel, remainingElement) {
    const remainingMs = Math.max(0, wakeAt - Date.now());
    remainingElement.textContent = formatDurationMs(remainingMs);

    if (remainingMs > 0) {
        return;
    }

    clearInterval(countdownIntervalTimer);
    panel.style.display = 'none';
}

function formatDurationMs(durationMs) {
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
}

function writeToTerminal(message, hexColor = '#e8eaed', isBold = false) {
    const terminalBody = getHudTerminalBody();

    if (!terminalBody) {
        console.log(message);
        return;
    }

    const entry = createTerminalEntry(message, hexColor, isBold);
    terminalBody.appendChild(entry);
    terminalBody.scrollTop = terminalBody.scrollHeight;

    if (terminalBody.children.length > 200) {
        terminalBody.firstChild.remove();
    }
}

function createTerminalEntry(message, hexColor, isBold) {
    const line = createElement('div', {
        style: terminalLineStyle(hexColor, isBold),
        title: message
    });
    const time = createElement('span', {
        style: terminalTimeStyle(),
        text: `[${getTimestamp()}]`
    });
    const text = createElement('span', {
        text: message,
        title: message
    });
    appendChildren(line, [time, text]);
    return line;
}

function getHudTerminalBody() {
    return document.getElementById('hud-terminal-body');
}

function terminalLineStyle(hexColor, isBold) {
    const boldWeight = isBold ? 'bold' : 'normal';
    const styleRules = [
        'margin-bottom: 3px',
        `color: ${hexColor}`,
        `font-weight: ${boldWeight}`,
        'font-family: monospace',
        'font-size: 11px',
        'line-height: 1.2',
        'white-space: nowrap',
        'overflow: hidden',
        'text-overflow: ellipsis'
    ];
    return joinCssRules(styleRules);
}

function joinCssRules(rules) {
    return `${rules.join(';')};`;
}

function terminalTimeStyle() {
    return 'color: #5f6368; margin-right: 6px; font-variant-numeric: tabular-nums;';
}

function getTimestamp() {
    const options = {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    };
    return new Date()
        .toLocaleTimeString([], options);
}

function createElement(tagName, options = {}) {
    const element = document.createElement(tagName);

    if (options.id) {
        element.id = options.id;
    }

    if (options.className) {
        element.className = options.className;
    }

    if (options.style) {
        element.style = options.style;
    }

    if (options.text !== undefined) {
        element.textContent = options.text;
    }

    if (options.title) {
        element.title = options.title;
    }

    return element;
}

function appendChildren(parent, children) {
    children.forEach((child) => {
        parent.appendChild(child);
    });
}

function installUnhandledRejectionShield() {
    window.addEventListener('unhandledrejection', (event) => {
        if (!shouldSilenceUnhandledRejection(event.reason)) {
            return;
        }

        writeToTerminal('🛡️ Thread Shield: Parallel execution worker crash neutralized safely.', '#9aa0a6');
        event.preventDefault();
    });
}

function shouldSilenceUnhandledRejection(reason) {
    const normalizedReason = String(reason || '');
    return normalizedReason.includes('RpcError') || normalizedReason.includes('CUIERROR');
}

function installFetchMonitor() {
    const nativeFetch = window.fetch;
    window.fetch = async (...args) => monitoredFetch(nativeFetch, args);
}

async function monitoredFetch(nativeFetch, args) {
    try {
        const response = await nativeFetch(...args);

        if (isServerStrainResponse(response)) {
            lockDownIfNotAlreadyLocked(`HTTP Status ${response.status}`);
        }

        return response;
    } catch (networkError) {
        lockDownIfNotAlreadyLocked('Network Dropout Exception');
        throw networkError;
    }
}

function isServerStrainResponse(response) {
    if (response.ok) {
        return false;
    }

    if (response.status >= 500) {
        return true;
    }

    return [429, 503, 504].includes(response.status);
}

function lockDownIfNotAlreadyLocked(statusType) {
    if (serverThrottledDelay === 0) {
        triggerServerLockdown(statusType);
    }
}

function triggerServerLockdown(statusType) {
    consecutiveServerFailures += 1;
    const delay = CONFIG.backoff.baseUnit * Math.pow(2, consecutiveServerFailures - 1);
    serverThrottledDelay = Math.min(delay, CONFIG.backoff.maxCap);
    writeToTerminal(`⚠️ PASSIVE MONITOR DETECTED SERVER STRAIN (${statusType})`, '#ff3333', true);
}

function executeAutomation() {
    installUnhandledRejectionShield();
    installFetchMonitor();
    start();
}

executeAutomation();