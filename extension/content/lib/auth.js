// Signed-out detection. The extension never logs in; it only detects and alerts.
(() => {
  const RVK = (globalThis.RVK = globalThis.RVK || {});

  const SIGNIN_RE = /\b(sign in|log in|login)\b/i;

  function isSignedOutDoc(doc = globalThis.document) {
    const pw = doc.querySelector('input[type="password"]');
    if (pw && RVK.dom.isVisible(pw)) return true;
    // A dashboard with live video is never "signed out" even if a stray
    // sign-in link exists somewhere in the page chrome.
    if (doc.querySelector('video')) return false;
    for (const el of doc.querySelectorAll('button, a, [role="button"]')) {
      if (RVK.dom.isVisible(el) && SIGNIN_RE.test(RVK.dom.accessibleName(el))) return true;
    }
    return false;
  }

  RVK.auth = { isSignedOutDoc };
})();
