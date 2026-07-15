// The watchdog lives here, in the content script (page lifetime), never in
// service-worker timers, which die after ~30s idle. Adaptive poll plus a
// debounced MutationObserver trigger.
(() => {
  const RVK = (globalThis.RVK = globalThis.RVK || {});

  const DEFAULTS = {
    slowMs: 6000,          // poll cadence when everything is healthy
    fastMs: 1500,          // poll cadence while any tile is unhealthy
    verifyMs: 12000,       // how long after a click before declaring the attempt failed
                           // (WebRTC renegotiation can take ~10s; too short over-counts failures)
    alertAfter: 5,         // consecutive failures before notifying the operator
    modalCooldownMs: 10000,
    clickRetryMs: 150,     // second actuation pass shortly after the first (handler attach race)
    staleRecordMs: 8000,   // drop tile records not seen for this long (layout changed)
    authStreakNeeded: 2,   // consecutive signed-out scans before alerting
    frozenStrikesDead: 4,  // stalled scans before declaring the tile frozen
    startLiveCooldownMs: 15000, // between "Start Live Views" clicks when kicked to Dashboard
  };

  function createWatchdog(opts = {}) {
    const cfg = { ...DEFAULTS, ...opts };
    const doc = cfg.doc || globalThis.document;
    const chromeApi = cfg.chrome !== undefined ? cfg.chrome : globalThis.chrome;
    const now = cfg.now || (() => Date.now());

    const records = new Map();
    const events = [];
    let enabled = true;
    let authStreak = 0;
    let authReported = false;
    let lastModalClick = 0;
    let lastStartLiveClick = -Infinity; // allow the first Start-Live-Views click immediately
    let lastTileCount = -1;
    let timer = null;
    let observer = null;
    let observerQueued = false;
    let onWake = null;
    let stopped = false;
    let scanning = false;
    let onMessage = null;

    function logEvent(msg) {
      events.push({ at: now(), msg });
      if (events.length > 30) events.shift();
    }

    function snippet(el) {
      try {
        return (el.outerHTML || '').slice(0, 300);
      } catch {
        return '';
      }
    }

    function send(msg) {
      try {
        const p = chromeApi?.runtime?.sendMessage?.(msg);
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch { /* extension reloaded or SW unreachable; next scan retries */ }
    }

    function getRecord(key) {
      let rec = records.get(key);
      if (!rec) {
        rec = {
          key,
          label: '',
          state: new RVK.TileState({
            key,
            backoff: RVK.backoff.create(cfg.backoffOpts),
            alertAfter: cfg.alertAfter,
            verifyMs: cfg.verifyMs,
          }),
          prev: null,
          frozenStrikes: 0,
          lastSeen: 0,
          buttonSnippet: '',
        };
        records.set(key, rec);
      }
      return rec;
    }

    function alertTile(rec, extra = {}) {
      send({
        type: 'tile_alert',
        key: rec.key,
        failStreak: rec.state.failStreak,
        snippet: rec.buttonSnippet,
        ...extra,
      });
    }

    function handleDeadTile(rec, button, t) {
      const st = rec.state;
      rec.buttonSnippet = snippet(button);
      if (st.status === 'verifying') {
        // We clicked, yet the button is still (or again) there past the deadline.
        if (t >= st.verifyDeadline) {
          const streak = st.markVerifyFailed(t);
          logEvent(`${rec.key}: reconnect failed: button still present (streak ${streak})`, {
            nextAttemptInMs: st.nextAttemptAt - t,
            button: rec.buttonSnippet,
          });
          if (st.shouldAlert()) alertTile(rec);
        }
      } else {
        st.markDead(t);
      }
      if (st.canAttempt(t)) {
        // Scroll into view + best-effort synthetic click (cheap; also positions
        // the element), then the CDP trusted click (the only thing Ring honors).
        RVK.actuator.clickSequence(button, { retryMs: cfg.clickRetryMs });
        st.markAttempt(t);
        logEvent(`${rec.key}: clicking Reconnect`, { button: rec.buttonSnippet });
        const pending = RVK.actuator.requestTrustedClick(button, chromeApi);
        if (pending && typeof pending.then === 'function') {
          pending.then((res) => {
            logEvent(
              res?.ok
                ? `${rec.key}: trusted click at (${res.x},${res.y})`
                : `${rec.key}: trusted click FAILED: ${res?.error || 'unknown'}`,
              res,
            );
          });
        }
      }
    }

    function handleLiveTile(rec, video, t) {
      const st = rec.state;
      const sample = RVK.liveness.sample(video);
      sample.at = t;

      if (st.status === 'verifying' || st.status === 'dead') {
        // Recovery must be proven by frame progress, not button absence.
        const advancing = rec.prev ? RVK.liveness.isAdvancing(rec.prev, sample) : false;
        if (advancing && sample.readyState >= 2) {
          st.markRecovered();
          rec.frozenStrikes = 0;
          logEvent(`${rec.key}: recovered (frames advancing)`, {
            currentTime: sample.t,
            frames: sample.frames,
            readyState: sample.readyState,
          });
        } else if (st.status === 'verifying' && t >= st.verifyDeadline) {
          const streak = st.markVerifyFailed(t);
          logEvent(`${rec.key}: video present but no frame progress (streak ${streak})`, {
            currentTime: sample.t,
            frames: sample.frames,
            readyState: sample.readyState,
            prevSample: rec.prev && { currentTime: rec.prev.t, frames: rec.prev.frames },
          });
          if (st.shouldAlert()) alertTile(rec);
        }
      } else {
        const advancing = RVK.liveness.isAdvancing(rec.prev, sample);
        if (rec.prev && !advancing && sample.readyState >= 2) {
          rec.frozenStrikes += 1;
          if (rec.frozenStrikes >= cfg.frozenStrikesDead && st.status !== 'frozen') {
            st.markFrozen();
            logEvent(`${rec.key}: frozen stream, no reconnect control visible`);
            alertTile(rec, { frozen: true });
          }
        } else if (advancing) {
          rec.frozenStrikes = 0;
          if (st.status === 'frozen') {
            st.markUnfroze();
            logEvent(`${rec.key}: stream resumed`);
          }
        }
      }
      rec.prev = sample;
    }

    function scan(opts = {}) {
      // Extension reloaded/updated? This instance is orphaned (its chrome APIs
      // are dead) and a fresh script is being injected: stop, don't double-click.
      if (chromeApi && chromeApi.runtime && !chromeApi.runtime.id) {
        if (!stopped) {
          if (debug) {
            try { console.log('[RVK] extension was reloaded; old watchdog instance shutting down'); } catch { /* ignore */ }
          }
          stop();
        }
        return;
      }
      if (stopped || scanning) return;
      scanning = true;
      try {
        scanBody(opts);
      } catch { /* never let one bad scan kill the watchdog */ }
      finally {
        scanning = false;
      }
    }

    function scanBody(opts = {}) {
      const t = now();
      if (!enabled) {
        report(t);
        return;
      }

      if (RVK.auth.isSignedOutDoc(doc)) {
        authStreak += 1;
        if (authStreak >= cfg.authStreakNeeded && !authReported) {
          authReported = true;
          logEvent('Signed-out page detected; operator action needed');
          send({ type: 'auth_lost', url: doc.location?.href || '' });
        }
        report(t);
        return;
      }
      authStreak = 0;
      authReported = false;

      const buttons = RVK.matcher.findReconnectButtons(doc);
      const videos = RVK.dom.queryAllDeep('video', doc).filter(RVK.dom.isVisible);

      // Kicked back to the plain Dashboard (session token expired): no live
      // tiles, but a "Start Live Views" control is present. Click it to re-enter
      // the Multi-Cam grid. A reload would NOT do this; the token is single-use.
      if (videos.length === 0 && buttons.length === 0) {
        const startBtn = RVK.matcher.findStartLiveView(doc);
        if (startBtn && t - lastStartLiveClick >= cfg.startLiveCooldownMs) {
          lastStartLiveClick = t;
          RVK.actuator.clickSequence(startBtn, { retryMs: cfg.clickRetryMs });
          logEvent('on Dashboard (live view expired); clicking "Start Live Views"');
          const pending = RVK.actuator.requestTrustedClick(startBtn, chromeApi);
          if (pending && typeof pending.then === 'function') {
            pending.then((res) => {
              logEvent(
                res?.ok
                  ? `Start Live Views trusted click at (${res.x},${res.y})`
                  : `Start Live Views trusted click FAILED: ${res?.error || 'unknown'}`,
                res,
              );
            });
          }
          send({ type: 'start_live_view' });
          report(t);
          return;
        }
      }

      const anchors = [
        ...videos.map((el) => ({ el, kind: 'video' })),
        ...buttons.map((el) => ({ el, kind: 'button' })),
      ];
      const tiles = RVK.tiles.groupIntoTiles(anchors);
      const seenKeys = new Set(tiles.keys());

      if (tiles.size !== lastTileCount) {
        logEvent(`tracking ${tiles.size} tile(s): ${[...tiles.keys()].sort().join(', ')}`, {
          videos: videos.length,
          reconnectButtons: buttons.length,
        });
        lastTileCount = tiles.size;
      }

      for (const tile of tiles.values()) {
        const rec = getRecord(tile.key);
        rec.lastSeen = t;
        if (tile.label) rec.label = tile.label;
        if (tile.button) handleDeadTile(rec, tile.button, t);
        else if (tile.video) handleLiveTile(rec, tile.video, t);
      }

      const modal = RVK.matcher.findModalAccept(doc);
      if (modal && t - lastModalClick >= cfg.modalCooldownMs) {
        RVK.actuator.clickSequence(modal, { retryMs: cfg.clickRetryMs });
        const pending = RVK.actuator.requestTrustedClick(modal, chromeApi);
        if (pending && typeof pending.then === 'function') {
          pending.then((res) => {
            logEvent(
              res?.ok
                ? `Accepted live-view dialog (trusted) at (${res.x},${res.y})`
                : `Modal trusted click FAILED: ${res?.error || 'unknown'}`,
              res,
            );
          });
        }
        lastModalClick = t;
        logEvent(`Accepted live-view dialog: ${snippet(modal).slice(0, 120)}`);
      }

      for (const [key, rec] of records) {
        if (seenKeys.has(key)) continue;
        // Refresh / layout change: drop immediately. Otherwise wait a short grace
        // so a mid-reconnect DOM swap does not wipe the tile record.
        if (opts.forcePrune || t - rec.lastSeen > cfg.staleRecordMs) {
          records.delete(key);
        }
      }

      report(t);
    }

    function report(t) {
      const pageTitle = RVK.tiles.findDashboardTitle(doc) || doc.title || '';
      send({
        type: 'report',
        at: t,
        title: pageTitle,
        url: doc.location?.href || '',
        enabled,
        signedOut: authReported,
        tiles: [...records.values()].map((rec) => ({
          key: rec.key,
          label: rec.label || '',
          status: rec.state.status,
          reconnects: rec.state.reconnectCount,
          failStreak: rec.state.failStreak,
        })),
        lastEvent: events.length ? events[events.length - 1] : null,
      });
    }

    function currentIntervalMs() {
      if (authReported) return cfg.slowMs;
      for (const rec of records.values()) {
        if (rec.state.status !== 'healthy') return cfg.fastMs;
      }
      return cfg.slowMs;
    }

    function loop() {
      try {
        scan();
      } catch { /* never let one bad scan kill the watchdog */ }
      if (!stopped) timer = setTimeout(loop, currentIntervalMs());
    }

    function start() {
      const version = (() => {
        try { return chromeApi?.runtime?.getManifest?.()?.version || 'dev'; } catch { return 'dev'; }
      })();
      logEvent(`watchdog started (v${version}) on ${doc.location?.href || 'unknown page'}`);
      try {
        chromeApi?.storage?.local?.get?.(
          { rvk_enabled: true },
          (v) => {
            enabled = v?.rvk_enabled !== false;
          },
        );
        chromeApi?.storage?.onChanged?.addListener?.((changes, area) => {
          if (area !== 'local') return;
          if ('rvk_enabled' in changes) {
            enabled = changes.rvk_enabled.newValue !== false;
            logEvent(enabled ? 'Watchdog enabled' : 'Watchdog paused by operator');
            report(now());
          }
        });
      } catch { /* still run with defaults */ }

      try {
        onMessage = (msg) => {
          if (msg?.type === 'rescan') {
            try { scan({ forcePrune: true }); } catch { /* keep listening */ }
          }
        };
        chromeApi?.runtime?.onMessage?.addListener?.(onMessage);
      } catch { /* optional */ }

      const win = doc.defaultView || globalThis;
      if (typeof win.MutationObserver === 'function') {
        observer = new win.MutationObserver(() => {
          if (observerQueued) return;
          observerQueued = true;
          setTimeout(() => {
            observerQueued = false;
            try {
              scan();
            } catch { /* keep observing */ }
          }, 250);
        });
        observer.observe(doc.body || doc.documentElement, { childList: true, subtree: true });
      }

      // Chrome throttles timers in hidden tabs (down to ~1/min), and Ring's
      // streams time out while a window is covered. Rescan the instant the
      // page becomes visible or focused again so recovery starts immediately.
      onWake = () => {
        if (!doc.hidden) {
          try {
            scan();
          } catch { /* keep listening */ }
        }
      };
      doc.addEventListener?.('visibilitychange', onWake);
      win.addEventListener?.('focus', onWake);

      loop();
    }

    function stop() {
      if (stopped) return;
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      observer?.disconnect();
      observer = null;
      if (onWake) {
        doc.removeEventListener?.('visibilitychange', onWake);
        (doc.defaultView || globalThis).removeEventListener?.('focus', onWake);
        onWake = null;
      }
      if (onMessage) {
        try { chromeApi?.runtime?.onMessage?.removeListener?.(onMessage); } catch { /* ignore */ }
        onMessage = null;
      }
    }

    return {
      start,
      stop,
      scan,
      records,
      events,
      get enabled() { return enabled; },
      set enabled(v) { enabled = v; },
    };
  }

  RVK.createWatchdog = createWatchdog;

  // Auto-start only inside a real extension context on Ring's site. The
  // __RVK_STARTED__ guard makes injection idempotent within one isolated
  // world (manifest injection + scripting.executeScript can both run).
  if (
    typeof chrome !== 'undefined' &&
    chrome?.runtime?.id &&
    /(^|\.)ring\.com$/.test(globalThis.location?.hostname || '') &&
    !globalThis.__RVK_STARTED__
  ) {
    globalThis.__RVK_STARTED__ = true;
    RVK._instance = createWatchdog();
    RVK._instance.start();
  }
})();
