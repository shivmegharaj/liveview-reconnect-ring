// Groups videos and reconnect buttons into camera tiles without assuming Ring's
// class names: a tile is the lowest ancestor that has >=2 siblings each containing
// tile content (a video or a reconnect control). Falls back to a single-tile key.
(() => {
  const RVK = (globalThis.RVK = globalThis.RVK || {});

  // Ring UI / a11y chrome that must never become a camera label.
  const SKIP_NAME_RE =
    /draggable|arrow keys|reorder|turn\s+on\s+sound|turn\s+off\s+sound|\bsound\b|\bmute\b|\bunmute\b|volume|speaker|microphone|\bmic\b|re-?connect|live view|manage cameras|^end$|^close$|settings|^dashboard$|use arrow|keyboard/i;

  function hasTileContent(node) {
    if (!node || !node.querySelectorAll) return false;
    if (node.querySelector('video')) return true;
    if (node.querySelector('button[data-testid="video-error__button"]')) return true;
    for (const b of node.querySelectorAll('button, [role="button"]')) {
      if (RVK.matcher.RECONNECT_RE.test(RVK.dom.accessibleName(b))) return true;
    }
    return false;
  }

  function findTileRoot(el) {
    let node = el;
    for (let parent = RVK.dom.composedParent(node); parent; node = parent, parent = RVK.dom.composedParent(node)) {
      if (!parent.children) continue;
      const tileSiblings = [...parent.children].filter(hasTileContent);
      if (tileSiblings.length >= 2) return node;
    }
    return null;
  }

  function cleanLabel(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 48) return '';
    if (SKIP_NAME_RE.test(t)) return '';
    // Instructional / sentence-like a11y copy, not a device name.
    if (/,/.test(t) || /\buse\b/i.test(t) || t.split(/\s+/).length > 5) return '';
    return t;
  }

  // Only high-confidence name sources. Ring often does not expose device names
  // on multi-cam tiles. In that case the popup falls back to "Cam N".
  function cameraName(anchorEl) {
    if (!anchorEl) return '';
    const root = findTileRoot(anchorEl) || anchorEl.parentElement || anchorEl;
    const candidates = [];

    const push = (v) => {
      const c = cleanLabel(v);
      if (c && !candidates.includes(c)) candidates.push(c);
    };

    push(root.getAttribute?.('data-camera-name'));
    push(root.getAttribute?.('data-device-name'));
    push(root.getAttribute?.('data-device-id'));

    for (const el of root.querySelectorAll?.(
      '[data-camera-name], [data-device-name], [data-testid*="device-name"], [data-testid*="camera-name"], [class*="DeviceName"], [class*="deviceName"], [class*="cameraName"]',
    ) || []) {
      push(el.getAttribute?.('data-camera-name'));
      push(el.getAttribute?.('data-device-name'));
      push(el.getAttribute?.('aria-label'));
      push(el.textContent);
    }

    candidates.sort((a, b) => b.length - a.length);
    return candidates[0] || '';
  }

  function findDashboardTitle(doc = globalThis.document) {
    const selectors = [
      'h1',
      'h2',
      '[data-testid*="location"]',
      '[data-testid*="Location"]',
      '[data-testid*="header"] h1',
      '[data-testid*="header"] h2',
      '[class*="Location"]',
      '[class*="locationName"]',
    ];
    for (const sel of selectors) {
      for (const el of RVK.dom.queryAllDeep(sel, doc)) {
        if (!RVK.dom.isVisible(el)) continue;
        const t = cleanLabel(el.textContent);
        if (!t) continue;
        // Location titles can be longer; allow slightly more words than camera names.
        const loose = String(el.textContent || '').replace(/\s+/g, ' ').trim();
        if (SKIP_NAME_RE.test(loose)) continue;
        if (/multi-?cam|live view|^ring$/i.test(loose)) continue;
        if (loose.length <= 64) return loose;
      }
    }
    const title = String(doc.title || '').replace(/\s+/g, ' ').trim();
    if (title && !/^dashboard$/i.test(title) && !SKIP_NAME_RE.test(title)) return title;
    return '';
  }

  function groupIntoTiles(anchors) {
    const tiles = new Map();
    for (const anchor of anchors) {
      const root = findTileRoot(anchor.el);
      let key = 'tile-solo';
      if (root) {
        const parent = RVK.dom.composedParent(root);
        const siblings = [...parent.children].filter(hasTileContent);
        key = `tile-${siblings.indexOf(root)}`;
      }
      const tile = tiles.get(key) || { key };
      if (!tile[anchor.kind]) tile[anchor.kind] = anchor.el;
      if (!tile.label) tile.label = cameraName(anchor.el);
      tiles.set(key, tile);
    }
    return tiles;
  }

  RVK.tiles = { hasTileContent, findTileRoot, groupIntoTiles, cameraName, findDashboardTitle };
})();
