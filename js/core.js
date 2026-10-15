// Core: global namespace, math helpers, input, fixed-timestep loop.
window.Game = window.Game || {};

(function (G) {
  G.STEP = 1 / 60;
  G.TEAM = { PLAYER: 0, ENEMY: 1, NEUTRAL: 2 };

  // World scale: 50 game units = 1 meter. Design talk (speeds, sizes, ranges)
  // is in meters; code values stay in game units. Speeds are units/sec,
  // so 2 m/s = 100 here. Use G.m(x) to write a meter value in code.
  G.UNITS_PER_METER = 50;
  G.m = (meters) => meters * G.UNITS_PER_METER;
  G.toMeters = (units) => units / G.UNITS_PER_METER;

  G.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  G.dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  G.lerp = (a, b, t) => a + (b - a) * t;

  // Deterministic RNG so the map is the same every load.
  G.rng = function (seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // ---- Input ----
  const input = {
    mouse: { x: 0, y: 0, inside: false },
    keys: {},       // held
    pressed: {},    // went down since last update step
    rightClicks: [], // screen positions
    leftClicks: [],
    wheel: 0        // accumulated scroll delta since last update step
  };
  G.input = input;

  G.initInput = function (canvas) {
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('mousemove', e => {
      input.mouse.x = e.offsetX;
      input.mouse.y = e.offsetY;
      input.mouse.inside = true;
    });
    canvas.addEventListener('wheel', e => { input.wheel += e.deltaY; e.preventDefault(); }, { passive: false });
    canvas.addEventListener('mouseleave', () => { input.mouse.inside = false; });
    canvas.addEventListener('mousedown', e => {
      input.mouse.x = e.offsetX;
      input.mouse.y = e.offsetY;
      if (e.button === 0) input.leftClicks.push({ x: e.offsetX, y: e.offsetY });
      if (e.button === 2) input.rightClicks.push({ x: e.offsetX, y: e.offsetY });
    });
    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if (!input.keys[k]) input.pressed[k] = true;
      input.keys[k] = true;
      if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', e => { input.keys[e.key.toLowerCase()] = false; });
    window.addEventListener('blur', () => { input.keys = {}; input.mouse.inside = false; });
  };

  // ---- Loop ----
  // With G.keepAlive (a network host: everyone's game runs on it), the world keeps stepping when the
  // browser stops animation frames (tab hidden, window minimized): a worker timer stands in for them.
  G.startLoop = function (update, render) {
    let last = performance.now(), lastFrame = last;
    let acc = 0;
    function advance(now) {
      if (now <= last) return;   // a frame stamped before a worker tick that already ran
      acc += Math.min((now - last) / 1000, 0.25);
      last = now;
      // Cap catch-up steps: after a slow frame, running a dozen updates back to back only makes the
      // next frame slower too. Past the cap the simulation briefly runs slow instead.
      let steps = 0;
      while (acc >= G.STEP && steps++ < 4) {
        update(G.STEP);
        input.pressed = {};
        input.rightClicks.length = 0;
        input.leftClicks.length = 0;
        input.wheel = 0;
        acc -= G.STEP;
      }
      if (acc >= G.STEP) acc = 0;
    }
    function frame(now) {
      const t0 = lastFrame = performance.now();
      advance(now);
      render();
      G.frameCost = performance.now() - t0;  // ms of the game's own work this frame (see adaptResolution)
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    if (G.keepAlive) {
      const tick = () => { const now = performance.now(); if (now - lastFrame > 100) advance(now); };
      const fallback = () => setInterval(tick, 40);   // throttled in hidden tabs, but better than stopping
      try {
        const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 40);'], { type: 'text/javascript' }));
        const w = new Worker(url);
        w.onmessage = tick;
        w.onerror = fallback;
      } catch (e) { fallback(); }
    }
  };
})(window.Game);
