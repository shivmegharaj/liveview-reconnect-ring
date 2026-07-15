// Per-tile state machine: healthy -> dead -> verifying -> healthy | dead(backoff),
// plus a frozen state for stalled streams that never show a Reconnect button.
(() => {
  const RVK = (globalThis.RVK = globalThis.RVK || {});

  class TileState {
    constructor({ key, backoff, alertAfter = 5, verifyMs = 8000 } = {}) {
      this.key = key;
      this.status = 'healthy';
      this.backoff = backoff || RVK.backoff.create();
      this.alertAfter = alertAfter;
      this.verifyMs = verifyMs;
      this.reconnectCount = 0;
      this.failStreak = 0;
      this.nextAttemptAt = 0;
      this.verifyDeadline = 0;
      this.alerted = false;
    }

    markDead(now) {
      if (this.status === 'healthy' || this.status === 'frozen') {
        this.status = 'dead';
        this.nextAttemptAt = now; // first attempt is immediate
      }
    }

    canAttempt(now) {
      return this.status === 'dead' && now >= this.nextAttemptAt;
    }

    markAttempt(now) {
      this.status = 'verifying';
      this.verifyDeadline = now + this.verifyMs;
    }

    markVerifyFailed(now) {
      this.status = 'dead';
      this.failStreak += 1;
      this.nextAttemptAt = now + this.backoff.next();
      return this.failStreak;
    }

    markRecovered() {
      this.status = 'healthy';
      this.failStreak = 0;
      this.alerted = false;
      this.reconnectCount += 1;
      this.backoff.reset();
    }

    markFrozen() {
      if (this.status === 'healthy') this.status = 'frozen';
    }

    markUnfroze() {
      if (this.status === 'frozen') this.status = 'healthy';
    }

    shouldAlert() {
      if (this.failStreak >= this.alertAfter && !this.alerted) {
        this.alerted = true;
        return true;
      }
      return false;
    }
  }

  RVK.TileState = TileState;
})();
