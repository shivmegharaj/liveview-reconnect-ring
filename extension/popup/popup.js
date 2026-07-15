const FRESH_MS = 90_000;

const enabledInput = document.getElementById('enabled');
const refreshBtn = document.getElementById('refresh');
const tabsEl = document.getElementById('tabs');
const emptyEl = document.getElementById('empty');
const summaryEl = document.getElementById('summary');
const versionEl = document.getElementById('version');
const markEl = document.querySelector('.mark');

let lastFingerprint = '';
let renderTimer = null;

enabledInput.addEventListener('change', () => {
  chrome.storage.local.set({ rvk_enabled: enabledInput.checked });
});

refreshBtn.addEventListener('click', async () => {
  refreshBtn.classList.add('busy');
  refreshBtn.disabled = true;
  lastFingerprint = ''; // force redraw after rescan
  try {
    await chrome.runtime.sendMessage({ type: 'rescan_all' });
  } catch { /* SW may be waking */ }
  setTimeout(() => {
    render(true);
    refreshBtn.classList.remove('busy');
    refreshBtn.disabled = false;
  }, 500);
});

try {
  versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
} catch {
  versionEl.textContent = '';
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function shortTitle(report) {
  const raw = report.title || report.url || `Tab ${report.tabId}`;
  return raw.replace(/\s*[|–—-]\s*Ring.*$/i, '').trim() || raw;
}

function camTitle(tile) {
  if (tile.label) return tile.label;
  return tile.key.replace(/^tile-/, 'Cam ');
}

function tileLabel(status) {
  if (status === 'verifying') return 'reconnecting';
  if (status === 'dead') return 'needs reconnect';
  if (status === 'frozen') return 'frozen';
  return 'healthy';
}

function renderTab(report) {
  const wrap = el('div', 'tab');
  const stale = Date.now() - report.receivedAt > FRESH_MS;
  if (stale) wrap.classList.add('stale');

  wrap.appendChild(el('h2', null, shortTitle(report)));

  if (report.signedOut) {
    wrap.appendChild(el('div', 'banner', 'Signed out. Sign back in on this tab.'));
  }
  if (report.enabled === false) {
    wrap.appendChild(el('div', 'banner paused', 'Watchdog paused.'));
  }

  const tiles = report.tiles || [];
  if (!tiles.length && !report.signedOut) {
    wrap.appendChild(
      el('div', 'banner paused', 'No camera tiles found yet. If live view is open, Ring’s layout may have changed.'),
    );
  }

  const grid = el('div', 'tiles');
  for (const tile of tiles) {
    const card = el('div', `tile${tile.status === 'healthy' ? '' : ' unhealthy'}`);
    const top = el('div', 'tile-top');
    top.appendChild(el('span', `dot ${tile.status}`));
    top.appendChild(el('span', 'tile-name', camTitle(tile)));
    card.appendChild(top);
    card.appendChild(el('span', 'tile-status', tileLabel(tile.status)));
    const bits = [];
    if (tile.reconnects) bits.push(`${tile.reconnects}× recovered`);
    if (tile.failStreak) bits.push(`${tile.failStreak} fails`);
    if (bits.length) card.appendChild(el('span', 'tile-meta', bits.join(' · ')));
    grid.appendChild(card);
  }
  if (tiles.length) wrap.appendChild(grid);

  return wrap;
}

async function findUnwatchedRingTabs(reports) {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://account.ring.com/*' });
    const reporting = new Set(
      Object.values(reports)
        .filter((r) => Date.now() - r.receivedAt < FRESH_MS)
        .map((r) => r.tabId),
    );
    return tabs.filter((t) => !reporting.has(t.id));
  } catch {
    return [];
  }
}

function updateSummary(list, unwatched) {
  let unhealthy = 0;
  let signedOut = 0;
  for (const r of list) {
    if (Date.now() - r.receivedAt > FRESH_MS) continue;
    if (r.signedOut) signedOut += 1;
    for (const t of r.tiles || []) {
      if (t.status !== 'healthy') unhealthy += 1;
    }
  }

  if (unwatched.length) {
    summaryEl.textContent = `${unwatched.length} tab(s) need watchdog`;
    markEl.className = 'mark warn';
  } else if (signedOut) {
    summaryEl.textContent = 'Sign-in required';
    markEl.className = 'mark bad';
  } else if (!list.length) {
    summaryEl.textContent = 'Waiting for dashboards';
    markEl.className = 'mark warn';
  } else if (unhealthy) {
    summaryEl.textContent = `${unhealthy} camera${unhealthy === 1 ? '' : 's'} recovering`;
    markEl.className = 'mark warn';
  } else {
    summaryEl.textContent = 'All cameras healthy';
    markEl.className = 'mark';
  }
}

function uiFingerprint(list, unwatched, prefs) {
  return JSON.stringify({
    enabled: prefs.rvk_enabled !== false,
    unwatched: unwatched.map((t) => t.id).sort(),
    tabs: list.map((r) => ({
      id: r.tabId,
      title: shortTitle(r),
      signedOut: !!r.signedOut,
      enabled: r.enabled !== false,
      stale: Date.now() - r.receivedAt > FRESH_MS,
      tiles: (r.tiles || []).map((t) => [
        t.key, t.label || '', t.status, t.reconnects || 0, t.failStreak || 0,
      ]),
    })),
  });
}

async function render(force = false) {
  const [{ reports = {} }, prefs] = await Promise.all([
    chrome.storage.session.get('reports'),
    chrome.storage.local.get({ rvk_enabled: true }),
  ]);
  enabledInput.checked = prefs.rvk_enabled !== false;

  const list = Object.values(reports).sort((a, b) =>
    shortTitle(a).localeCompare(shortTitle(b)),
  );
  const unwatched = await findUnwatchedRingTabs(reports);
  const fp = uiFingerprint(list, unwatched, prefs);
  if (!force && fp === lastFingerprint) return;
  lastFingerprint = fp;

  updateSummary(list, unwatched);
  tabsEl.textContent = '';

  if (unwatched.length) {
    const banner = el('div', 'tab');
    banner.appendChild(
      el('div', 'banner', `${unwatched.length} Ring tab(s) open without the watchdog.`),
    );
    const btn = el('button', 'action', `Start in ${unwatched.length} tab(s)`);
    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'inject_all' });
      btn.disabled = true;
      btn.textContent = 'Starting...';
      setTimeout(() => render(true), 2000);
    });
    banner.appendChild(btn);
    tabsEl.appendChild(banner);
  }

  emptyEl.hidden = list.length > 0 || unwatched.length > 0;
  for (const report of list) tabsEl.appendChild(renderTab(report));
}

chrome.storage.onChanged.addListener(() => {
  // Debounce: both dashboards report often; avoid wiping the popup every write.
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => render(false), 120);
});
render(true);
