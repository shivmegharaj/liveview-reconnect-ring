// Frame-progress liveness probe: "healthy" must mean frames are advancing,
// not merely that no Reconnect button is visible.
(() => {
  const RVK = (globalThis.RVK = globalThis.RVK || {});

  function sample(video) {
    let frames = null;
    try {
      if (typeof video.getVideoPlaybackQuality === 'function') {
        frames = video.getVideoPlaybackQuality().totalVideoFrames;
      } else if (typeof video.webkitDecodedFrameCount === 'number') {
        frames = video.webkitDecodedFrameCount;
      }
    } catch { /* stay with currentTime only */ }
    return {
      t: video.currentTime || 0,
      frames,
      readyState: video.readyState || 0,
      at: 0,
    };
  }

  function isAdvancing(prev, cur) {
    if (!prev) return true;
    if (cur.frames != null && prev.frames != null && cur.frames !== prev.frames) {
      return cur.frames > prev.frames;
    }
    return cur.t > prev.t + 0.05;
  }

  RVK.liveness = { sample, isAdvancing };
})();
