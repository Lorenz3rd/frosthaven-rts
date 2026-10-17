// Test driver, slipped into the game page by nettest.py: plays one browser's part in a scenario and
// reports to the harness. Parameters come from the page's query string (see nettest.py).
(function (G) {
  const q = Object.fromEntries(new URLSearchParams(location.search));
  const num = (k, d) => (q[k] !== undefined ? Number(q[k]) : d);
  const t0 = performance.now();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function post(ev, data) {
    const body = JSON.stringify(Object.assign({ run: q.run, who: q.who, ev, t: Math.round(performance.now() - t0) }, data || {}));
    return fetch('/__nt/log', { method: 'POST', body, keepalive: true }).catch(() => {});
  }
  let finished = false;
  function done(ok, why, extra) {
    if (finished) return;
    finished = true;
    post('done', Object.assign({ ok, why }, extra || {}));
  }
  const fail = why => done(false, why);
  window.addEventListener('error', e => post('error', { msg: String(e.message), at: e.filename + ':' + e.lineno }));
  window.addEventListener('unhandledrejection', e => post('error', { msg: 'unhandled: ' + String(e.reason && (e.reason.message || e.reason)) }));
  async function until(test, ms, what) {
    const end = performance.now() + ms;
    while (performance.now() < end) { const v = test(); if (v) return v; await sleep(100); }
    throw new Error('timed out waiting for ' + what);
  }

  // Which candidates a fresh connection gathers (after asking for the microphone with mic=1).
  async function probe() {
    if (q.fp) {
      const h = str => { let x = 0x811c9dc5; for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 0x01000193); } return (x >>> 0).toString(16); };
      const snap = () => { const p = G.net._test.printParts(), o = {}; for (const k in p) o[k] = h(p[k]) + ':' + p[k].length; return o; };
      const a = snap(); await sleep(num('fp') * 1000); const b = snap();
      const diff = {}; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) diff[k] = [a[k], b[k]];
      const d = JSON.stringify(G.net._test.printParts().data);
      return done(true, '', { diff, keys: Object.keys(a).length, sample: Object.keys(diff).length ? G.net._test.printParts()[Object.keys(diff)[0]].slice(0, 300) : '' });
    }
    if (q.mic === '1') {
      try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); }
      catch (e) { post('note', { msg: 'mic: ' + e.name }); }
    }
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pc.createDataChannel('x');
    const cands = [];
    pc.onicecandidate = e => { if (e.candidate) { const f = e.candidate.candidate.split(' '); cands.push(`${f[7]} ${f[4]}`); } };
    await pc.setLocalDescription(await pc.createOffer());
    await sleep(3000);
    pc.close();
    done(true, '', { cands });
  }

  // ---- Through the real menus ----
  const $ = s => document.querySelector(s);
  const text = s => ($(s) ? $(s).textContent : '');
  const onScreen = name => { const el = $(`.screen[data-screen="${name}"]`); return !!el && !el.hidden; };
  const connectedCount = () => (G.net.lobby ? G.net.lobby.players.filter(p => p.connected).length : 0);
  const me = () => G.net.lobby && G.net.lobby.players.find(p => p.id === G.net.myId);
  async function untilSoft(test, ms) { try { return await until(test, ms, ''); } catch (e) { return null; } }
  let captured = null;
  function openRoomScreen() {
    G.net.setLan(q.lan === '1');
    // Capture the failure object behind a join / create error message.
    for (const k of ['join', 'host']) {
      const orig = G.net[k];
      G.net[k] = async (...a) => { try { return await orig(...a); } catch (f) { captured = f; throw f; } };
    }
    $('[data-go="net"]').click();
    $('#netName').value = q.name;
    $('#netRoom').value = q.room;
  }
  function at(sec, fn) { if (sec >= 0) setTimeout(fn, sec * 1000); }
  function parseDrop() { const m = /^(close|mute)@(\d+)$/.exec(q.drop || ''); return m ? { how: m[1], at: +m[2] } : null; }

  async function host() {
    openRoomScreen();
    post('note', { msg: 'creating the room' });
    $('#netCreate').click();
    await until(() => onScreen('lobby') || captured, 40000, 'room created');
    if (!onScreen('lobby')) return done(false, 'create failed: ' + text('#netStatus'), { report: captured && captured.report });
    post('status', { lobby: text('#lobbyStatus') });
    if (q.warn) {
      const w = text('#lobbyStatus');
      const ok = /Same network/.test(w);
      return done(ok, ok ? '' : 'expected a "Same network is off" warning, got: ' + w, { warning: w });
    }
    if (q.broker) {
      await sleep(num('broker') * 1000);
      G.net._test.dropFinder();
      post('note', { msg: 'dropped the room finder' });
      const back = await untilSoft(() => /reconnected/i.test(text('#lobbyStatus')), 45000);
      post('note', { msg: back ? 'room finder back' : 'room finder NOT back', lobby: text('#lobbyStatus') });
      if (!back) return fail('room finder never came back');
    }
    if (q.expectfail) {
      const s = await untilSoft(() => /couldn’t connect|tried to join/.test(text('#lobbyStatus')) && text('#lobbyStatus'), 75000);
      return done(true, '', { status: s || '(nothing shown) ' + text('#lobbyStatus') });
    }
    const want = num('players', 2);
    await until(() => connectedCount() >= want, 90000, want + ' players in the lobby');
    post('note', { msg: 'everyone in', players: G.net.lobby.players.map(p => `${p.name}:${p.team}:${p.hero}`) });
    if (q.freeze) {
      G.net._test.freezeTimers();
      post('note', { msg: 'host timers frozen' });
      await sleep(num('freeze') * 1000);
      const ok = connectedCount() >= want;
      return done(ok, ok ? '' : 'players dropped while the host was in the background: ' + connectedCount(), { status: text('#lobbyStatus') });
    }
    if (!q.start) { await sleep(3000); return done(true, '', { status: text('#lobbyStatus') }); }
    if (q.startdelay) await sleep(num('startdelay') * 1000);
    await until(() => connectedCount() >= want, 40000, 'everyone back before the start');
    const roster = G.net.lobby.players.map(p => `${p.name}:${p.team}:${p.hero}`);
    $('#lobbyStart').click();
    await until(() => G.net.inGame && G.hero, 30000, 'battle started');
    const t = performance.now(), play = num('play', 10) * 1000;
    const d = parseDrop();
    if (d) at(d.at, () => post('note', { msg: 'host drops the links (' + d.how + ')', n: G.net._test.drop(d.how) }));
    const remote = () => G.entities.filter(e => e instanceof G.Hero && e !== G.hero);
    let last = new Map(), movedLate = false, movedAny = false, k = 0;
    while (performance.now() - t < play) {
      await sleep(500);
      if (++k % 6 === 0) post('note', { msg: 'host sees', at: Math.round(performance.now() - t), heroes: remote().map(h => `${G.net.playerName(h)}@${Math.round(h.x)},${Math.round(h.y)}${h.dead ? ' dead' : ''}${h.away ? ' away' : ''}`), total: G.entities.length });
      for (const h of remote()) {
        const p = last.get(h);
        if (p && Math.hypot(h.x - p.x, h.y - p.y) > 20) { movedAny = true; if (performance.now() - t > play - 8000) movedLate = true; }
        last.set(h, { x: h.x, y: h.y });
      }
    }
    const players = G.net.lobby.players.map(p => `${p.name}:${p.connected ? 'in' : 'out'}`);
    post('note', { msg: 'host load', fps: await fps(), frameCost: Math.round(G.frameCost || 0), routes: G.net.lobby.players.map(p => `${p.name}:${p.route}:${p.ping}`) });
    if (q.end) { G.net.leave(); await sleep(1500); }
    const ok = movedAny && movedLate && players.every(s => s.endsWith(':in'));
    done(ok, ok ? '' : `remote heroes moved: ${movedAny}, in the last 8s: ${movedLate}; players ${players.join(' ')}`, { roster, players });
  }

  async function join() {
    if (q.tamper) G.ntTamper = function () { return 'a different build'; };
    if (q.delay) await sleep(num('delay'));
    openRoomScreen();
    const tClick = performance.now();
    $('#netJoin').click();
    await until(() => onScreen('lobby') || G.net.inGame || captured, 150000, 'joined or failed');
    const ms = Math.round(performance.now() - tClick);
    if (q.expect && q.expect !== 'closed') {
      const code = captured ? captured.code : 'joined';
      const ok = code === q.expect || code === 'rejected-' + q.expect;
      return done(ok, ok ? '' : `expected ${q.expect}, got ${code}`, { code, ms, message: captured && captured.message, shown: text('#netStatus'), copy: !$('#netCopy').hidden, report: (!ok || q.showreport) ? captured && captured.report : undefined });
    }
    if (!onScreen('lobby') && !G.net.inGame) return done(false, 'join failed after ' + ms + ' ms: ' + text('#netStatus'), { report: captured && captured.report });
    post('note', { msg: 'joined', ms });
    if (q.route) {
      const route = await untilSoft(() => G.net.lag().route, 8000);
      post('note', { msg: 'route', route });
      if (!q.route.split('|').includes(route)) return fail(`route ${route}, expected ${q.route}`);
    }
    let picks = null;
    if (q.pick) {
      G.net.pick({ team: 1 });
      await sleep(300);
      root().querySelector('.mine .hero .next').click();
      await sleep(800);
      picks = `${me().team}:${me().hero}`;
      post('note', { msg: 'picked', picks });
    }
    const d = parseDrop();
    if (d && q.where === 'lobby') {
      await sleep(d.at * 1000);
      post('note', { msg: 'joiner drops the link in the lobby (' + d.how + ')', n: G.net._test.drop(d.how) });
      await until(() => G.net.reconnecting, 15000, 'reconnecting to start');
      const t1 = performance.now();
      await until(() => !G.net.reconnecting && onScreen('lobby') && me() && me().connected, 60000, 'back in the lobby');
      post('note', { msg: 'back in the lobby', ms: Math.round(performance.now() - t1), status: text('#lobbyStatus') });
      if (picks && `${me().team}:${me().hero}` !== picks) return fail(`picks lost: ${picks} became ${me().team}:${me().hero}`);
    }
    if (q.stay) {
      let re = 0, was = false;
      const end = performance.now() + num('stay') * 1000;
      while (performance.now() < end) { await sleep(200); if (G.net.reconnecting && !was) re++; was = G.net.reconnecting; }
      const ok = re === 0 && onScreen('lobby');
      return done(ok, ok ? '' : `reconnected ${re} times while the host's timers were frozen`, { ms, re });
    }
    if (!q.start) { await sleep(3000); return done(true, '', { ms }); }
    await until(() => G.net.inGame && G.hero, 90000, 'battle started');
    const t = performance.now(), play = num('play', 10) * 1000;
    if (d && q.where !== 'lobby') at(d.at, () => post('note', { msg: 'joiner drops the link (' + d.how + ')', n: G.net._test.drop(d.how) }));
    let reconnects = 0, wasRe = false, reStart = 0, reMs = [], movedLate = false, lost = null;
    const lat = [], rawLat = [];   // order → own hero visibly moving / first snapshot showing it moved, ms
    let order = null, nextOrder = 0, dir = 1;
    while (performance.now() - t < play) {
      await sleep(10);
      const now = performance.now();
      if (G.net.reconnecting && !wasRe) { wasRe = true; reStart = now; order = null; post('note', { msg: 'reconnecting…', banner: text('#netBanner') }); }
      if (!G.net.reconnecting && wasRe) { wasRe = false; reconnects++; reMs.push(Math.round(now - reStart)); post('note', { msg: 'reconnected', ms: reMs[reMs.length - 1] }); }
      const over = $('#gameOver');
      if (over && !over.hidden) { lost = text('#gameOver .result') + ': ' + text('#gameOver .detail'); break; }
      const h = G.hero;
      if (!h || G.net.reconnecting) continue;
      if (order && !order.raw && h._ix1 !== undefined && Math.hypot(h._ix1 - order.x, h._iy1 - order.y) > 3) { order.raw = true; rawLat.push(Math.round(now - order.at)); }
      if (order && !order.seen && Math.hypot(h.x - order.x, h.y - order.y) > 12) {
        order.seen = true;
        lat.push(Math.round(now - order.at));
        if (now - t > play - 8000) movedLate = true;
      }
      if (now > nextOrder && !h.dead) {
        dir = -dir;   // back and forth across the spawn, 300 units each way
        order = { at: now, x: h.x, y: h.y, seen: false };
        G.players[0].act.move(h.x + 300 * dir, h.y);
        nextOrder = now + 3000;
      }
    }
    lat.sort((a, b) => a - b);
    const median = lat.length ? lat[lat.length >> 1] : null;
    rawLat.sort((a, b) => a - b);
    post('note', { msg: 'input latency (order → own hero moving)', median, all: lat, snapshotShowsIt: rawLat, lag: G.net.lag(), fps: await fps() });
    if (q.expect === 'closed') {
      const ok = !!lost && /ended/.test(lost) && !G.net.reconnecting && reconnects === 0;
      return done(ok, ok ? '' : 'expected "host ended the game", got: ' + lost, { lost });
    }
    if (lost) return done(false, 'lost the game: ' + lost, { report: G.net.lastReport });
    const wantRe = num('expectre', d && q.where !== 'lobby' ? 1 : 0);
    const ok = movedLate && reconnects >= wantRe;
    done(ok, ok ? '' : `hero moved in the last 8s: ${movedLate}; reconnects ${reconnects} (wanted ${wantRe})`, { ms, reconnects, reMs, latency: median });
  }
  const root = () => $('#menu');
  // Frames a second right now (how loaded this browser is).
  function fps() { return new Promise(r => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 1000) requestAnimationFrame(f); else r(n); }; requestAnimationFrame(f); setTimeout(() => r(n), 3000); }); }

  // Software-rendered test browsers draw a battle at a few frames a second, which starves the network
  // code of time: unless ?render=1, skip drawing the 3D scene (the HUD, simulation and network still run).
  function lightenRendering() {
    if (q.render === '1') return;
    const wait = setInterval(() => {
      if (!G.render3d || !G.render3d.render) return;
      clearInterval(wait);
      G.render3d.render = function () {};
    }, 50);
  }

  // Networks, simulated in the page (Chrome ignores --force-webrtc-ip-handling-policy now):
  //   nohost=1    the other PC's local addresses never arrive: only public addresses are left, so two
  //               PCs behind one router need it to pass traffic back in (hairpin), as on Wi-Fi that
  //               keeps devices apart
  //   nomdns=1    the other PC's hidden *.local addresses can't be looked up (Wi-Fi dropping multicast);
  //               real addresses, offered with "Same network" on, still get through
  //   relayonly=1 relay-only with no relay: no addresses at all, as on a network that blocks UDP
  function simulateNetwork() {
    if (q.nomdns === '1') {
      // The other PC's hidden (*.local) addresses can't be looked up: Wi-Fi that drops multicast.
      const add = RTCPeerConnection.prototype.addIceCandidate;
      RTCPeerConnection.prototype.addIceCandidate = function (c, ...rest) {
        const line = c && (typeof c === 'string' ? c : c.candidate);
        if (line && /\.local /.test(line)) return Promise.resolve();
        return add.call(this, c, ...rest);
      };
    }
    if (q.nohost === '1') {
      const add = RTCPeerConnection.prototype.addIceCandidate;
      RTCPeerConnection.prototype.addIceCandidate = function (c, ...rest) {
        const line = c && (typeof c === 'string' ? c : c.candidate);
        if (line && / typ (host|prflx)( |$)/.test(line)) return Promise.resolve();
        return add.call(this, c, ...rest);
      };
    }
    if (q.relayonly === '1') G.NET_CONFIG.forceRelay = true;
  }

  async function main() {
    await until(() => G.net && $('[data-go="net"]'), 60000, 'game loaded');
    lightenRendering();
    simulateNetwork();
    await sleep(300);
    post('note', { msg: 'page ready', fps: await fps(), three: typeof THREE, peer: typeof Peer, fns: Object.keys(G).filter(k => typeof G[k] === 'function').length, errors: window.__ntErrors });
    if (q.role === 'probe') return probe();
    if (q.role === 'host') return host();
    if (q.role === 'join') return join();
    fail('no runner for role ' + q.role);
  }
  main().catch(e => fail(String(e && e.message || e)));
  window.NT = { q, post, done, fail, until, sleep, num };
})(window.Game);
