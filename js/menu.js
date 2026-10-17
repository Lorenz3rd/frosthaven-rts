// Front end: home screen, scrolling war-camp backdrop, local multiplayer controller
// assignment, race/hero selection with a live 3D preview, and the network rooms and lobby (net.js). Races come from races.js,
// heroes from heroes.js, CPU difficulties from ai.js; any race may hire any hero. Hands off to G.startGame.
(function (G) {

  const SIDES = [
    { key: 'west', label: 'West Army', cls: 'you' },
    { key: 'east', label: 'East Army', cls: 'enemy' }
  ];

  const $ = sel => document.querySelector(sel);
  const root = $('#menu');
  let screen = 'home';
  let rafId = 0;
  // 'local' (split screen, two to four players), 'single' (you vs. the CPU: both sides' race and hero plus the CPU
  // difficulty) or 'dev' (mouse: your side plus the enemy's race).
  let selectMode = 'local';
  // Single player: index into G.DIFFICULTIES (Medium), and which card a controller is working on.
  let cpuDiff = 1;
  let focusSide = 'west';
  // Single player controller focus runs down your card, then the CPU's: [side, row].
  const SINGLE_ROWS = [['west', 0], ['west', 1], ['east', 0], ['east', 1], ['east', 2]];

  function show(name) {
    screen = name;
    for (const el of root.querySelectorAll('.screen')) el.hidden = el.dataset.screen !== name;
    if (name === 'local') renderLocal();
    if (name === 'select') { clearSeatCards(); renderSelect(); }
    if (name === 'lobby') renderLobby();
    focusFirst();
    if (name === 'net') {
      const nameIn = $('#netName'), roomIn = $('#netRoom');
      if (!nameIn.value) nameIn.value = G.net.savedName();
      if (!roomIn.value) roomIn.value = G.net.savedRoom();
      $('#netLan').checked = G.net.savedLan();
      fillRelay();
      G.net.warmUp();
      (nameIn.value ? roomIn : nameIn).focus();
    }
  }

  function focusFirst() {
    const b = root.querySelector(`.screen[data-screen="${screen}"] button:not(:disabled)`);
    if (b) b.focus();
  }

  // ---------------------------------------------------------------------------
  // Scrolling backdrop: a panning strip of frozen camps — walls, huts, towers,
  // braziers — with columns of troops marching between them.
  // ---------------------------------------------------------------------------
  const bg = $('#menuBg');
  const ctx = bg.getContext('2d');
  const TILE = 900;  // world width of one repeating camp segment
  const rnd = G.rng(4242);
  // Pre-roll a handful of camp segments so the pattern doesn't obviously repeat.
  const camps = [];
  for (let i = 0; i < 4; i++) {
    const team = i % 2;
    const buildings = [];
    const n = 3 + Math.floor(rnd() * 3);
    for (let j = 0; j < n; j++) {
      buildings.push({
        x: 140 + j * (560 / n) + rnd() * 40,
        kind: ['hut', 'tower', 'hall', 'hut'][Math.floor(rnd() * 4)],
        s: 0.8 + rnd() * 0.5
      });
    }
    const trees = [];
    for (let j = 0; j < 7; j++) trees.push({ x: rnd() * TILE, s: 0.6 + rnd() * 0.8 });
    camps.push({ team, buildings, trees });
  }
  const troops = [];
  for (let i = 0; i < 26; i++) {
    troops.push({
      x: rnd() * TILE * camps.length,
      lane: rnd(),
      dir: rnd() < 0.5 ? 1 : -1,
      speed: 18 + rnd() * 16,
      phase: rnd() * 6,
      big: rnd() < 0.2
    });
  }
  const snow = [];
  for (let i = 0; i < 140; i++) snow.push({ x: rnd(), y: rnd(), v: 0.02 + rnd() * 0.05, s: 0.5 + rnd() * 1.8 });

  const TEAM_COL = ['#7fb0e0', '#e0624f'];
  const TEAM_DARK = ['#2c4a6c', '#6e2a20'];

  function drawBuilding(b, gx, gy) {
    const s = b.s * scale;
    ctx.save();
    ctx.translate(gx, gy);
    ctx.scale(s, s);
    ctx.fillStyle = '#1b1a1d';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    if (b.kind === 'hut') {
      ctx.fillStyle = '#3b3128';
      ctx.fillRect(-34, -34, 68, 34);
      ctx.fillStyle = '#e6eef5';
      ctx.beginPath(); ctx.moveTo(-44, -30); ctx.lineTo(0, -66); ctx.lineTo(44, -30); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffb347';
      ctx.fillRect(-8, -20, 16, 20);
    } else if (b.kind === 'tower') {
      ctx.fillStyle = '#4a4440';
      ctx.fillRect(-16, -110, 32, 110);
      ctx.fillStyle = '#5a534d';
      for (let k = -1; k <= 1; k++) ctx.fillRect(-20 + (k + 1) * 14, -122, 10, 14);
      ctx.fillStyle = '#ffd27a';
      ctx.fillRect(-4, -84, 8, 12);
      ctx.fillStyle = '#dfe9f2';
      ctx.fillRect(-20, -112, 40, 4);
    } else {
      ctx.fillStyle = '#433a31';
      ctx.fillRect(-60, -50, 120, 50);
      ctx.fillStyle = '#e6eef5';
      ctx.beginPath(); ctx.moveTo(-70, -46); ctx.lineTo(0, -92); ctx.lineTo(70, -46); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffb347';
      ctx.fillRect(-12, -26, 24, 26);
      ctx.fillRect(-44, -36, 10, 10); ctx.fillRect(34, -36, 10, 10);
    }
    ctx.restore();
  }

  function drawBanner(x, y, team, t) {
    const s = scale;
    ctx.strokeStyle = '#2a2420';
    ctx.lineWidth = 3 * s;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 90 * s); ctx.stroke();
    ctx.fillStyle = TEAM_COL[team];
    const w = Math.sin(t * 3 + x) * 4 * s;
    ctx.beginPath();
    ctx.moveTo(x, y - 90 * s); ctx.lineTo(x + 34 * s + w, y - 82 * s); ctx.lineTo(x, y - 70 * s);
    ctx.closePath(); ctx.fill();
  }

  function drawBrazier(x, y, t) {
    const s = scale;
    ctx.fillStyle = '#3a2f26';
    ctx.fillRect(x - 8 * s, y - 16 * s, 16 * s, 16 * s);
    const f = 1 + Math.sin(t * 12 + x) * 0.15;
    const g = ctx.createRadialGradient(x, y - 22 * s, 0, x, y - 22 * s, 40 * s * f);
    g.addColorStop(0, 'rgba(255,200,110,0.9)');
    g.addColorStop(0.3, 'rgba(255,120,40,0.35)');
    g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y - 22 * s, 40 * s * f, 0, Math.PI * 2); ctx.fill();
  }

  function drawTree(x, y, s) {
    s *= scale;
    ctx.fillStyle = '#16231f';
    ctx.beginPath(); ctx.moveTo(x - 24 * s, y); ctx.lineTo(x, y - 90 * s); ctx.lineTo(x + 24 * s, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(230,240,248,0.75)';
    ctx.beginPath(); ctx.moveTo(x - 10 * s, y - 55 * s); ctx.lineTo(x, y - 90 * s); ctx.lineTo(x + 10 * s, y - 55 * s); ctx.closePath(); ctx.fill();
  }

  function drawTroop(x, y, tr, team, t) {
    const s = scale * (tr.big ? 1.6 : 1);
    const bob = Math.abs(Math.sin(t * 8 + tr.phase)) * 3 * s;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(x, y, 9 * s, 3 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = tr.big ? '#c9d6df' : '#2b2622';
    ctx.fillRect(x - 6 * s, y - 22 * s - bob, 12 * s, 18 * s);
    ctx.fillStyle = TEAM_COL[team];
    ctx.fillRect(x - 6 * s, y - 16 * s - bob, 12 * s, 4 * s);
    ctx.fillStyle = '#d9ccb0';
    ctx.beginPath(); ctx.arc(x, y - 27 * s - bob, 5 * s, 0, Math.PI * 2); ctx.fill();
    // spear
    ctx.strokeStyle = '#8a7a62';
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath(); ctx.moveTo(x + 8 * s * tr.dir, y - 2 * s - bob); ctx.lineTo(x + 8 * s * tr.dir, y - 40 * s - bob); ctx.stroke();
    // legs
    const leg = Math.sin(t * 8 + tr.phase) * 4 * s;
    ctx.strokeStyle = '#1a1714';
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.moveTo(x - 3 * s, y - 4 * s - bob); ctx.lineTo(x - 3 * s + leg, y);
    ctx.moveTo(x + 3 * s, y - 4 * s - bob); ctx.lineTo(x + 3 * s - leg, y);
    ctx.stroke();
  }

  let scale = 1, W = 0, H = 0, scroll = 0, last = 0;
  function resizeBg() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    bg.width = W * dpr; bg.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scale = Math.max(0.6, H / 900);
  }

  function frame(now) {
    const dt = Math.min((now - (last || now)) / 1000, 0.05);
    last = now;
    const t = now / 1000;
    scroll += dt * 30;

    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0b1420'); sky.addColorStop(0.55, '#1c2a38'); sky.addColorStop(1, '#2a3440');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

    // Far mountains (parallax)
    const horizon = H * 0.55;
    ctx.fillStyle = '#16202b';
    ctx.beginPath(); ctx.moveTo(0, horizon);
    for (let x = 0; x <= W + 40; x += 40) {
      const wx = x + scroll * 0.2;
      ctx.lineTo(x, horizon - 80 * scale - Math.sin(wx * 0.004) * 60 * scale - Math.sin(wx * 0.011) * 25 * scale);
    }
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();

    // Snowfield
    const ground = H * 0.62;
    const sg = ctx.createLinearGradient(0, ground, 0, H);
    sg.addColorStop(0, '#9fb0bf'); sg.addColorStop(1, '#5e6c78');
    ctx.fillStyle = sg; ctx.fillRect(0, ground, W, H - ground);

    // Camps, tiled along the strip
    const segW = TILE * scale;
    const total = segW * camps.length;
    const off = (scroll * scale) % total;
    for (let rep = -1; rep <= Math.ceil(W / total) + 1; rep++) {
      for (let i = 0; i < camps.length; i++) {
        const cx = rep * total + i * segW - off;
        if (cx > W + segW || cx < -segW) continue;
        const c = camps[i];
        for (const tr of c.trees) drawTree(cx + tr.x * scale, ground + 6 * scale, tr.s);
        // Palisade
        ctx.fillStyle = '#2c241d';
        for (let px = 80; px < 780; px += 14) ctx.fillRect(cx + px * scale, ground + 20 * scale - 28 * scale, 9 * scale, 28 * scale);
        drawBanner(cx + 80 * scale, ground + 20 * scale, c.team, t);
        drawBanner(cx + 780 * scale, ground + 20 * scale, c.team, t);
        for (const b of c.buildings) drawBuilding(b, cx + b.x * scale, ground + 70 * scale);
        drawBrazier(cx + 450 * scale, ground + 110 * scale, t);
      }
    }

    // Troops march across the foreground
    troops.sort((a, b) => a.lane - b.lane);
    for (const tr of troops) {
      tr.x += tr.dir * tr.speed * dt;
      const wrapW = TILE * camps.length;
      tr.x = ((tr.x % wrapW) + wrapW) % wrapW;
      let sx = tr.x * scale - off;
      sx = ((sx % total) + total) % total;
      const y = ground + (130 + tr.lane * 140) * scale;
      for (let k = -1; k <= 1; k++) {
        const x = sx + k * total;
        if (x > -40 && x < W + 40) drawTroop(x, y, tr, tr.dir > 0 ? 0 : 1, t);
      }
    }

    // Snowfall
    ctx.fillStyle = 'rgba(235,242,250,0.8)';
    for (const f of snow) {
      f.y += f.v * dt; f.x -= f.v * 0.3 * dt;
      if (f.y > 1) { f.y = 0; f.x = Math.random(); }
      if (f.x < 0) f.x += 1;
      ctx.fillRect(f.x * W, f.y * H, f.s, f.s);
    }

    pollPads();
    rafId = requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------------------
  // Gamepads: Bluetooth Xbox controllers appear through the standard Gamepad API.
  // Browsers only expose a pad after it has had a button pressed.
  // ---------------------------------------------------------------------------
  const BTN = { A: 0, B: 1, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
  const prevButtons = {};  // pad index -> array of pressed flags
  const prevAxis = {};     // pad index -> { x, y } as -1/0/1

  // Local multiplayer seats, in join order: { id, input, side, hero, row, ready }. input is a pad index, or
  // MKB for the mouse and keyboard (one seat at most); hero indexes G.HEROES. Up to four, three an army.
  const MKB = 'mkb', MAX_SEATS = 4, MAX_ARMY = 3;
  let seats = [], nextSeat = 0;
  // Each army's race (index into G.RACES): one per side, so teammates share it.
  const teamRace = { west: 0, east: 1 };
  // Single player and developer mode: one card per side (hero indices into G.HEROES).
  const picks = {
    west: { hero: 0, row: 0, ready: false },
    east: { hero: 1, row: 0, ready: false }
  };

  function connectedPads() {
    return Array.from(navigator.getGamepads ? navigator.getGamepads() : []).filter(Boolean);
  }

  function padName(p) {
    const id = p.id.replace(/\(.*?\)/g, '').trim();
    return `#${p.index + 1} · ${/xbox|xinput|045e/i.test(p.id) ? 'Xbox Controller' : (id || 'Gamepad')}`;
  }

  const seatOf = input => seats.find(s => s.input === input) || null;
  const armySize = side => seats.filter(s => s.side === side).length;
  // A new player joins the smaller army (the west on a tie), with a hero nobody else starts on.
  function joinSeat(input, side) {
    if (seats.length >= MAX_SEATS || seatOf(input)) return;
    side = side || (armySize('west') <= armySize('east') ? 'west' : 'east');
    if (armySize(side) >= MAX_ARMY) side = side === 'west' ? 'east' : 'west';
    const taken = seats.map(s => s.hero);
    seats.push({ id: nextSeat++, input, side, hero: Math.max(0, G.HEROES.findIndex((h, i) => !taken.includes(i))), row: 0, ready: false });
  }
  const leaveSeat = seat => { seats = seats.filter(s => s !== seat); };

  // The cards on the pick screen: { key, side, pk, input, label }, west first. Local multiplayer has one per
  // seat; single player and developer mode one per side. pk holds the card's hero, row and ready.
  function cards() {
    if (selectMode !== 'local') return SIDES.map(s => ({ key: s.key, side: s.key, pk: picks[s.key], input: null, label: s.label }));
    const out = [];
    for (const s of SIDES) {
      const army = seats.filter(x => x.side === s.key);
      army.forEach((x, i) => out.push({ key: 's' + x.id, side: s.key, pk: x, input: x.input, label: s.label + (army.length > 1 ? ' · ' + (i + 1) : '') }));
    }
    return out;
  }
  // Teammates share a race: the army's first player picks it.
  const picksRace = c => selectMode !== 'local' || cards().find(o => o.side === c.side).key === c.key;

  function pollPads() {
    for (const p of connectedPads()) {
      const prev = prevButtons[p.index] || [];
      const now = p.buttons.map(b => b.pressed);
      const down = i => now[i] && !prev[i];
      const ax = { x: Math.abs(p.axes[0]) > 0.6 ? Math.sign(p.axes[0]) : 0, y: Math.abs(p.axes[1]) > 0.6 ? Math.sign(p.axes[1]) : 0 };
      const pa = prevAxis[p.index] || { x: 0, y: 0 };
      const dir = {
        up: down(BTN.UP) || (ax.y === -1 && pa.y !== -1),
        down: down(BTN.DOWN) || (ax.y === 1 && pa.y !== 1),
        left: down(BTN.LEFT) || (ax.x === -1 && pa.x !== -1),
        right: down(BTN.RIGHT) || (ax.x === 1 && pa.x !== 1)
      };
      prevButtons[p.index] = now;
      prevAxis[p.index] = ax;
      handlePad(p, { a: down(BTN.A), b: down(BTN.B), start: down(BTN.START), ...dir });
    }
    if (screen === 'local') refreshPadList();
  }

  function moveFocus(delta) {
    const list = Array.from(root.querySelectorAll(`.screen[data-screen="${screen}"] button:not(:disabled)`));
    if (!list.length) return;
    const i = list.indexOf(document.activeElement);
    list[(i + delta + list.length) % list.length].focus();
  }

  function handlePad(p, e) {
    if (screen === 'home') {
      if (e.up) moveFocus(-1);
      if (e.down) moveFocus(1);
      if (e.a && document.activeElement?.closest('#menu')) document.activeElement.click();
    } else if (screen === 'local') {
      const seat = seatOf(p.index);
      if (e.a && !seat) {
        joinSeat(p.index); renderLocal();
      } else if (e.b) {
        if (seat) { leaveSeat(seat); renderLocal(); } else show('home');
      } else if ((e.left || e.right) && seat) {
        // ◀ the west army, ▶ the east, if it has room.
        const to = e.left ? 'west' : 'east';
        if (seat.side !== to && armySize(to) < MAX_ARMY) { seat.side = to; renderLocal(); }
      } else if (e.start && seat && armiesFilled()) {
        show('select');
      }
    } else if (screen === 'select') {
      if (selectMode === 'single') { handleSinglePad(e); return; }
      // Developer mode: the first controller drives your (west) card.
      const card = cards().find(c => (selectMode === 'dev' ? c.key === 'west' : c.input === p.index));
      if (!card) return;
      const pk = card.pk;
      if (e.b) {
        if (pk.ready) pk.ready = false;
        else { unready(); show(selectMode === 'dev' ? 'home' : 'local'); return; }
      } else if (!pk.ready) {
        if (e.up && picksRace(card)) pk.row = 0;
        if (e.down) pk.row = 1;
        if (e.left || e.right) cyclePick(card, e.right ? 1 : -1);
        if (e.a) { if (selectMode === 'dev') { beginLocal(); return; } pk.ready = true; }
      } else if (e.start && allReady()) {
        beginLocal(); return;
      }
      renderSelect();
    }
  }

  // Single player: any controller walks down both cards (up/down), changes the row (left/right) and starts (A).
  function handleSinglePad(e) {
    if (e.b) { show('home'); return; }
    if (e.a || e.start) { beginLocal(); return; }
    if (e.up || e.down) {
      let i = SINGLE_ROWS.findIndex(([s, r]) => s === focusSide && r === picks[s].row);
      i = G.clamp(i + (e.down ? 1 : -1), 0, SINGLE_ROWS.length - 1);
      focusSide = SINGLE_ROWS[i][0];
      picks[focusSide].row = SINGLE_ROWS[i][1];
    }
    if (e.left || e.right) cyclePick(cards().find(c => c.key === focusSide), e.right ? 1 : -1);
    renderSelect();
  }

  // ---------------------------------------------------------------------------
  // Local multiplayer: controller assignment
  // ---------------------------------------------------------------------------
  // Every army needs a player before the pick screen.
  function armiesFilled() { return SIDES.every(s => armySize(s.key) > 0); }
  function unready() { for (const c of [...seats, picks.west, picks.east]) c.ready = false; }

  let lastPadSig = '';
  function refreshPadList() {
    const pads = connectedPads();
    const sig = pads.map(p => p.index + p.id).join('|');
    // Drop the seats of controllers that disconnected.
    const before = seats.length;
    seats = seats.filter(s => s.input === MKB || pads.some(p => p.index === s.input));
    if (sig !== lastPadSig || seats.length !== before) { lastPadSig = sig; renderLocal(); }
  }

  const inputName = (input, pads) => input === MKB ? 'Mouse & Keyboard' : padName(pads.find(p => p.index === input));
  const inputValue = v => (v === MKB ? MKB : Number(v));
  // Each army's column: a row per player (its select changes the controller, or removes them), a pulsing
  // join line while there's room, and an Add select for mouse users.
  function renderLocal() {
    const pads = connectedPads();
    const inputs = [MKB, ...pads.map(p => p.index)];
    const options = list => list.map(i => `<option value="${i}">${inputName(i, pads)}</option>`).join('');
    for (const s of SIDES) {
      const card = root.querySelector(`.side[data-side="${s.key}"]`);
      const army = seats.filter(x => x.side === s.key);
      const room = seats.length < MAX_SEATS && army.length < MAX_ARMY;
      card.classList.toggle('joined', army.length > 0);
      card.querySelector('.seats').innerHTML = army.map(x =>
        `<li><span class="pad">${x.input === MKB ? '⌨' : '🎮'}</span><select data-seat="${x.id}" aria-label="${s.label} player controller">` +
        `<option value="">— Leave —</option>${options(inputs)}</select></li>`).join('') +
        (room ? '<li class="open"><span class="pad">🎮</span><span class="status">Press Ⓐ (or Enter) to join</span></li>' : '');
      army.forEach(x => { card.querySelector(`select[data-seat="${x.id}"]`).value = String(x.input); });
      const free = inputs.filter(i => !seatOf(i));
      const add = card.querySelector('.add');
      add.hidden = !room || !free.length;
      add.innerHTML = `<option value="">＋ Add a player…</option>${options(free)}`;
      add.value = '';
    }
    root.querySelector('.padCount').textContent = pads.length
      ? `${pads.length} controller${pads.length > 1 ? 's' : ''} detected`
      : 'No controllers detected — pair your Xbox controllers over Bluetooth, then press any button.';
    root.querySelector('#toSelect').disabled = !armiesFilled();
  }

  // ---------------------------------------------------------------------------
  // Race & hero selection
  // ---------------------------------------------------------------------------
  function cyclePick(card, d) {
    const pk = card.pk;
    if (pk.row === 0) teamRace[card.side] = (teamRace[card.side] + d + G.RACES.length) % G.RACES.length;
    else if (pk.row === 1) pk.hero = (pk.hero + d + G.HEROES.length) % G.HEROES.length;
    else cpuDiff = G.clamp(cpuDiff + d, 0, G.DIFFICULTIES.length - 1);  // Easy -> 7 Griefs, no wrap
  }

  // In developer mode only your side picks a hero (the enemy has none yet). Only local multiplayer locks in.
  const picksHero = side => selectMode !== 'dev' || side === 'west';
  function allReady() { return selectMode !== 'local' || cards().every(c => c.pk.ready); }

  // A pick card's element. Local multiplayer copies the side's card for each seat (class "seat"), west
  // cards before the VS and east after; the two originals serve single player and developer mode.
  function cardEl(c) {
    let el = root.querySelector(`.pick[data-key="${c.key}"]`);
    if (el) return el;
    el = root.querySelector(`.pick[data-key="${c.side}"]`).cloneNode(true);
    el.dataset.key = c.key;
    el.classList.add('seat');
    el.hidden = false;
    const diff = el.querySelector('.diff');
    if (diff) diff.remove();
    const vs = root.querySelector('.screen[data-screen="select"] .vs');
    if (c.side === 'west') vs.before(el); else vs.parentNode.appendChild(el);
    wireCard(el, c.key);
    return el;
  }
  function clearSeatCards() {
    for (const el of root.querySelectorAll('.pick.seat')) { preview.drop(el.dataset.key); el.remove(); }
  }

  function wireCard(card, key) {
    const cardOf = () => cards().find(c => c.key === key);
    for (const [row, cls] of [[0, '.race'], [1, '.hero'], [2, '.diff']]) {
      if (!card.querySelector(cls)) continue;
      for (const [btn, d] of [['.prev', -1], ['.next', 1]]) {
        card.querySelector(`${cls} ${btn}`).addEventListener('click', () => {
          const c = cardOf();
          if (!c || c.pk.ready) return;
          c.pk.row = row; focusSide = key;
          cyclePick(c, d); renderSelect();
        });
      }
    }
    card.querySelector('.readyBtn').addEventListener('click', () => { const c = cardOf(); if (c) { c.pk.ready = !c.pk.ready; renderSelect(); } });
  }

  function renderSelect() {
    const pads = connectedPads();
    const dev = selectMode === 'dev', single = selectMode === 'single', local = selectMode === 'local';
    root.querySelector('#selectHint').textContent = dev
      ? 'Pick your race and hero, and the race you will fight. Click ‹ › (or ◀ ▶ on a controller) to change.'
      : single
        ? 'Pick your race and hero, then the CPU’s race, hero and difficulty. Click ‹ › (or ▲ ▼ ◀ ▶ on a controller, Ⓐ to begin).'
        : '▲ ▼ choose race or hero, ◀ ▶ to change, Ⓐ to lock in, Ⓑ to undo. Start begins when everyone is ready; each army’s first player picks its race. Mouse & keyboard: click ‹ › and Lock in, then Begin.';
    const list = cards();
    for (const el of root.querySelectorAll('.pick:not(.seat)')) el.hidden = local;
    root.querySelector('.screen[data-screen="select"] .sides').classList.toggle('many', list.length > 2);
    for (const c of list) {
      const pk = c.pk;
      const race = G.RACES[teamRace[c.side]];
      const hero = G.HEROES[pk.hero];
      const card = cardEl(c);
      const pad = pads.find(p => p.index === c.input);
      const ownRace = picksRace(c);
      if (!ownRace && pk.row === 0) pk.row = 1;
      card.querySelector('.label').textContent = dev || single ? (c.side === 'west' ? 'Your Army' : single ? 'CPU Army' : 'Enemy Army') : c.label;
      card.querySelector('.who').textContent = dev || single
        ? (c.side === 'west' ? 'Mouse & keyboard' : single ? 'Computer opponent' : 'Training opponent')
        : c.input === MKB ? 'Mouse & keyboard' : pad ? padName(pad) : 'Controller disconnected';
      card.querySelector('.race .val').textContent = race.name;
      card.querySelector('.race .val').style.color = race.color;
      card.querySelector('.race .desc').textContent = ownRace ? race.desc : 'Picked by your army’s first player.';
      for (const b of card.querySelectorAll('.race button')) b.style.visibility = ownRace ? '' : 'hidden';
      const withHero = picksHero(c.side);
      card.querySelector('.hero').hidden = !withHero;
      card.querySelector('.info').hidden = !withHero;
      card.querySelector('.readyBtn').hidden = !local;
      const diffRow = card.querySelector('.diff');
      if (diffRow) {
        const d = G.DIFFICULTIES[cpuDiff];
        diffRow.hidden = !single;
        diffRow.querySelector('.val').textContent = d.name;
        diffRow.querySelector('.val').classList.toggle('griefs', d.id === 'griefs');
        diffRow.querySelector('.desc').textContent = d.desc;
        diffRow.querySelector('.prev').disabled = cpuDiff === 0;
        diffRow.querySelector('.next').disabled = cpuDiff === G.DIFFICULTIES.length - 1;
        diffRow.classList.toggle('active', single && focusSide === c.key && pk.row === 2);
      }
      if (withHero) {
        card.querySelector('.hero .val').textContent = hero.name;
        card.querySelector('.hero .val').style.color = hero.css;
        card.querySelector('.hero .desc').textContent = hero.desc;
        const b = hero.basic;
        card.querySelector('.stats').innerHTML =
          `<span>${hero.lore}</span><span>${hero.role}</span><span>♥ ${hero.hp}</span>` +
          `<span>⚔ ${b.damage}${hero.formBasic ? '/' + hero.formBasic({ form: 'melee' }).damage : ''}</span>` +
          `<span>⌖ ${b.range}${hero.formBasic ? '/' + hero.formBasic({ form: 'melee' }).range : ''}</span>`;
        card.querySelector('.abil').innerHTML = hero.abilities.map((a, i) =>
          `<li${a.ult ? ' class="ult"' : ''}><b>${a.key.toUpperCase()}</b> ${a.icon} ${a.name}${i === 2 ? ` <i>+ ${hero.passive.name}</i>` : ''}</li>`).join('');
      }
      // Single player highlights only the row a controller is on; the other modes, each card's own.
      const focused = !pk.ready && (!single || focusSide === c.key);
      card.querySelector('.race').classList.toggle('active', focused && pk.row === 0);
      card.querySelector('.hero').classList.toggle('active', focused && pk.row === 1);
      card.classList.toggle('ready', pk.ready);
      card.querySelector('.readyBtn').textContent = pk.ready ? 'Ready ✓' : 'Lock in';
      preview.set(c.key, card.querySelector('.preview'), race.id, withHero ? hero.id : null, c.side === 'west' ? G.TEAM.PLAYER : G.TEAM.ENEMY);
    }
    // Cards not on this screen stop rendering their previews.
    for (const k of preview.keys()) if (k !== 'net' && !list.some(c => c.key === k)) preview.drop(k);
    root.querySelector('#beginLocal').disabled = !allReady();
    root.querySelector('#beginLocal').textContent = dev ? 'Enter Sandbox' : 'Begin Battle';
  }

  // ---------------------------------------------------------------------------
  // Live 3D preview on each pick card: the hero up front (cycling through its
  // attack and abilities), two of the race's soldiers behind.
  // ---------------------------------------------------------------------------
  const preview = (function () {
    const views = {};
    let raf = 0, last = 0;

    function makeView(canvas, team) {
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0x8ea4c4, 0x2a2018, 0.9));
      const key = new THREE.DirectionalLight(0xdfe8ff, 1.1); key.position.set(120, 260, 200); scene.add(key);
      const rim = new THREE.PointLight(0xffa050, 1.4, 600, 2); rim.position.set(-140, 120, -120); scene.add(rim);
      const ground = new THREE.Mesh(new THREE.CircleGeometry(150, 48).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x5a6470, roughness: 1 }));
      scene.add(ground);
      const ring = new THREE.Mesh(new THREE.RingGeometry(146, 150, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: G.kit.teamHex(team) }));
      ring.position.y = 0.5; scene.add(ring);
      const camera = new THREE.PerspectiveCamera(30, 1, 10, 3000);
      return { renderer, scene, camera, team, key: '', hero: null, units: [], heroLight: null, e: null, t: 0, cycle: 0, canvas };
    }

    function fakeHero(id) {
      return { def: G.heroById(id), moving: false, swing: 0, swingAlt: false, castAnim: 0, castSlot: -1, form: 'ranged',
        state: { orbit: 0, souls: 0, tide: 0 }, lift: 0, buffs: {}, dash: null, untargetable: false };
    }

    function build(v, race, heroId) {
      for (const o of [v.hero, ...v.units]) if (o) v.scene.remove(o);
      v.units = [];
      const R = G.render3d, models = R.RACE_MODELS[race] || R.RACE_MODELS.human;
      const spots = heroId ? [[-70, -70], [-70, 70]] : [[-40, -60], [-40, 60], [40, 0]];
      const kinds = heroId ? ['infantry', 'armored'] : ['armored', 'long', 'infantry'];
      spots.forEach(([x, z], i) => {
        const kind = kinds[i];
        const m = models.unit(v.team, kind, G.isRangedKind(kind));
        m.position.set(x, 0, z);
        m.rotation.y = -Math.PI / 2 + 0.35;
        if (!heroId) m.scale.multiplyScalar(1.6);
        v.scene.add(m); v.units.push(m);
      });
      v.hero = null; v.e = null;
      if (heroId) {
        v.hero = R.HERO_MODELS[heroId](v.team);
        v.hero.rotation.y = -Math.PI / 2 + 0.45;
        v.scene.add(v.hero);
        // Frame the camera on the hero's size (the Crushing Tide is far wider than the Blinkblade).
        const size = new THREE.Box3().setFromObject(v.hero).getSize(new THREE.Vector3());
        v.fit = { r: Math.max(200, Math.max(size.x, size.z) * 2.3, size.y * 2.5), y: size.y * 0.55 };
        v.e = fakeHero(heroId);
        if (!v.heroLight) { v.heroLight = new THREE.PointLight(0xffffff, 1.4, 400, 2); v.scene.add(v.heroLight); }
        v.heroLight.color.setHex(v.e.def.color);
        v.heroLight.position.set(60, 110, 60);
        v.heroLight.visible = true;
      } else if (v.heroLight) v.heroLight.visible = false;
      v.t = 0; v.cycle = 0;
    }

    function size(v) {
      const w = v.canvas.clientWidth, h = v.canvas.clientHeight;
      if (!w || !h) return;
      if (v.w !== w || v.h !== h) { v.renderer.setSize(w, h, false); v.camera.aspect = w / h; v.camera.updateProjectionMatrix(); v.w = w; v.h = h; }
    }

    function tick(now) {
      const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
      const time = now / 1000;
      for (const k in views) {
        const v = views[k];
        size(v);
        const e = v.e;
        if (e) {
          // Every 1.6s: a basic attack; every third beat an ability (cycling Q W E R).
          v.t += dt;
          if (v.t > 1.6) {
            v.t = 0; v.cycle++;
            if (v.cycle % 3 === 0) { e.castSlot = (v.cycle / 3 - 1) % 4; e.castAnim = 1; if (e.def.id === 'geminate' && e.castSlot === 1) e.form = e.form === 'melee' ? 'ranged' : 'melee'; if (e.castSlot === 2) e.state.orbit = 2; }
            else { e.swing = 1; e.swingAlt = !e.swingAlt; }
          }
          e.swing = Math.max(0, e.swing - dt * 2.5);
          e.castAnim = Math.max(0, e.castAnim - dt * 1.6);
          e.state.orbit = Math.max(0, e.state.orbit - dt);
          e.state.tide = e.cycle % 6;
          const u = v.hero.userData;
          u.animate(u, e, time, dt);
        }
        v.units.forEach((m, i) => {
          const u = m.userData, ph = time * 1.3 + i * 2;
          if (u.arm) u.arm.rotation.z = Math.sin(ph) > 0.85 ? 0.9 - (Math.sin(ph) - 0.85) * 12 : -0.25;
          if (u.tick) u.tick(u, { moving: false }, time);
          if (u.aura) u.aura.visible = false;
        });
        const r = v.hero ? v.fit.r : 400, a = Math.sin(time * 0.25) * 0.25;
        v.camera.position.set(Math.sin(a) * r, v.hero ? v.fit.y + r * 0.2 : 150, Math.cos(a) * r);
        v.camera.lookAt(0, v.hero ? v.fit.y : 50, 0);
        v.renderer.render(v.scene, v.camera);
      }
      raf = requestAnimationFrame(tick);
    }

    return {
      set(side, canvas, race, heroId, team) {
        if (!views[side]) views[side] = makeView(canvas, team);
        const v = views[side], key = race + '|' + heroId;
        if (v.key !== key) { v.key = key; build(v, race, heroId); }
        if (!raf) raf = requestAnimationFrame(tick);
      },
      keys: () => Object.keys(views),
      // Free a card's WebGL context (the card left the screen).
      drop(k) {
        if (!views[k]) return;
        views[k].renderer.dispose(); views[k].renderer.forceContextLoss(); delete views[k];
      },
      // Free the WebGL contexts before the game takes over.
      dispose() {
        cancelAnimationFrame(raf); raf = 0;
        for (const k in views) this.drop(k);
      }
    };
  })();

  function beginLocal() {
    G.matchConfig = {
      mode: selectMode === 'dev' ? 'developer' : selectMode,
      difficulty: selectMode === 'single' ? G.DIFFICULTIES[cpuDiff].id : undefined,
      sides: SIDES.map(s => ({
        side: s.key,
        race: G.RACES[teamRace[s.key]].id,
        hero: G.HEROES[picks[s.key].hero].id
      })),
      // Local multiplayer: each player's army, controller (a pad index or 'mkb') and hero, west first.
      players: selectMode === 'local' ? cards().map(c => ({ side: c.side, gamepad: c.input, hero: G.HEROES[c.pk.hero].id })) : undefined
    };
    // Remembered so "Play again" (which reloads) restarts the same match-up.
    try { sessionStorage.setItem('frost.match', JSON.stringify(G.matchConfig)); } catch (e) { /* storage blocked */ }
    // Single player and local multiplayer start their battle; developer mode drops into the sandbox.
    launch();
  }

  // ---------------------------------------------------------------------------
  // Network multiplayer: create or join a room by name, then the lobby (teams of up to 3, each player
  // picks a hero, the host picks both races and starts). See net.js.
  // ---------------------------------------------------------------------------
  // A status line; a plain notice stays up at least a few seconds before the lobby's player count replaces it.
  let noticeUntil = 0;
  function netStatus(id, text, error) {
    const el = $(id);
    el.textContent = text || '';
    el.classList.toggle('error', !!error);
    noticeUntil = text ? performance.now() + 5000 : 0;
  }
  // "Copy details" under a failure that came with a report.
  const reports = {};
  function showCopy(id, report) {
    reports[id] = report || '';
    $(id).hidden = !report;
    $(id).textContent = 'Copy details for troubleshooting';
  }

  let netBusy = false;
  async function netGo(create) {
    if (netBusy) return;
    netBusy = true;
    for (const b of root.querySelectorAll('#netJoin, #netCreate')) b.disabled = true;
    showCopy('#netCopy', '');
    G.net.onStatus = text => netStatus('#netStatus', text);
    netStatus('#netStatus', create ? 'Creating the room…' : 'Looking for the room…');
    try {
      const r = await (create ? G.net.host($('#netRoom').value, $('#netName').value) : G.net.join($('#netRoom').value, $('#netName').value));
      netStatus('#netStatus', '');
      netStatus('#lobbyStatus', r && r.warning, !!(r && r.warning));
      showCopy('#lobbyCopy', '');
      // A rejoin into a battle under way goes straight on to the game (G.net.onStart).
      if (!G.net.inGame) show('lobby');
    } catch (f) {
      netStatus('#netStatus', G.net.describe(f), true);
      showCopy('#netCopy', f && f.report);
    } finally {
      G.net.onStatus = null;
      netBusy = false;
      for (const b of root.querySelectorAll('#netJoin, #netCreate')) b.disabled = false;
    }
  }

  // Connection settings: "Same network" and the relay server, kept on this PC.
  function fillRelay() {
    const r = G.net.relay();
    $('#relayUrls').value = r ? r.urls.join(' ') : '';
    $('#relayUser').value = r ? r.username : '';
    $('#relayPass').value = r ? r.credential : '';
  }
  function readRelay() {
    const r = G.net.parseRelay($('#relayUrls').value, $('#relayUser').value, $('#relayPass').value);
    G.net.setRelay(r);
    return r;
  }

  // How a player reaches the host, as measured by the host: same Wi-Fi, over the internet, or relayed.
  const ROUTES = { lan: 'same Wi-Fi', direct: 'internet', relay: 'relayed' };
  function linkText(p) {
    if (p.host || !p.connected || !p.route) return '';
    return ROUTES[p.route] + (p.ping !== null && p.ping !== undefined ? ' ' + p.ping + ' ms' : '');
  }

  function renderLobby() {
    const L = G.net.lobby;
    if (!L) return;
    const host = G.net.role === 'host';
    const me = L.players.find(p => p.id === G.net.myId) || L.players[0];
    $('#lobbyTitle').textContent = `Room “${L.room}”`;
    $('#lobbyHint').textContent = host
      ? 'Other players: Network Multiplayer → type this room name → Join Room. Pick the races, then start when everyone is in.'
      : 'Pick your side and hero. The host picks the races and starts the battle.';
    [0, 1].forEach(team => {
      const card = root.querySelector(`.team[data-team="${team}"]`);
      const race = G.RACES.find(r => r.id === L.races[team]) || G.RACES[0];
      card.querySelector('.race .val').textContent = race.name;
      card.querySelector('.race .val').style.color = race.color;
      card.querySelector('.race .desc').textContent = race.trait;
      for (const b of card.querySelectorAll('.race button')) { b.hidden = !host; b.disabled = L.started; }
      const list = L.players.filter(p => p.team === team);
      const rows = list.map(p => {
        const hero = G.heroById(p.hero);
        const tags = [p.id === me.id ? 'you' : '', p.host ? 'host' : '', p.connected ? '' : 'disconnected', linkText(p)].filter(Boolean).join(' · ');
        return `<li class="${p.id === me.id ? 'me' : ''}${p.connected ? '' : ' gone'}"><span>${p.name}${tags ? ` <small>(${tags})</small>` : ''}</span>` +
          `<small style="color:${hero.css}">${hero.name}</small></li>`;
      });
      while (rows.length < 3) rows.push('<li class="open"><span>Open slot</span></li>');
      card.querySelector('.slots').innerHTML = rows.join('');
      const join = card.querySelector('.joinTeam');
      join.hidden = me.team === team;
      join.disabled = L.started || list.length >= 3;
    });
    const hero = G.heroById(me.hero);
    const mine = root.querySelector('.mine');
    mine.querySelector('.hero .val').textContent = hero.name;
    mine.querySelector('.hero .val').style.color = hero.css;
    mine.querySelector('.hero .desc').textContent = `${hero.lore} · ${hero.role} · ${hero.desc}`;
    mine.querySelector('.abil').innerHTML = hero.abilities.map(a => `<li><b>${a.key.toUpperCase()}</b> ${a.icon} ${a.name}</li>`).join('');
    for (const b of mine.querySelectorAll('.hero button')) b.disabled = L.started;
    preview.set('net', mine.querySelector('.preview'), L.races[me.team], hero.id, me.team === 0 ? G.TEAM.PLAYER : G.TEAM.ENEMY);
    const start = $('#lobbyStart');
    start.hidden = !host;
    start.disabled = L.started;
    const empty = [0, 1].some(t => !L.players.some(p => p.team === t));
    // The usual line, unless news is showing (a problem stays until replaced; other news a few seconds).
    if (L.started && !host) netStatus('#lobbyStatus', 'The battle is starting…');
    else if (!$('#lobbyStatus').classList.contains('error') && performance.now() > noticeUntil) {
      netStatus('#lobbyStatus', host && empty ? 'One army has no players yet: you can still start, but nobody will fight for it.' : `${L.players.length} of 6 players`);
      noticeUntil = 0;
    }
  }

  function wireNet() {
    root.querySelector('[data-go="net"]').addEventListener('click', () => show('net'));
    $('#netCreate').addEventListener('click', () => netGo(true));
    $('#netJoin').addEventListener('click', () => netGo(false));
    for (const id of ['#netName', '#netRoom']) $(id).addEventListener('keydown', e => { if (e.key === 'Enter') netGo(false); });
    for (const id of ['#netCopy', '#lobbyCopy']) {
      $(id).addEventListener('click', async () => { $(id).textContent = (await G.net.copyReport(reports[id])) ? 'Copied: paste it to whoever is helping' : 'Couldn’t copy (the browser blocked it)'; });
    }
    $('#netLan').addEventListener('change', e => G.net.setLan(e.target.checked));
    for (const id of ['#relayUrls', '#relayUser', '#relayPass']) $(id).addEventListener('change', () => { if (readRelay()) fillRelay(); });
    $('#relayTest').addEventListener('click', async () => {
      const r = readRelay();
      fillRelay();
      netStatus('#relayStatus', 'Testing the relay…');
      const res = await G.net.testRelay(r);
      netStatus('#relayStatus', res.text, !res.ok);
    });
    $('#relayClear').addEventListener('click', () => { G.net.setRelay(null); fillRelay(); netStatus('#relayStatus', 'Relay removed.'); });
    $('#lobbyLeave').addEventListener('click', () => { G.net.leave(); show('net'); });
    $('#lobbyStart').addEventListener('click', () => {
      if (G.net.role !== 'host' || G.net.lobby.started) return;
      G.matchConfig = G.net.startMatch();
      launch();
    });
    [0, 1].forEach(team => {
      const card = root.querySelector(`.team[data-team="${team}"]`);
      card.querySelector('.joinTeam').addEventListener('click', () => G.net.pick({ team }));
      for (const [sel, d] of [['.prev', -1], ['.next', 1]]) {
        card.querySelector('.race ' + sel).addEventListener('click', () => {
          const i = G.RACES.findIndex(r => r.id === G.net.lobby.races[team]);
          G.net.setRace(team, G.RACES[(i + d + G.RACES.length) % G.RACES.length].id);
        });
      }
    });
    for (const [sel, d] of [['.prev', -1], ['.next', 1]]) {
      root.querySelector('.mine .hero ' + sel).addEventListener('click', () => {
        const L = G.net.lobby, me = L && L.players.find(p => p.id === G.net.myId);
        if (!me) return;
        const i = G.HEROES.findIndex(h => h.id === me.hero);
        G.net.pick({ hero: G.HEROES[(i + d + G.HEROES.length) % G.HEROES.length].id });
      });
    }
    // Lobby updates, and errors / the room going away.
    // { error, left }: out of the room (back to the room screen). { notice, error }: news to show.
    G.net.onChange = msg => {
      if (screen === 'game') return;
      if (msg && msg.left) {
        if (screen === 'lobby') show('net');
        netStatus('#netStatus', msg.error, true);
        showCopy('#netCopy', msg.report);
        return;
      }
      if (msg && msg.notice) {
        const lobby = screen === 'lobby';
        netStatus(lobby ? '#lobbyStatus' : '#netStatus', msg.notice, !!msg.error);
        showCopy(lobby ? '#lobbyCopy' : '#netCopy', msg.report);
      }
      if (screen === 'lobby') renderLobby();
    };
    // A client was handed the match (at the start, or rejoining one under way).
    G.net.onStart = config => { G.matchConfig = config; launch(); };
  }

  // ---------------------------------------------------------------------------
  function launch() {
    cancelAnimationFrame(rafId);
    preview.dispose();
    root.remove();
    screen = 'game';   // no menu screen any more (late lobby updates leave it alone)
    document.body.classList.remove('in-menu');
    G.startGame();
  }

  function wire() {
    root.querySelector('[data-go="dev"]').addEventListener('click', () => { selectMode = 'dev'; show('select'); });
    root.querySelector('[data-go="local"]').addEventListener('click', () => { selectMode = 'local'; show('local'); });
    root.querySelector('[data-go="single"]').addEventListener('click', () => {
      selectMode = 'single'; focusSide = 'west';
      for (const s of SIDES) { picks[s.key].ready = false; picks[s.key].row = 0; }
      show('select');
    });
    for (const b of root.querySelectorAll('[data-back]')) b.addEventListener('click', () => show(b.dataset.back));
    root.querySelector('#selectBack').addEventListener('click', () => { unready(); show(selectMode === 'local' ? 'local' : 'home'); });
    root.querySelector('#toSelect').addEventListener('click', () => show('select'));
    root.querySelector('#beginLocal').addEventListener('click', beginLocal);
    for (const s of SIDES) {
      const col = root.querySelector(`.side[data-side="${s.key}"]`);
      // A player's controller select: another input (swapping with whoever had it), or Leave.
      col.querySelector('.seats').addEventListener('change', e => {
        const seat = seats.find(x => String(x.id) === e.target.dataset.seat);
        if (!seat) return;
        if (e.target.value === '') leaveSeat(seat);
        else {
          const v = inputValue(e.target.value), other = seatOf(v);
          if (other && other !== seat) other.input = seat.input;
          seat.input = v;
        }
        renderLocal();
      });
      col.querySelector('.add').addEventListener('change', e => {
        if (e.target.value !== '') joinSeat(inputValue(e.target.value), s.key);
        renderLocal();
      });
      wireCard(root.querySelector(`.pick[data-key="${s.key}"]`), s.key);
    }
    window.addEventListener('gamepadconnected', () => { if (screen === 'local') renderLocal(); });
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && screen === 'lobby') return;
      // Local multiplayer: Enter joins the mouse and keyboard.
      if (e.key === 'Enter' && screen === 'local' && !seatOf(MKB) && seats.length < MAX_SEATS && !(e.target instanceof HTMLSelectElement)) {
        joinSeat(MKB); renderLocal(); e.preventDefault(); return;
      }   // leaving a room takes the Leave button
      if (e.key === 'Escape' && screen !== 'home') show(screen === 'select' && selectMode === 'local' ? 'local' : 'home');
      if (screen === 'home' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { moveFocus(e.key === 'ArrowDown' ? 1 : -1); e.preventDefault(); }
    });
  }

  // Boot. "Play again" reloads straight back into the same match.
  if (location.hash === '#dev') {
    history.replaceState(null, '', location.pathname + location.search);
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('frost.match')); } catch (e) { /* none */ }
    G.matchConfig = saved || { mode: 'developer' };
    launch();
  } else {
    document.body.classList.add('in-menu');
    window.addEventListener('resize', resizeBg);
    resizeBg();
    wire();
    wireNet();
    // Back from a network game (or a dropped connection): straight to the room screen.
    show(G.net.takeReturnFlag() ? 'net' : 'home');
    rafId = requestAnimationFrame(frame);
  }
})(window.Game);
