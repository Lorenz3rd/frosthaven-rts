// Settings & pause: developer mode, control scheme (mouse + keyboard or controller), and the pause menu.
// Controller input is polled once per update step into G.pad.
(function (G) {
  function load(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch (e) { return fallback; } }
  function save(key, v) { try { localStorage.setItem(key, v); } catch (e) { /* storage blocked: setting lasts this session */ } }

  // Developer mode: heroes can't be targeted or hurt, gold is unlimited, and the hero
  // can build and tear down buildings for either side.
  G.dev = load('frost.dev', '0') === '1';
  G.setDev = function (on) {
    G.dev = on; save('frost.dev', on ? '1' : '0');
    if (on) for (const e of G.entities) if (e instanceof G.Hero) { e.hp = e.maxHp; }
    document.body.classList.toggle('dev-mode', on);
  };

  // 'mkb' or 'pad'
  G.controlScheme = load('frost.controls', 'mkb');
  G.setControlScheme = function (s) {
    G.controlScheme = s; save('frost.controls', s);
    document.body.classList.toggle('pad-scheme', s === 'pad');
  };

  // Ability confirm before cast: the first press of an ability shows where it will land (G.castPreview),
  // the same button again casts it, anything else cancels it.
  G.confirmCast = load('frost.confirmCast', '0') === '1';
  G.showMinimap = load('frost.showMinimap', '1') === '1';
  G.setShowMinimap = function (on) {
    G.showMinimap = on; save('frost.showMinimap', on ? '1' : '0');
    document.body.classList.toggle('no-minimap', !on);
  };
  G.setConfirmCast = function (on) {
    G.confirmCast = on; save('frost.confirmCast', on ? '1' : '0');
    if (!on) for (const p of G.players || []) p.pendingCast = null;
  };

  // ---- Controller ----
  // Standard mapping (Xbox layout).
  const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
  G.PAD_BTN = BTN;
  const DEAD = 0.2;
  // move/look: stick vectors with dead zone. down[i]: pressed this step. held[i]: held now.
  // G.makePad(index): a controller's state, read from the Gamepad API by poll(). With `fallback`, any
  // connected pad stands in when that index isn't there (one-player games); split screen sticks to its own.
  G.makePad = function (index, fallback) {
    let prev = [];
    const pad = {
      index, connected: false, move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, down: [], held: [],
      poll() {
        const pads = Array.from(navigator.getGamepads ? navigator.getGamepads() : []).filter(Boolean);
        const p = pads.find(q => q.index === pad.index) || (fallback ? pads[0] : null) || null;
        pad.connected = !!p;
        if (!p) { pad.move = pad.look = { x: 0, y: 0 }; pad.down = []; pad.held = []; prev = []; return; }
        pad.held = p.buttons.map(b => b.pressed);
        pad.down = pad.held.map((h, i) => h && !prev[i]);
        prev = pad.held;
        pad.move = stick(p.axes[0] || 0, p.axes[1] || 0);
        pad.look = stick(p.axes[2] || 0, p.axes[3] || 0);
      }
    };
    return pad;
  };
  G.pad = G.makePad(null, true);

  function stick(x, y) {
    const m = Math.hypot(x, y);
    if (m < DEAD) return { x: 0, y: 0 };
    const k = Math.min(1, (m - DEAD) / (1 - DEAD)) / m;
    return { x: x * k, y: y * k };
  }

  G.pollPad = function () {
    G.pad.index = G.matchConfig && G.matchConfig.sides ? G.matchConfig.sides[0].gamepad : null;
    G.pad.poll();
  };

  // ---- Pause menu ----
  G.paused = false;
  let el, focusIdx = 0;

  function buttons() { return Array.from(el.querySelectorAll('button:not([hidden]), select')); }
  // Split screen (local multiplayer): each player's scheme is fixed (a controller, or the mouse and
  // keyboard for one of them), so the scheme toggle is hidden and any player's controller drives the menu.
  const split = () => !!G.players && G.players.length > 1;
  // Network games (see net.js) keep running under the menu, have no developer mode and can be left.
  const netGame = () => /^net/.test((G.matchConfig && G.matchConfig.mode) || '');
  function padsDown() {
    if (!split()) return G.pad.down;
    const d = [];
    for (const p of G.players) p.pad.down.forEach((v, i) => { d[i] = d[i] || v; });
    return d;
  }
  const padHelp = ab => `Left stick move · Ⓐ attack nearest · Ⓧ ${ab[0]} · Ⓨ ${ab[1]} · Ⓑ ${ab[2]} · RB ${ab[3]} (aim with the left stick: tilt further to cast further) · L3 (click left stick) call the nearest group to follow · D-pad orders for your groups: ▼ cancel, ◀ guard, ▶ alert, ▲ charge · LB build menu at a slot (stick + Ⓐ to pick, LB to close) · LT/RT zoom · ☰ pause`;

  const mkbHelp = ab => `Right-click move · Left-click attack / build · Q ${ab[0]} · W ${ab[1]} · E ${ab[2]} · R ${ab[3]} (aim with the cursor) · F call the nearest group to follow · orders for your groups: 1 cancel, 2 guard, 3 alert, 4 charge · P or Esc pause`;

  function render() {
    el.querySelector('.result').textContent = netGame() ? 'Menu · the battle goes on' : 'Paused';
    el.querySelector('[data-act="leave"]').hidden = !netGame();
    el.querySelector('[data-act="leave"]').textContent = G.net && G.net.role === 'host' ? 'End game for everyone' : 'Leave game';
    const cc = el.querySelector('[data-act="confirm"]');
    cc.textContent = 'Ability confirm before cast: ' + (G.confirmCast ? 'On' : 'Off');
    cc.classList.toggle('on', G.confirmCast);
    const mm = el.querySelector('[data-act="minimap"]');
    mm.textContent = 'Mini map: ' + (G.showMinimap ? 'On' : 'Off');
    mm.classList.toggle('on', G.showMinimap);
    if (split()) {
      el.querySelector('[data-act="dev"]').textContent = 'Developer mode: ' + (G.dev ? 'On' : 'Off');
      el.querySelector('[data-act="dev"]').classList.toggle('on', G.dev);
      el.querySelector('[data-act="controls"]').hidden = true;
      el.querySelector('.padState').textContent = G.players.map(p => `${p.label}: ${p.keyboard ? 'mouse & keyboard' : p.pad.connected ? 'controller connected' : 'controller missing, press a button on it'}`).join(' · ');
      // One mouse-and-keyboard player: help for each player's scheme. Otherwise the shared controller help.
      const kb = G.players.find(p => p.keyboard), padAb = ['ability 1', 'ability 2', 'ability 3', 'ultimate'];
      el.querySelector('.help').innerHTML = kb
        ? G.players.map(p => `<b>${p.label}:</b> ` + (p.keyboard ? mkbHelp(p.hero.def.abilities.map(a => a.name)) : padHelp(padAb))).join('<br><br>')
        : padHelp(padAb);
      return;
    }
    el.querySelector('[data-act="dev"]').textContent = 'Developer mode: ' + (G.dev ? 'On' : 'Off');
    el.querySelector('[data-act="dev"]').classList.toggle('on', G.dev);
    el.querySelector('[data-act="dev"]').hidden = netGame();
    el.querySelector('[data-act="controls"]').textContent = 'Controls: ' + (G.controlScheme === 'pad' ? 'Controller' : 'Mouse & Keyboard');
    el.querySelector('.padState').textContent = G.controlScheme === 'pad'
      ? (G.pad.connected ? 'Controller connected' : 'No controller detected: press a button on it')
      : '';
    if (netGame() && G.net.role === 'client') {
      // Connection to the host: route, round trip and how far behind the smoothing runs.
      const l = G.net.lag(), route = { lan: 'same Wi-Fi', direct: 'internet', relay: 'relayed' }[l.route] || 'measuring…';
      el.querySelector('.padState').textContent += (G.controlScheme === 'pad' ? ' · ' : '') +
        `Connection to host: ${route}${l.ping !== null ? ` · ${l.ping} ms` : ''} · smoothing ${l.smoothMs} ms`;
    }
    const ab = G.hero ? G.hero.def.abilities.map(a => a.name) : ['Q', 'W', 'E', 'R'];
    el.querySelector('.help').innerHTML = G.controlScheme === 'pad' ? padHelp(ab) : mkbHelp(ab);
    if (G.confirmCast) el.querySelector('.help').innerHTML += ' · Ability confirm: press an ability to preview it, press it again to cast, anything else cancels';
  }

  G.setPaused = function (on) {
    if (G.winner !== null && on) return;
    G.paused = on;
    el.hidden = !on;
    if (on) { for (const p of G.players || []) { p.menu.close(); p.pendingCast = null; } render(); focusIdx = 0; buttons()[0].focus(); }
  };

  function act(name) {
    if (name === 'resume') G.setPaused(false);
    if (name === 'leave') { G.net.leave(); G.net.backToMenu(); return; }
    if (name === 'dev') {
      if (netGame()) return;
      G.setDev(!G.dev); render();
      for (const h of G.players.map(p => p.hero)) G.floaters.push({ x: h.x, y: h.y - 40, text: 'Developer mode ' + (G.dev ? 'on' : 'off'), t: 0, color: '#ffd27a' });
    }
    if (name === 'confirm') { G.setConfirmCast(!G.confirmCast); render(); }
    if (name === 'minimap') { G.setShowMinimap(!G.showMinimap); render(); }
    if (name === 'controls') { G.setControlScheme(G.controlScheme === 'pad' ? 'mkb' : 'pad'); render(); }
  }

  G.pauseMenu = {
    init() {
      el = document.getElementById('pauseMenu');
      el.addEventListener('click', e => { const b = e.target.closest('button[data-act]'); if (b) act(b.dataset.act); });
      document.getElementById('pauseBtn').addEventListener('click', () => G.setPaused(!G.paused));
      document.body.classList.toggle('dev-mode', G.dev);
      document.body.classList.toggle('no-minimap', !G.showMinimap);
      document.body.classList.toggle('pad-scheme', G.controlScheme === 'pad');
    },

    // Called every update step (also while paused). Returns true while the game is paused.
    update() {
      const p = G.input.pressed, d = padsDown();
      if (p.f9) act('dev');
      if (p.p || d[BTN.START] || (p.escape && !G.buildMenu.isOpen && !G.buildMenu.isDemolish && !G.paused && !G.players.some(pl => pl.pendingCast))) { G.setPaused(!G.paused); return G.paused; }
      if (!G.paused) return false;
      if (p.escape || d[BTN.B]) { G.setPaused(false); for (const pl of G.players) pl.pad.down = []; return false; }  // this B doesn't also cast
      // Controller navigation of the menu.
      const list = buttons();
      const dy = (d[BTN.DOWN] ? 1 : 0) - (d[BTN.UP] ? 1 : 0);
      if (dy) { focusIdx = (focusIdx + dy + list.length) % list.length; list[focusIdx].focus(); }
      if (d[BTN.A]) { const i = list.indexOf(document.activeElement); act(list[i >= 0 ? i : 0].dataset.act); }
      if (G.controlScheme === 'pad' || split()) render();
      return true;
    }
  };
})(window.Game);
