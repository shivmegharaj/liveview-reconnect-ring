// Clicks Ring UI controls the way a user would, and harder when that isn't enough.
//
// Why multiple strategies: React's delegated listeners usually fire on a full
// untrusted pointer/mouse sequence, but live recon on account.ring.com showed
// tiles staying dead until a *human* click (hypothesis 2 in dom-recon.md). Other
// Ring reconnectors therefore stack sequence + native .click(); we also walk
// React fiber/props and invoke onClick directly, which bypasses any isTrusted
// filter on the DOM event path while still only calling Ring's own handler.
(() => {
  const RVK = (globalThis.RVK = globalThis.RVK || {});

  function hitTarget(el, cx, cy) {
    try {
      // Use the button's own root (document or shadow root) so the hit test
      // resolves inside the same tree.
      const root = el.getRootNode ? el.getRootNode() : el.ownerDocument;
      const scope = typeof root.elementFromPoint === 'function' ? root : el.ownerDocument;
      const hit = scope.elementFromPoint(cx, cy);
      // Only retarget within the button's own subtree/ancestry; an unrelated
      // element at that point means something else covers the button and we
      // still prefer the button itself.
      if (hit && hit !== el && (el.contains(hit) || hit.contains(el))) return hit;
    } catch { /* hit-testing unavailable (e.g. jsdom) */ }
    return el;
  }

  function dispatchPointerSequence(el, clientX, clientY) {
    const win = el.ownerDocument?.defaultView || globalThis;
    const steps = [
      ['pointerover', 'pointer', 0],
      ['mouseover', 'mouse', 0],
      ['pointermove', 'pointer', 0],
      ['mousemove', 'mouse', 0],
      ['pointerdown', 'pointer', 1],
      ['mousedown', 'mouse', 1],
      ['pointerup', 'pointer', 0],
      ['mouseup', 'mouse', 0],
      ['click', 'mouse', 0],
    ];
    for (const [type, kind, buttons] of steps) {
      const init = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX,
        clientY,
        button: 0,
        buttons,
        detail: type === 'click' ? 1 : 0,
      };
      // Omit `view`: jsdom brand-checks it and throws; React never reads it.
      let ev;
      if (kind === 'pointer' && typeof win.PointerEvent === 'function') {
        ev = new win.PointerEvent(type, { ...init, pointerId: 1, isPrimary: true, pointerType: 'mouse' });
      } else {
        ev = new win.MouseEvent(type, init);
      }
      el.dispatchEvent(ev);
    }
  }

  function fakeMouseEvent(target, type = 'click') {
    return {
      type,
      bubbles: true,
      cancelable: true,
      defaultPrevented: false,
      isTrusted: true,
      button: 0,
      buttons: 0,
      detail: 1,
      target,
      currentTarget: target,
      nativeEvent: { isTrusted: true, target, type },
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {},
      stopImmediatePropagation() {},
      persist() {},
    };
  }

  // Call the nearest React onClick (props bag or fiber walk). Content scripts
  // share the DOM node, so __reactProps$ / __reactFiber$ expandos are visible.
  function invokeReactOnClick(el) {
    const seen = new Set();
    let node = el;
    while (node && node !== node.ownerDocument && !seen.has(node)) {
      seen.add(node);
      try {
        for (const key of Reflect.ownKeys(node)) {
          if (typeof key !== 'string') continue;
          if (key.startsWith('__reactProps$') || key.startsWith('__reactEventHandlers$')) {
            const props = node[key];
            if (props && typeof props.onClick === 'function') {
              props.onClick(fakeMouseEvent(node));
              return { via: 'props', key, tag: node.tagName?.toLowerCase() };
            }
          }
          if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
            let fiber = node[key];
            let depth = 0;
            while (fiber && depth < 40) {
              const props = fiber.memoizedProps || fiber.pendingProps;
              if (props && typeof props.onClick === 'function') {
                props.onClick(fakeMouseEvent(node));
                return { via: 'fiber', tag: node.tagName?.toLowerCase(), depth };
              }
              fiber = fiber.return;
              depth += 1;
            }
          }
        }
      } catch { /* props threw or non-configurable keys; keep walking */ }
      node = node.parentElement || (node.getRootNode?.()?.host ?? null);
    }
    return null;
  }

  function clickPoint(el) {
    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    return {
      x: rect.left + (rect.width / 2 || 0),
      y: rect.top + (rect.height / 2 || 0),
      width: rect.width,
      height: rect.height,
    };
  }

  // Ask the service worker to fire a real (isTrusted) mouse click at the
  // element's center via CDP. Resolves with { ok, error?, x?, y? }.
  function requestTrustedClick(el, chromeApi = globalThis.chrome) {
    const { x, y } = clickPoint(el);
    return new Promise((resolve) => {
      try {
        const p = chromeApi?.runtime?.sendMessage?.({ type: 'trusted_click', x, y });
        if (p && typeof p.then === 'function') {
          p.then((res) => resolve(res || { ok: false, error: 'empty response' }))
            .catch((e) => resolve({ ok: false, error: String(e?.message || e) }));
          return;
        }
        // MV3 callback style
        chromeApi.runtime.sendMessage({ type: 'trusted_click', x, y }, (res) => {
          const err = chromeApi.runtime?.lastError;
          if (err) resolve({ ok: false, error: err.message });
          else resolve(res || { ok: false, error: 'empty response' });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e?.message || e) });
      }
    });
  }

  function clickSequence(el, opts = {}) {
    const retryMs = opts.retryMs === undefined ? 150 : opts.retryMs;
    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    const clientX = rect.left + (rect.width / 2 || 0);
    const clientY = rect.top + (rect.height / 2 || 0);
    const target = hitTarget(el, clientX, clientY);
    const strategies = [];

    try { el.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'instant' }); } catch { /* best-effort */ }
    try { el.focus?.(); } catch { /* focus is best-effort */ }

    try {
      dispatchPointerSequence(target, clientX, clientY);
      strategies.push('pointer-sequence');
    } catch { /* fall through */ }

    // Native click on the matched control (and hit target if different).
    try {
      if (typeof el.click === 'function') {
        el.click();
        strategies.push('native-click');
      }
    } catch { /* ignore */ }
    if (target !== el) {
      try {
        if (typeof target.click === 'function') {
          target.click();
          strategies.push('native-click-retarget');
        }
      } catch { /* ignore */ }
    }

    // Direct React handler when Ring ignores untrusted DOM events.
    const reactHit = invokeReactOnClick(target) || (target !== el ? invokeReactOnClick(el) : null);
    if (reactHit) strategies.push(`react-${reactHit.via}`);

    // Short delayed retry: first paint after a dead-tile swap sometimes
    // attaches the handler a tick later (proven useful in HairyDuck's reconnector).
    if (retryMs > 0 && typeof setTimeout === 'function') {
      try {
        setTimeout(() => {
          try { dispatchPointerSequence(target, clientX, clientY); } catch { /* ignore */ }
          try { el.click?.(); } catch { /* ignore */ }
          try { invokeReactOnClick(target) || invokeReactOnClick(el); } catch { /* ignore */ }
        }, retryMs);
        strategies.push(`retry-${retryMs}ms`);
      } catch { /* ignore */ }
    }

    return {
      retargeted: target !== el,
      targetDescription: target === el ? null : `${target.tagName?.toLowerCase()}${target.className ? '.' + String(target.className).split(/\s+/).join('.') : ''}`,
      strategies,
      react: reactHit,
    };
  }

  RVK.actuator = { clickSequence, invokeReactOnClick, requestTrustedClick, clickPoint };
})();
