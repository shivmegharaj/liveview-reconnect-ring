// CDP trusted mouse clicks via chrome.debugger.
//
// Ring ignores untrusted DOM events. Input.dispatchMouseEvent is the only
// in-extension path that produces isTrusted=true clicks. We attach only for
// the click, then detach, so the yellow debugging bar is brief, not permanent.
// The bar disappears entirely when this extension is force-installed by an
// enterprise policy, or when Chrome is launched with
// --silent-debugger-extension-api (see README).
(() => {
  function target(tabId) {
    return { tabId };
  }

  async function attach(tabId) {
    try {
      await chrome.debugger.attach(target(tabId), '1.3');
      return { ok: true };
    } catch (e) {
      const message = String(e?.message || e);
      if (/already attached/i.test(message)) return { ok: true, already: true };
      return { ok: false, error: message };
    }
  }

  async function detach(tabId) {
    try {
      await chrome.debugger.detach(target(tabId));
    } catch { /* already detached or tab gone */ }
  }

  async function dispatchClick(tabId, x, y) {
    const t = target(tabId);
    const base = {
      x: Math.round(x),
      y: Math.round(y),
      button: 'left',
      pointerType: 'mouse',
      modifiers: 0,
    };
    await chrome.debugger.sendCommand(t, 'Input.dispatchMouseEvent', {
      ...base, type: 'mouseMoved', buttons: 0,
    });
    await chrome.debugger.sendCommand(t, 'Input.dispatchMouseEvent', {
      ...base, type: 'mousePressed', buttons: 1, clickCount: 1,
    });
    await chrome.debugger.sendCommand(t, 'Input.dispatchMouseEvent', {
      ...base, type: 'mouseReleased', buttons: 0, clickCount: 1,
    });
  }

  async function trustedClick(tabId, x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false, error: 'invalid coordinates' };
    }
    const att = await attach(tabId);
    if (!att.ok) {
      const hint = /Another debugger|already attached|DevTools/i.test(att.error || '')
        ? ' (close DevTools on this Ring tab and retry)'
        : '';
      return { ok: false, error: (att.error || 'attach failed') + hint, stage: 'attach' };
    }
    try {
      await dispatchClick(tabId, x, y);
      return { ok: true, x: Math.round(x), y: Math.round(y) };
    } catch (e) {
      return { ok: false, error: String(e?.message || e), stage: 'dispatch' };
    } finally {
      // Always release so the yellow bar does not linger across the whole profile.
      await detach(tabId);
    }
  }

  globalThis.RVK_trustedClick = trustedClick;
})();
