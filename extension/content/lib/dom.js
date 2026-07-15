// DOM helpers: open-shadow-root-piercing queries, accessible names, visibility.
(() => {
  const RVK = (globalThis.RVK = globalThis.RVK || {});

  // Query across the document and every reachable OPEN shadow root.
  // Closed roots are invisible here by design (Phase 4 handles those if recon finds any).
  function queryAllDeep(selector, root = globalThis.document) {
    const out = [];
    const stack = [root];
    while (stack.length) {
      const r = stack.pop();
      if (!r || !r.querySelectorAll) continue;
      out.push(...r.querySelectorAll(selector));
      for (const el of r.querySelectorAll('*')) {
        if (el.shadowRoot) stack.push(el.shadowRoot);
      }
    }
    return out;
  }

  function accessibleName(el) {
    if (!el || !el.getAttribute) return '';
    const label = el.getAttribute('aria-label');
    if (label && label.trim()) return label.trim();
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const doc = el.ownerDocument;
      const text = labelledBy
        .split(/\s+/)
        .map((id) => doc.getElementById(id)?.textContent || '')
        .join(' ')
        .trim();
      if (text) return text;
    }
    return (el.textContent || '').trim();
  }

  // Parent that crosses open shadow boundaries (shadow root -> host).
  function composedParent(node) {
    if (!node) return null;
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode ? node.getRootNode() : null;
    return root && root.host ? root.host : null;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const win = el.ownerDocument?.defaultView;
    for (let n = el; n && n.nodeType === 1; n = composedParent(n)) {
      if (n.hidden) return false;
      if (n.getAttribute && n.getAttribute('aria-hidden') === 'true') return false;
      const cs = win?.getComputedStyle ? win.getComputedStyle(n) : null;
      if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
    }
    return true;
  }

  RVK.dom = { queryAllDeep, accessibleName, composedParent, isVisible };
})();
