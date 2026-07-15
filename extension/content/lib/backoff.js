// Per-tile exponential backoff with jitter: 2s -> 4s -> ... capped at 5 min.
(() => {
  const RVK = (globalThis.RVK = globalThis.RVK || {});

  function create({ base = 2000, factor = 2, cap = 300000, jitter = 0.25, rng = Math.random } = {}) {
    let attempts = 0;
    return {
      next() {
        const raw = Math.min(cap, base * Math.pow(factor, attempts));
        attempts += 1;
        const scale = 1 + jitter * (rng() * 2 - 1);
        return Math.round(raw * scale);
      },
      reset() {
        attempts = 0;
      },
      get attempts() {
        return attempts;
      },
    };
  }

  RVK.backoff = { create };
})();
