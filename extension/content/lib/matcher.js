// Finds Ring's reconnect affordances. Primary match is role + accessible name / text;
// data-testid values from prior art are fast-path hints only (Ring churns them).
(() => {
  const RVK = (globalThis.RVK = globalThis.RVK || {});

  const RECONNECT_RE = /\bre-?connect\b/i;
  // "Start Live View(s)": the button Ring shows on the plain Dashboard after a
  // live session expires. Clicking it re-enters the Multi-Cam grid (a reload
  // does NOT: the live-session token in the URL is single-use).
  const START_LIVE_RE = /start\s+live\s+views?/i;
  // Accept buttons inside a live-view timeout dialog ("are you still watching").
  const MODAL_CONTEXT_RE = /live view|still watching|are you (still )?there|session (has )?(ended|expired)|keep watching/i;
  const MODAL_ACCEPT_RE = /\b(continue|resume|keep watching|yes|stay|re-?connect)\b/i;

  function usable(el) {
    if (!RVK.dom.isVisible(el)) return false;
    if (el.disabled) return false;
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return false;
    return true;
  }

  function findReconnectButtons(root = globalThis.document) {
    const found = new Set();
    // Fast path: known testid from prior art (hint only).
    for (const b of RVK.dom.queryAllDeep('button[data-testid="video-error__button"]', root)) {
      if (usable(b)) found.add(b);
    }
    // Primary path: any button-like element whose accessible name says "Reconnect".
    for (const b of RVK.dom.queryAllDeep('button, [role="button"]', root)) {
      if (found.has(b) || !usable(b)) continue;
      if (RECONNECT_RE.test(RVK.dom.accessibleName(b))) found.add(b);
    }
    return [...found];
  }

  // The "Live View ended / still watching?" modal's accept button, if present.
  function findModalAccept(root = globalThis.document) {
    for (const b of RVK.dom.queryAllDeep('button[data-testid="modal__accept-button"]', root)) {
      if (usable(b)) return b;
    }
    for (const dialog of RVK.dom.queryAllDeep('[role="dialog"], dialog, [role="alertdialog"]', root)) {
      if (!RVK.dom.isVisible(dialog)) continue;
      if (!MODAL_CONTEXT_RE.test(dialog.textContent || '')) continue;
      for (const b of RVK.dom.queryAllDeep('button, [role="button"]', dialog)) {
        if (usable(b) && MODAL_ACCEPT_RE.test(RVK.dom.accessibleName(b))) return b;
      }
    }
    return null;
  }

  // The "Start Live View(s)" button on the Dashboard. Prefer the one nearest
  // the top (the Multi-Cam header control) when several exist.
  function findStartLiveView(root = globalThis.document) {
    const hits = [];
    for (const b of RVK.dom.queryAllDeep('button, [role="button"], a', root)) {
      if (!usable(b)) continue;
      if (START_LIVE_RE.test(RVK.dom.accessibleName(b))) hits.push(b);
    }
    if (!hits.length) return null;
    hits.sort((a, b) => {
      const ra = a.getBoundingClientRect ? a.getBoundingClientRect().top : 0;
      const rb = b.getBoundingClientRect ? b.getBoundingClientRect().top : 0;
      return ra - rb;
    });
    return hits[0];
  }

  RVK.matcher = { RECONNECT_RE, START_LIVE_RE, findReconnectButtons, findModalAccept, findStartLiveView };
})();
