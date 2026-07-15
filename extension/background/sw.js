// Event-driven only. All watchdog logic lives in the content script; the SW
// aggregates reports, shows badge/notifications, holds the display awake, and
// fires brief CDP trusted clicks when a Reconnect is needed.
importScripts('trusted-click.js');

const FRESH_MS = 90_000;
const AUTH_THROTTLE_MS = 60 * 60_000;
const TILE_THROTTLE_MS = 30 * 60_000;

// Chrome does NOT re-inject declared content scripts into already-open tabs
// when the extension is installed, updated, or reloaded. Without this, every
// extension reload silently orphans all open dashboards.
async function injectIntoOpenRingTabs() {
  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js || [];
  const tabs = await chrome.tabs.query({ url: 'https://account.ring.com/*' });
  for (const tab of tabs) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files });
    } catch { /* tab discarded or not injectable; it will inject on next load */ }
  }
  return tabs.length;
}

async function rescanAllRingTabs() {
  const tabs = await chrome.tabs.query({ url: 'https://account.ring.com/*' });
  let n = 0;
  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'rescan' });
      n += 1;
    } catch {
      // Not injected yet: load the watchdog, then ask again.
      try {
        const files = chrome.runtime.getManifest().content_scripts?.[0]?.js || [];
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files });
        await chrome.tabs.sendMessage(tab.id, { type: 'rescan' });
        n += 1;
      } catch { /* tab not injectable */ }
    }
  }
  return n;
}

chrome.runtime.onInstalled.addListener(() => {
  injectIntoOpenRingTabs();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg?.type) return false;

  if (msg.type === 'inject_all') {
    injectIntoOpenRingTabs();
    return false;
  }

  if (msg.type === 'rescan_all') {
    rescanAllRingTabs()
      .then((n) => sendResponse({ ok: true, tabs: n }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }

  if (msg.type === 'trusted_click') {
    // Only the content-script tab that sent this message, never msg.tabId.
    // chrome.debugger is per Chrome profile; attach cannot reach other profiles.
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ ok: false, error: 'no sender tab' });
      return false;
    }
    globalThis.RVK_trustedClick(tabId, msg.x, msg.y)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true; // async response
  }

  if (!sender.tab?.id) return false;
  handle(msg, sender.tab).catch(() => {});
  return false;
});

async function handle(msg, tab) {
  if (msg.type === 'report') return handleReport(msg, tab);
  if (msg.type === 'auth_lost') {
    return notify(
      `auth-${tab.id}`,
      'Ring dashboard signed out',
      `${tab.title || 'A Ring tab'} appears signed out. Sign back in to restore live view.`,
      AUTH_THROTTLE_MS,
    );
  }
  if (msg.type === 'tile_alert') {
    const what = msg.frozen
      ? 'has a frozen stream (no reconnect control visible)'
      : `failed to reconnect ${msg.failStreak} times in a row`;
    return notify(
      `tile-${tab.id}-${msg.key}`,
      'Ring camera tile needs attention',
      `${tab.title || 'Ring tab'}: ${msg.key} ${what}.`,
      TILE_THROTTLE_MS,
    );
  }
}

async function handleReport(msg, tab) {
  const { reports = {} } = await chrome.storage.session.get('reports');
  reports[tab.id] = { ...msg, tabId: tab.id, receivedAt: Date.now() };
  await chrome.storage.session.set({ reports });
  await updateBadge(reports);
  try {
    chrome.power?.requestKeepAwake('display');
  } catch { /* power API unavailable */ }
}

async function updateBadge(reports) {
  let unhealthy = 0;
  let anyFresh = false;
  const cutoff = Date.now() - FRESH_MS;
  for (const r of Object.values(reports)) {
    if (!r || r.receivedAt < cutoff) continue;
    anyFresh = true;
    if (r.signedOut) unhealthy += 1;
    for (const tile of r.tiles || []) {
      if (tile.status !== 'healthy') unhealthy += 1;
    }
  }
  await chrome.action.setBadgeBackgroundColor({ color: '#c62828' });
  await chrome.action.setBadgeText({ text: unhealthy > 0 ? String(unhealthy) : '' });
  return anyFresh;
}

async function notify(id, title, message, throttleMs) {
  const { notified = {} } = await chrome.storage.session.get('notified');
  if (Date.now() - (notified[id] || 0) < throttleMs) return;
  notified[id] = Date.now();
  await chrome.storage.session.set({ notified });
  try {
    chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message,
      priority: 2,
    });
  } catch { /* notifications unavailable */ }
}

// Periodic sweep: prune stale tab reports; release keep-awake when no Ring tab reports.
chrome.alarms.create('rvk-sweep', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'rvk-sweep') return;
  const { reports = {} } = await chrome.storage.session.get('reports');
  const cutoff = Date.now() - FRESH_MS;
  let changed = false;
  for (const [tabId, r] of Object.entries(reports)) {
    if (!r || r.receivedAt < cutoff) {
      delete reports[tabId];
      changed = true;
    }
  }
  if (changed) await chrome.storage.session.set({ reports });
  const anyFresh = await updateBadge(reports);
  if (!anyFresh) {
    try {
      chrome.power?.releaseKeepAwake();
    } catch { /* power API unavailable */ }
  }
});
