// Network multiplayer: rooms over the Wi-Fi or the internet, up to 3 vs 3.
//
// One player hosts. The host's browser runs the real game; everyone else's browser is a window onto it.
//   - Rooms are found by name through the free PeerJS broker (it only introduces the browsers to each
//     other; game traffic then goes straight between the PCs over WebRTC data channels: across the
//     Wi-Fi when they share one, over the internet when they don't, or through a TURN relay when a
//     network blocks direct connections; see netconfig.js).
//   - Clients send commands (move, attack, cast, build...) and the host applies them to their hero.
//   - The host sends world snapshots 20 times a second: every entity, building, projectile, shot, coin
//     pile and effect, as changes since the last snapshot, plus the particles and floating numbers born
//     since then. Clients keep stand-in copies ("mirrors") of everything and draw those with the normal
//     renderer, smoothing movement between snapshots. Over a slow or jittery link the host sends
//     snapshots less often and clients smooth over longer, so the game slows its updates rather than stalls.
//   - A player who drops out has their hero taken off the field. Joining the room again with the same
//     name (or from the same tab) puts them back in control of it where it stood.
//
// Wire format: JSON strings; anything over CHUNK characters is split into '~id|i|n|part' pieces.
(function (G) {
  const PREFIX = 'frosthaven-rts-';
  const MAX_PER_TEAM = 3;
  const SNAP_MIN = 3, SNAP_MAX = 6;  // simulation steps between snapshots: 20 a second, down to 10 on a struggling link
  const LERP_MIN = 55, LERP_MAX = 250;  // clients ease entities to each new snapshot over this long (follows arrival jitter)
  const CHUNK = 48000;           // characters per data channel message (browsers cap messages near 256 KB)
  const SILENCE_MS = 8000;       // no word from a peer for this long: it's gone
  const BACKLOG = 2e6;           // bytes queued on a channel before we stop sending it deltas and resync
  const PEER_LIB = typeof Peer === 'function';

  const net = G.net = {
    role: null,            // 'host' | 'client' | null
    lobby: null,           // { room, races: [west, east], players: [{ id, name, team, hero, host, connected }], started }
    myId: null,
    onChange: null,        // menu: lobby changed, or an error / disconnect (msg)
    onStart: null,         // menu: a client was handed the match config and its first snapshot; launch the game
    inGame: false
  };

  // ---------------------------------------------------------------------------
  // Identity: a per-tab id (so several tabs on one PC are separate players) and a remembered name.
  // ---------------------------------------------------------------------------
  function store(kind) { try { return window[kind]; } catch (e) { return null; } }
  function get(kind, k) { try { return store(kind)?.getItem(k) ?? null; } catch (e) { return null; } }
  function set(kind, k, v) { try { store(kind)?.setItem(k, v); } catch (e) { /* storage blocked */ } }
  net.myToken = function () {
    let t = get('sessionStorage', 'frost.netId');
    if (!t) { t = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); set('sessionStorage', 'frost.netId', t); }
    return t;
  };
  net.savedName = () => get('localStorage', 'frost.netName') || '';
  net.savedRoom = () => get('localStorage', 'frost.netRoom') || '';

  const slug = s => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const cleanName = s => String(s || '').replace(/[<>&"]/g, '').trim().slice(0, 16);

  // Build fingerprint: every player must run the same game files. Hashes the source of the game's
  // functions and data tables, taken once while still in the menus.
  let printCache = null;
  function fingerprint() {
    if (printCache) return printCache;
    const fnText = (k, v) => (typeof v === 'function' ? v.toString() : v);
    let s = JSON.stringify([G.HEROES, G.BUILDINGS, G.SQUAD_KINDS, G.RACES], fnText);
    for (const k of Object.keys(G).sort()) if (typeof G[k] === 'function') s += k + G[k].toString();
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (printCache = (h >>> 0).toString(16));
  }

  // ---------------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------------
  let peer = null, chunkSeq = 0;
  // Connection settings from netconfig.js: STUN servers to find a way through routers, TURN relays for
  // networks that allow no direct path.
  function peerOpts() {
    const c = G.NET_CONFIG || {};
    const iceServers = [];
    if (c.stun && c.stun.length) iceServers.push({ urls: c.stun });
    for (const t of c.turn || []) iceServers.push(t);
    const config = { iceServers };
    if (c.forceRelay) config.iceTransportPolicy = 'relay';
    return { debug: 1, config };
  }

  // How a link travels and its round trip: 'lan' (same network), 'direct' (over the internet) or
  // 'relay' (through a TURN server), from the connection's selected candidate pair.
  async function measure(link) {
    const pc = link.conn.peerConnection;
    if (!pc || !pc.getStats) return;
    try {
      const stats = await pc.getStats();
      let pair = null;
      stats.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId); });
      if (!pair) stats.forEach(r => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
      if (!pair) return;
      const local = stats.get(pair.localCandidateId), remote = stats.get(pair.remoteCandidateId);
      const types = [local && local.candidateType, remote && remote.candidateType];
      link.route = types.includes('relay') ? 'relay' : types.every(t => t === 'host') ? 'lan' : 'direct';
      if (pair.currentRoundTripTime !== undefined) link.ping = Math.round(pair.currentRoundTripTime * 1000);
    } catch (e) { /* closed meanwhile */ }
  }

  function wrap(conn) {
    const link = { conn, last: performance.now(), parts: {}, onMessage: null, player: null, ready: false, needFull: false };
    link.sendRaw = s => {
      if (!conn.open) return;
      try {
        if (s.length <= CHUNK) { conn.send(s); return; }
        const id = ++chunkSeq, n = Math.ceil(s.length / CHUNK);
        for (let i = 0; i < n; i++) conn.send('~' + id + '|' + i + '|' + n + '|' + s.slice(i * CHUNK, (i + 1) * CHUNK));
      } catch (e) { console.warn('[net] send failed', e); }
    };
    link.send = obj => link.sendRaw(JSON.stringify(obj));
    // Bytes waiting to go out: the browser's queue plus messages PeerJS is holding back.
    link.backlog = () => (conn.dataChannel ? conn.dataChannel.bufferedAmount : 0) + (conn.bufferSize || 0) * CHUNK;
    conn.on('data', d => {
      link.last = performance.now();
      if (typeof d !== 'string') return;
      let text = d;
      if (d[0] === '~') {
        const a = d.indexOf('|'), b = d.indexOf('|', a + 1), c = d.indexOf('|', b + 1);
        const id = d.slice(1, a), i = +d.slice(a + 1, b), n = +d.slice(b + 1, c);
        const p = link.parts[id] || (link.parts[id] = { got: 0, bits: [] });
        p.bits[i] = d.slice(c + 1); p.got++;
        if (p.got < n) return;
        delete link.parts[id];
        text = p.bits.join('');
      }
      let msg;
      try { msg = JSON.parse(text); } catch (e) { return; }
      if (link.onMessage) link.onMessage(msg);
    });
    return link;
  }

  function changed(msg) { if (net.onChange) net.onChange(msg); }

  function needLib() {
    if (PEER_LIB) return null;
    return 'Could not load the networking library (PeerJS). Check that this PC is online, then reload.';
  }

  // Tear everything down (leaving the room, or after a fatal error).
  function shutdown() {
    clearInterval(beat); beat = 0;
    if (peer) { try { peer.destroy(); } catch (e) { /* already gone */ } }
    peer = null; hostLink = null;
    net.role = null; net.lobby = null;
  }

  net.leave = function () {
    if (net.role === 'host') for (const p of players()) if (p.link) p.link.send({ t: 'closed' });
    if (net.role === 'client' && hostLink) hostLink.send({ t: 'bye' });
    // Give the goodbye a moment to leave before the connection closes.
    const p = peer;
    peer = null;
    setTimeout(() => { try { p && p.destroy(); } catch (e) { /* gone */ } }, 150);
    shutdown();
  };

  // ---------------------------------------------------------------------------
  // Hosting
  // ---------------------------------------------------------------------------
  const players = () => (net.lobby ? net.lobby.players : []);
  const publicLobby = () => ({
    room: net.lobby.room, races: net.lobby.races, started: net.lobby.started,
    players: players().map(p => ({ id: p.id, name: p.name, team: p.team, hero: p.hero, host: !!p.host, connected: p.connected,
      route: p.link ? p.link.route || null : null, ping: p.link ? p.link.ping ?? null : null }))
  });
  function broadcast(obj) { const s = JSON.stringify(obj); for (const p of players()) if (p.link && p.link.conn.open) p.link.sendRaw(s); }
  function lobbyChanged() { broadcast({ t: 'lobby', lobby: publicLobby() }); changed(); }

  function teamCount(team) { return players().filter(p => p.team === team).length; }
  function openTeam() { return teamCount(0) <= teamCount(1) ? (teamCount(0) < MAX_PER_TEAM ? 0 : 1) : (teamCount(1) < MAX_PER_TEAM ? 1 : 0); }
  function uniqueName(name, self) {
    let n = name, i = 2;
    while (players().some(p => p !== self && p.name.toLowerCase() === n.toLowerCase())) n = name + ' ' + i++;
    return n;
  }

  net.host = function (roomName, playerName) {
    return new Promise((resolve, reject) => {
      const err = needLib(); if (err) return reject(err);
      const room = roomName.trim(), id = slug(room), name = cleanName(playerName);
      if (!id) return reject('Type a room name (letters or numbers).');
      if (!name) return reject('Type your name first.');
      set('localStorage', 'frost.netName', name); set('localStorage', 'frost.netRoom', room);
      shutdown();
      fingerprint();
      let settled = false;
      peer = new Peer(PREFIX + id, peerOpts());
      peer.on('open', () => {
        net.role = 'host';
        net.myId = net.myToken();
        net.lobby = { room, races: ['human', 'algox'], started: false,
          players: [{ id: net.myId, name, team: 0, hero: G.HEROES[0].id, host: true, connected: true, link: null }] };
        startBeat();
        settled = true; resolve();
        changed();
      });
      peer.on('connection', onIncoming);
      peer.on('disconnected', () => {
        // Lost the broker (not the players): reconnect so the room can still be found.
        setTimeout(() => { if (peer && !peer.destroyed && peer.disconnected) try { peer.reconnect(); } catch (e) { /* retry next time */ } }, 1500);
      });
      peer.on('error', e => {
        console.warn('[net] host error', e.type, e);
        const msg = e.type === 'unavailable-id' ? `A room called "${room}" is already open. Join it, or pick another name.`
          : e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error' ? 'Could not reach the room finder. Check the internet connection.'
          : e.type === 'browser-incompatible' ? 'This browser does not support WebRTC. Use Chrome or Edge.'
          : null;
        if (!settled) { settled = true; shutdown(); reject(msg || 'Could not create the room (' + e.type + ').'); }
        else if (msg && e.type !== 'unavailable-id') changed({ error: msg });
      });
    });
  };

  function onIncoming(conn) {
    const link = wrap(conn);
    link.onMessage = m => {
      if (m.t === 'hello') { hello(link, m); return; }
      const p = link.player;
      if (!p || p.link !== link) return;
      if (m.t === 'pick') pick(p, m);
      else if (m.t === 'cmd' && Array.isArray(m.c)) for (const c of m.c) cmdQueue.push({ p, c });
      else if (m.t === 'bye') dropLink(link);
    };
    conn.on('close', () => dropLink(link));
    conn.on('error', () => dropLink(link));
    pending.add(link);
  }
  const pending = new Set();   // links that haven't said hello yet

  function reject(link, reason) {
    link.send({ t: 'reject', reason });
    setTimeout(() => { try { link.conn.close(); } catch (e) { /* gone */ } }, 300);
  }

  function hello(link, m) {
    pending.delete(link);
    if (!net.lobby) return reject(link, 'The room has closed.');
    if (m.ver !== fingerprint()) return reject(link, 'Your game files don’t match the host’s. Everyone needs the same version of the game (copy the host’s files, or all play from the same web link).');
    const name = cleanName(m.name);
    if (!name) return reject(link, 'Type your name first.');
    let p = players().find(q => q.id === m.id && !q.host);
    // Coming back from another tab or after closing the browser: the same name takes back a dropped hero.
    if (!p) p = players().find(q => !q.connected && !q.host && q.name.toLowerCase() === name.toLowerCase());
    if (p) {
      if (p.link && p.link !== link) { const old = p.link; p.link = null; try { old.conn.close(); } catch (e) { /* gone */ } }
    } else {
      if (net.lobby.started) return reject(link, 'This battle has already started. Only players who were in it can rejoin.');
      if (players().length >= MAX_PER_TEAM * 2) return reject(link, 'The room is full (6 players).');
      p = { id: m.id, name: '', team: openTeam(), hero: G.HEROES[players().length % G.HEROES.length].id, host: false, connected: false, link: null };
      players().push(p);
    }
    p.name = uniqueName(name, p);
    const back = net.lobby.started && !p.connected;
    p.connected = true; p.link = link; link.player = p;
    link.send({ t: 'welcome', you: p.id, lobby: publicLobby() });
    if (net.lobby.started) {
      heroBack(p);
      sendGame(link);
      if (back) note(`${p.name} is back`);
    }
    lobbyChanged();
  }

  function dropLink(link) {
    pending.delete(link);
    const p = link.player;
    if (!p || p.link !== link) return;
    p.link = null; p.connected = false;
    if (!net.lobby) return;
    if (!net.lobby.started) {
      net.lobby.players = players().filter(q => q !== p);
    } else {
      heroAway(p);
      note(`${p.name} disconnected — their hero is out until they rejoin`);
    }
    lobbyChanged();
  }

  function pick(p, m) {
    if (net.lobby.started) return;
    if ((m.team === 0 || m.team === 1) && m.team !== p.team && teamCount(m.team) < MAX_PER_TEAM) p.team = m.team;
    if (typeof m.hero === 'string' && G.HEROES.some(h => h.id === m.hero)) p.hero = m.hero;
    lobbyChanged();
  }

  // The host's own picks, and the races (host only).
  net.pick = function (o) {
    if (net.role === 'host') pick(players().find(p => p.id === net.myId), o);
    else if (hostLink) hostLink.send(Object.assign({ t: 'pick' }, o));
  };
  net.setRace = function (team, raceId) {
    if (net.role !== 'host' || net.lobby.started) return;
    net.lobby.races[team] = raceId;
    lobbyChanged();
  };

  // Host: begin the battle. Returns the match config for G.startGame.
  net.startMatch = function () {
    const L = net.lobby;
    L.started = true;
    lobbyChanged();
    return { mode: 'nethost', room: L.room, races: L.races.slice(), me: net.myId,
      roster: players().map(p => ({ id: p.id, name: p.name, team: p.team, hero: p.hero })) };
  };

  // Notices: a toast for everyone.
  function note(text) { broadcast({ t: 'note', text }); toast(text); }

  // ---------------------------------------------------------------------------
  // Joining
  // ---------------------------------------------------------------------------
  let hostLink = null, pendingConfig = null, pendingSnap = null;

  net.join = function (roomName, playerName) {
    return new Promise((resolve, reject) => {
      const err = needLib(); if (err) return reject(err);
      const room = roomName.trim(), id = slug(room), name = cleanName(playerName);
      if (!id) return reject('Type the room name.');
      if (!name) return reject('Type your name first.');
      set('localStorage', 'frost.netName', name); set('localStorage', 'frost.netRoom', room);
      shutdown();
      let settled = false;
      const fail = msg => { if (settled) return; settled = true; clearTimeout(timer); shutdown(); reject(msg); };
      // Found the room but no path to the host's PC: a network on one side blocks the connection.
      const blocked = 'Found the room, but couldn’t connect to the host’s PC: one of your networks is blocking the connection. Try again; if it keeps failing, add a TURN relay server in js/netconfig.js (see the notes there) or try another network.';
      // The host has answered once its reply (remote description) is in: from then on, a failure is the path.
      let conn = null;
      const found = () => !!(conn && conn.peerConnection && conn.peerConnection.remoteDescription);
      const timer = setTimeout(() => fail(found() ? blocked : `Couldn’t reach the room "${room}". Check the internet connection and that the host still has the room open.`), 20000);
      peer = new Peer(peerOpts());
      peer.on('error', e => {
        console.warn('[net] client error', e.type, e);
        if (e.type === 'peer-unavailable') fail(`No room called "${room}" was found. Check the spelling, or ask the host to create it.`);
        else if (!settled) fail(e.type === 'browser-incompatible' ? 'This browser does not support WebRTC. Use Chrome or Edge.' : 'Could not reach the room finder. Check the internet connection.');
      });
      peer.on('open', () => {
        conn = peer.connect(PREFIX + id, { serialization: 'raw', reliable: true });
        const link = wrap(conn);
        hostLink = link;
        conn.on('iceStateChanged', st => { if (st === 'failed' && !settled) fail(blocked); });
        conn.on('error', e => { if (e && e.type === 'negotiation-failed') fail(blocked); });
        conn.on('open', () => link.send({ t: 'hello', id: net.myToken(), name, ver: fingerprint() }));
        conn.on('close', () => { if (hostLink === link) hostGone(settled ? 'The connection to the host was lost.' : null); if (!settled) fail('The host closed the connection.'); });
        link.onMessage = m => {
          if (m.t === 'reject') { fail(m.reason); return; }
          if (m.t === 'welcome') {
            settled = true; clearTimeout(timer);
            net.role = 'client'; net.myId = m.you; net.lobby = m.lobby;
            startBeat();
            resolve(); changed();
            return;
          }
          if (m.t === 'lobby') { net.lobby = m.lobby; changed(); return; }
          if (m.t === 'note') { toast(m.text); return; }
          if (m.t === 'closed') { hostGone('The host closed the room.', true); return; }
          if (m.t === 'game') { pendingConfig = m.config; return; }
          if (m.t === 'snap') {
            if (net.inGame) applySnap(m);
            else if (m.full && pendingConfig) { pendingSnap = m; net.inGame = true; if (net.onStart) net.onStart(pendingConfig); }
          }
        };
      });
    });
  };

  // closed: the host ended the room on purpose (nothing to rejoin).
  function hostGone(why, closed) {
    if (!net.role && !net.inGame) return;
    const wasIn = net.inGame;
    shutdown();
    if (why === null) return;
    if (wasIn) showLost(why, closed);
    else changed({ error: why, left: true });
  }

  // Heartbeat: pings both ways each second; a silent peer is dropped.
  let beat = 0, beatNo = 0, lastRoutes = '';
  async function measureAll() {
    const ls = players().filter(p => p.link && p.link.conn.open).map(p => p.link);
    await Promise.all(ls.map(measure));
    // Only re-send the lobby when a route changed or a ping moved noticeably.
    const sig = ls.map(l => l.route + ':' + Math.round((l.ping || 0) / 20)).join('|');
    if (sig !== lastRoutes && net.lobby) { lastRoutes = sig; lobbyChanged(); }
  }
  function startBeat() {
    clearInterval(beat);
    beat = setInterval(() => {
      const now = performance.now();
      if (net.role === 'host') {
        broadcast({ t: 'ping' });
        if (++beatNo % 2 === 0) measureAll();
        for (const p of players()) if (p.link && now - p.link.last > SILENCE_MS) { const l = p.link; try { l.conn.close(); } catch (e) { /* gone */ } dropLink(l); }
        for (const l of pending) if (now - l.last > SILENCE_MS) { pending.delete(l); try { l.conn.close(); } catch (e) { /* gone */ } }
      } else if (net.role === 'client' && hostLink) {
        hostLink.send({ t: 'ping' });
        if (++beatNo % 2 === 0) measure(hostLink);
        if (now - hostLink.last > SILENCE_MS) hostGone('The host stopped responding.');
      }
    }, 1000);
  }

  // ---------------------------------------------------------------------------
  // Hero commands. Local players call these on their own hero; the host calls them for remote players.
  // ---------------------------------------------------------------------------
  G.heroCmd = {
    move(h, x, y) { h.attackTarget = null; h.demolishTarget = null; h.moveTo(x, y); },
    stop(h) { h.target = null; },
    attack(h, foe) { h.demolishTarget = null; h.target = null; h.attackTarget = foe; },
    clearDemolish(h) { h.demolishTarget = null; },
    demolish(h, b) { h.demolishTarget = b; },
    cast(h, ab, x, y) { return G.tryCast(h, ab, x, y); },
    follow(h) { return G.commandFollow(h); },
    build(h, hit, type, team) { return G.placeBuilding(h, hit, type, team); }
  };
  // A player's actions on their own hero, straight into the simulation.
  G.localActions = function (p) {
    const A = {};
    for (const k in G.heroCmd) A[k] = (...args) => G.heroCmd[k](p.hero, ...args);
    return A;
  };

  // Host: queued commands from remote players, applied at the start of each simulation step.
  const cmdQueue = [];
  const heroes = new Map();   // player id -> hero
  function byNid(list, id) { for (const o of list) if (o.nid === id) return o; return null; }
  function refTo(r) {
    if (!Array.isArray(r)) return null;
    if (r[0] === 'e') return byNid(G.entities, r[1]);
    if (r[0] === 'b') return byNid(G.buildingList(), r[1]);
    return null;
  }
  net.hostCommands = function () {
    while (cmdQueue.length) {
      const { p, c } = cmdQueue.shift();
      const h = heroes.get(p.id);
      if (!h || h.away || !Array.isArray(c)) continue;
      const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);
      const C = G.heroCmd;
      switch (c[0]) {
        case 'm': if (!h.dead) C.move(h, num(c[1]), num(c[2])); break;
        case 's': C.stop(h); break;
        case 'a': { const t = refTo(c[1]); if (t && !t.dead && t.team !== h.team && !h.dead) C.attack(h, t); break; }
        case 'x': C.clearDemolish(h); break;
        case 'd': { const b = refTo(c[1]); if (b && !b.dead && b.team === h.team && !G.BUILDINGS[b.type].command && !h.dead) C.demolish(h, b); break; }
        case 'c': { const ab = h.def.abilities[c[1]]; if (ab) C.cast(h, ab, num(c[2]), num(c[3])); break; }
        case 'f': if (!h.dead) C.follow(h); break;
        case 'b': {
          const base = G.bases[c[1]], slot = base && base.slots[c[2]], def = G.BUILDINGS[c[3]];
          if (slot && !slot.core && def && !def.command && !h.dead) C.build(h, { base, slot }, c[3]);
          break;
        }
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Host: the match
  // ---------------------------------------------------------------------------
  // Called by G.startGame once the heroes exist: heroById maps player id -> hero.
  net.hostBegin = function (heroById) {
    heroes.clear();
    for (const id in heroById) heroes.set(id, heroById[id]);
    net.inGame = true;
    G.keepAlive = true;
    for (const p of players()) {
      if (p.host) continue;
      if (p.link && p.link.conn.open) sendGame(p.link);
      else heroAway(p);   // dropped between Start and now
    }
  };

  function sendGame(link) {
    const L = net.lobby, p = link.player;
    const heroIds = {};
    for (const [id, h] of heroes) heroIds[id] = idOf(h);
    link.send({ t: 'game', config: { mode: 'netclient', room: L.room, races: L.races, me: p.id, heroIds,
      roster: players().map(q => ({ id: q.id, name: q.name, team: q.team, hero: q.hero })) } });
    link.ready = true;
    link.needFull = true;
  }

  // A player left: their hero leaves the field (everything aiming at it lets go) until they're back.
  function heroAway(p) {
    const h = heroes.get(p.id);
    if (!h || h.away) return;
    h.away = true; h.awayDead = h.dead;
    if (G.releaseFollowers) G.releaseFollowers(h);
    h.dead = true;   // so anything holding on to it gives up
    h.target = h.attackTarget = h.demolishTarget = null; h.dash = null; h.lift = 0;
    G.entities = G.entities.filter(e => e !== h);
    for (const e of G.entities) { if (e.attackTarget === h) e.attackTarget = null; if (e.foe === h) e.foe = null; }
    for (const sq of G.squads) if (sq.target === h) sq.target = null;
  }
  function heroBack(p) {
    const h = heroes.get(p.id);
    if (!h || !h.away) return;
    h.away = false; h.dead = h.awayDead;
    if (!G.entities.includes(h)) G.entities.push(h);
  }
  net.isAway = h => !!h.away;
  net.playerName = h => { for (const [id, x] of heroes) if (x === h) { const p = players().find(q => q.id === id); return p ? p.name : ''; } return ''; };

  // ---------------------------------------------------------------------------
  // Snapshots. Each synced list ("collection") is diffed per object and per field against what was
  // last sent. Values: numbers rounded, references to entities / buildings / projectiles as {$e|$b|$p: id}.
  // ---------------------------------------------------------------------------
  let nextId = 0;
  const idOf = o => o.nid || (o.nid = ++nextId);
  // Big values (positions, hit points) to whole units, small ones (angles, timers) to 3 decimals.
  const round = v => (Math.abs(v) >= 50 ? Math.round(v) : Math.round(v * 1000) / 1000);
  const isBuilding = v => v.slot && v.base && v.type !== undefined;
  const isProjectile = v => v.traveled !== undefined && v.vx !== undefined;
  const SKIP = new Set(['motes', 'px', 'py', 'ph', 'nid', 'acc', 'hit', 'hits']);

  function enc(v, depth) {
    if (v === null || v === undefined) return null;
    const t = typeof v;
    if (t === 'number') return isFinite(v) ? round(v) : null;
    if (t === 'string' || t === 'boolean') return v;
    if (t !== 'object') return undefined;
    if (v instanceof G.Entity) return v.away ? null : { $e: idOf(v) };
    if (isBuilding(v)) return { $b: idOf(v) };
    if (isProjectile(v)) return { $p: idOf(v) };
    if (depth > 3) return undefined;
    if (Array.isArray(v)) return v.map(x => { const e = enc(x, depth + 1); return e === undefined ? null : e; });
    if (Object.getPrototypeOf(v) !== Object.prototype) return undefined;   // Sets, Three.js objects, ...
    const o = {};
    for (const k in v) {
      if (SKIP.has(k) || k[0] === '_') continue;
      const e = enc(v[k], depth + 1);
      if (e !== undefined) o[k] = e;
    }
    return o;
  }
  function encPlain(o) {
    const out = {};
    for (const k in o) {
      if (SKIP.has(k) || k[0] === '_') continue;
      const e = enc(o[k], 1);
      if (e !== undefined) out[k] = e;
    }
    return out;
  }

  // Entities send only what the renderer, HUD and controls read.
  const COMMON_F = ['x', 'y', 'r', 'hp', 'maxHp', 'team', 'dead', 'facing', 'flash', 'stunTimer', 'rootTimer', 'slowTimer', 'shieldAmt', 'shieldColor', 'marks', 'dots'];
  const HERO_F = COMMON_F.concat(['def', 'swing', 'swingAlt', 'castAnim', 'castSlot', 'moving', 'lift', 'untargetable', 'buffs',
    'mana', 'maxMana', 'gold', 'cooldowns', 'state', 'form', 'dash', 'attackTarget', 'demolishTarget', 'history']);
  const SOLDIER_F = COMMON_F.concat(['kind', 'ranged', 'swing', 'moving', 'auraOn', 'aim']);
  const DUMMY_F = COMMON_F.concat(['homeX']);
  const ENC_SPECIAL = {
    def: e => e.def.id,
    dots: e => e.dots.map(d => d.color),
    marks: e => Object.keys(e.marks),
    dash: e => (e.dash ? 1 : 0),
    // Only the sample Rewind would jump back to, and the newest.
    history: e => {
      const h = e.history;
      if (!h.length) return [];
      const a = h[Math.max(0, h.length - 30)], b = h[h.length - 1];
      return [[round(a.x), round(a.y), Math.round(a.hp)], [round(b.x), round(b.y), Math.round(b.hp)]];
    }
  };
  function encEntity(e) {
    const F = e instanceof G.Hero ? HERO_F : e instanceof G.Soldier ? SOLDIER_F : DUMMY_F;
    const o = {};
    for (const k of F) {
      const s = ENC_SPECIAL[k];
      const v = s ? s(e) : enc(e[k], 1);
      o[k] = v === undefined ? null : v;
    }
    return o;
  }
  const slotKey = b => b.base.id * 8 + b.base.slots.indexOf(b.slot);

  // list(): live objects. cls(o): short type tag. encode(o) -> plain object. skip(o): fields not
  // re-sent after creation (clients advance those themselves).
  const COLLS = {
    E: { list: () => G.entities, cls: e => (e instanceof G.Hero ? 'H' : e instanceof G.Soldier ? 'S' : 'D'), encode: encEntity },
    B: { list: () => G.buildingList(), cls: b => 'b',
      encode: b => ({ k: slotKey(b), type: b.type, team: b.team, hp: round(b.hp), maxHp: b.maxHp, aim: b.aim === undefined ? null : round(b.aim), fired: b.fired ? round(b.fired) : 0 }) },
    P: { list: () => G.projectiles, cls: () => 'p', encode: encPlain, skip: () => ['t', 'traveled'] },
    T: { list: () => G.shots, cls: () => 't', encode: encPlain, skip: s => (s.rolling ? ['t'] : ['t', 'x', 'y', 'h']) },
    C: { list: () => G.coins, cls: () => 'c', encode: encPlain, skip: () => ['t'] },
    F: { list: () => G.fx, cls: () => 'f', encode: encPlain, skip: () => ['t'] }
  };
  const ORDER = ['E', 'B', 'P', 'T', 'C', 'F'];
  for (const k of ORDER) COLLS[k].last = new Map();
  const sigOf = v => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);

  function diffColl(c, out, full) {
    const seen = new Map();
    const add = [], upd = [], del = [], all = full ? [] : null;
    for (const o of c.list()) {
      if (o.dead && c !== COLLS.E) continue;
      const id = idOf(o), data = c.encode(o), cls = c.cls(o);
      const prev = c.last.get(id), sigs = {};
      if (!prev) {
        add.push([id, cls, data]);
        for (const k in data) sigs[k] = sigOf(data[k]);
      } else {
        const skip = c.skip ? c.skip(o) : null;
        let ch = null;
        for (const k in data) {
          if (skip && skip.includes(k) && k in prev) { sigs[k] = prev[k]; continue; }
          const s = sigs[k] = sigOf(data[k]);
          if (s !== prev[k]) (ch || (ch = {}))[k] = data[k];
        }
        if (ch) upd.push([id, ch]);
      }
      seen.set(id, sigs);
      if (all) all.push([id, cls, data]);
    }
    for (const id of c.last.keys()) if (!seen.has(id)) del.push(id);
    c.last = seen;
    if (add.length || upd.length || del.length) out.d = { a: add, u: upd, x: del };
    if (all) out.f = { a: all };
  }

  // New particles and floaters since the last snapshot travel as compact rows.
  function newParticles() {
    const out = [];
    for (const p of G.particles) {
      if (p._s) continue;
      p._s = 1;
      out.push([round(p.x), round(p.y), p.h === undefined ? null : round(p.h), Math.round(p.vx), Math.round(p.vy), round(p.life), p.color, round(p.size), round(p.t)]);
    }
    return out;
  }
  function newFloaters() {
    const out = [];
    for (const f of G.floaters) {
      if (f._s) continue;
      f._s = 1;
      out.push([round(f.x), round(f.y), f.text, f.color, round(f.t)]);
    }
    return out;
  }

  let stepNo = 0, lastBaseTeams = '', snapEvery = SNAP_MIN, rateAt = 0, calmSince = 0;
  // Host: once per simulation step, after the world moved.
  net.hostTick = function () {
    if (++stepNo % snapEvery) return;
    const links = players().filter(p => p.link && p.link.ready && p.link.conn.open).map(p => p.link);
    // A link with data piling up: send less often for everyone (deltas then just cover more time);
    // once every link has kept up for 3 seconds, speed back up.
    const worst = links.reduce((m, l) => Math.max(m, l.backlog()), 0);
    if (worst > 64e3 && stepNo - rateAt > 60) { snapEvery = Math.min(SNAP_MAX, snapEvery + 1); rateAt = stepNo; }
    else if (worst > 4e3) calmSince = stepNo;
    else if (snapEvery > SNAP_MIN && stepNo - calmSince > 180 && stepNo - rateAt > 180) { snapEvery--; rateAt = stepNo; }
    for (const l of links) if (l.backlog() > BACKLOG) l.needFull = true;   // too far behind: skip, then resync
    const wantFull = links.some(l => l.needFull && l.backlog() < BACKLOG / 4);
    const delta = { t: 'snap', w: G.winner, c: {} }, full = wantFull ? { t: 'snap', full: 1, w: G.winner, c: {} } : null;
    for (const k of ORDER) {
      const o = {};
      diffColl(COLLS[k], o, !!full);
      if (o.d) delta.c[k] = o.d;
      if (full) full.c[k] = o.f;
    }
    const bt = JSON.stringify(G.bases.map(b => b.team));
    if (bt !== lastBaseTeams) { delta.bt = JSON.parse(bt); lastBaseTeams = bt; }
    if (full) full.bt = JSON.parse(bt);
    const pa = newParticles(), fl = newFloaters();
    if (pa.length) delta.pa = pa;
    if (fl.length) delta.fl = fl;
    if (full) { full.pa = pa; full.fl = fl; }
    if (!links.length) return;
    const ds = JSON.stringify(delta), fs = full ? JSON.stringify(full) : null;
    for (const l of links) {
      if (l.needFull) { if (fs && l.backlog() < BACKLOG / 4) { l.sendRaw(fs); l.needFull = false; } }
      else l.sendRaw(ds);
    }
  };

  // ---------------------------------------------------------------------------
  // Client: mirrors of the host's world
  // ---------------------------------------------------------------------------
  const mirrors = { E: new Map(), B: new Map(), P: new Map(), T: new Map(), C: new Map(), F: new Map() };

  function dec(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(dec);
    if (v.$e !== undefined) return mirrors.E.get(v.$e) || null;
    if (v.$b !== undefined) return mirrors.B.get(v.$b) || null;
    if (v.$p !== undefined) return mirrors.P.get(v.$p) || null;
    const o = {};
    for (const k in v) o[k] = dec(v[k]);
    return o;
  }

  function makeEntity(cls) {
    const proto = cls === 'H' ? G.Hero.prototype : cls === 'S' ? G.Soldier.prototype : G.AlgoxDummy.prototype;
    return Object.assign(Object.create(proto), {
      x: 0, y: 0, r: 10, hp: 1, maxHp: 1, team: 0, dead: false, facing: 0, flash: 0,
      slowTimer: 0, slowAmount: 0, stunTimer: 0, rootTimer: 0, knock: null, dots: [], dotAcc: 0,
      shieldAmt: 0, shieldTimer: 0, shieldColor: 0x9fdcff, buffs: {}, marks: {},
      swing: 0, swingAlt: false, castAnim: 0, castSlot: -1, moving: false, lift: 0, untargetable: false,
      cooldowns: {}, state: {}, history: [], form: null, dash: null, attackTarget: null, demolishTarget: null,
      mana: 0, maxMana: 1, gold: 0, target: null, followers: [], homeX: 0
    });
  }

  function slotOf(k) { const base = G.bases[Math.floor(k / 8)]; return base ? { base, slot: base.slots[k % 8] } : null; }

  function applyEntity(e, data, fresh) {
    let moved = false, nx = e._ix1, ny = e._iy1;
    for (const k in data) {
      const v = data[k];
      switch (k) {
        case 'x': nx = v; moved = true; break;
        case 'y': ny = v; moved = true; break;
        case 'def': e.def = G.heroById(v); break;
        case 'dots': e.dots = (v || []).map(color => ({ color })); break;
        case 'marks': e.marks = {}; for (const m of v || []) e.marks[m] = 1; break;
        case 'dash': e.dash = v ? {} : null; break;
        case 'history': e.history = (v || []).map(a => ({ x: a[0], y: a[1], hp: a[2] })); break;
        default: e[k] = dec(v);
      }
    }
    if (!moved) return;
    if (fresh || e._it === undefined || Math.hypot(nx - e.x, ny - e.y) > 400) {
      e.x = e._ix0 = e._ix1 = nx; e.y = e._iy0 = e._iy1 = ny; e._it = 0;
    } else {
      e._ix0 = e.x; e._iy0 = e.y; e._ix1 = nx; e._iy1 = ny; e._it = performance.now();
    }
  }

  function removeMirror(k, o) {
    if (k === 'B') {
      o.dead = true; o.hp = 0;
      if (o.slot.building === o) { o.slot.building = null; G.buildingsChanged(); }
    }
  }

  function createMirror(k, id, cls, data) {
    if (k === 'E') return makeEntity(cls);
    if (k === 'B') {
      const at = slotOf(data.k);
      if (!at) return null;
      // Command Centers already stand on both sides (built at setup): adopt them.
      const cur = at.slot.building;
      let owned = false;
      for (const o of mirrors.B.values()) if (o === cur) owned = true;
      if (cur && !owned && cur.type === data.type) return cur;
      if (cur) removeMirror('B', cur);
      return G.addBuilding(at.base, at.slot, data.type, data.team);
    }
    return {};
  }

  // Snapshot arrival rhythm: the smoothing time follows the average gap plus twice its wobble.
  let lastArrival = 0, gapAvg = 50, gapDev = 10, lerpMs = 65;
  function applySnap(m) {
    const now = performance.now();
    if (lastArrival && !m.full) {
      const gap = Math.min(1000, now - lastArrival);
      gapAvg += (gap - gapAvg) * 0.1;
      gapDev += (Math.abs(gap - gapAvg) - gapDev) * 0.1;
      lerpMs = G.clamp(gapAvg + 2 * gapDev, LERP_MIN, LERP_MAX);
    }
    lastArrival = now;
    // Pass 1: create new objects (so references inside this snapshot resolve), drop departed ones.
    for (const k of ORDER) {
      const c = m.c[k], map = mirrors[k];
      if (m.full) {
        const keep = new Set((c ? c.a : []).map(r => r[0]));
        for (const [id, o] of map) if (!keep.has(id)) { removeMirror(k, o); map.delete(id); }
      }
      if (!c) continue;
      for (const id of c.x || []) { const o = map.get(id); if (o) { removeMirror(k, o); map.delete(id); } }
      for (const [id, cls, data] of c.a || []) {
        if (map.has(id)) continue;
        const o = createMirror(k, id, cls, data);
        if (o) { o.nid = id; o._fresh = true; map.set(id, o); }
      }
    }
    // Pass 2: fill in fields.
    for (const k of ORDER) {
      const c = m.c[k], map = mirrors[k];
      if (!c) continue;
      const rows = (c.a || []).map(r => [r[0], r[2]]).concat(c.u || []);
      for (const [id, data] of rows) {
        const o = map.get(id);
        if (!o) continue;
        const fresh = !!o._fresh;
        o._fresh = false;
        if (k === 'E') applyEntity(o, data, fresh);
        else if (k === 'B') { for (const f in data) if (f !== 'k') o[f] = data[f]; if (o.aim === null) delete o.aim; }
        else {
          for (const f in data) o[f] = dec(data[f]);
          if (k === 'T' && fresh) { o.px = o.x; o.py = o.y; o.ph = o.h; }
          if (k === 'F') {
            if (o.dead === undefined) o.dead = false;
            if ('to' in o && !o.to) o.to = { x: o.x, y: o.y };   // soul wisp whose hero isn't on the field
          }
        }
      }
    }
    G.entities = [...mirrors.E.values()];
    G.projectiles = [...mirrors.P.values()];
    G.shots = [...mirrors.T.values()];
    G.coins = [...mirrors.C.values()];
    G.fx = [...mirrors.F.values()];
    if (m.bt) m.bt.forEach((t, i) => { if (G.bases[i]) G.bases[i].team = t; });
    for (const r of m.pa || []) G.particles.push({ x: r[0], y: r[1], h: r[2] === null ? undefined : r[2], vx: r[3], vy: r[4], life: r[5], color: r[6], size: r[7], t: r[8] });
    for (const r of m.fl || []) G.floaters.push({ x: r[0], y: r[1], text: r[2], color: r[3], t: r[4] });
    if (m.w !== null && m.w !== undefined && G.winner === null && G.endGame) G.endGame(m.w);
  }

  // Called by G.startGame on a client after the world is laid out: applies the first snapshot and
  // returns the player's own hero.
  net.lag = () => ({ ping: hostLink ? hostLink.ping ?? null : null, route: hostLink ? hostLink.route || null : null, smoothMs: Math.round(lerpMs) });
  net.clientBegin = function (config) {
    G.keepAlive = false;
    if (pendingSnap) { applySnap(pendingSnap); pendingSnap = null; }
    return mirrors.E.get(config.heroIds[config.me]) || null;
  };

  // Client, every simulation step: move mirrors between snapshots so motion and animations stay smooth.
  net.clientStep = function (dt) {
    const now = performance.now();
    for (const e of G.entities) {
      if (e._it) {
        const a = Math.min(1, (now - e._it) / lerpMs);
        e.x = e._ix0 + (e._ix1 - e._ix0) * a; e.y = e._iy0 + (e._iy1 - e._iy0) * a;
        if (a >= 1) e._it = 0;
      }
      if (e.swing > 0) e.swing = Math.max(0, e.swing - dt * 2.5);
      if (e.castAnim > 0) e.castAnim = Math.max(0, e.castAnim - dt * 1.6);
      if (e.flash > 0) e.flash -= dt;
      for (const k in e.cooldowns) e.cooldowns[k] = Math.max(0, e.cooldowns[k] - dt);
    }
    for (const b of G.buildingList()) if (b.fired > 0) b.fired = Math.max(0, b.fired - dt * 1.5);
    for (const p of G.projectiles) { p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt; }
    for (const s of G.shots) {
      if (s.rolling) {
        if (!s.roll || !(s.rolling.left > 0)) continue;
        const step = Math.min(s.rolling.left, s.roll.speed * dt);
        s.x += s.rolling.dx * step; s.y += s.rolling.dy * step; s.rolling.left -= step;
        s.spin = (s.spin || 0) + step / 20;
        continue;
      }
      if (s.target && !s.target.dead) { s.tx = s.target.x; s.ty = s.target.y; }
      s.t = (s.t || 0) + dt;
      const k = Math.min(1, s.t / (s.dur || 1));
      s.x = G.lerp(s.x0, s.tx, k); s.y = G.lerp(s.y0, s.ty, k);
      s.h = G.lerp(s.h0, 20, k) + (s.arc || 0) * 4 * k * (1 - k);
    }
    for (const c of G.coins) c.t = (c.t || 0) + dt;
    for (const o of G.fx) o.t = Math.min(o.dur || 0, (o.t || 0) + dt);
    G.updateEffects(dt);
    flushCommands();
  };

  // Client: the player's actions become commands to the host. Refs name things by their host id.
  let outbox = [], lastMove = null;
  function send(c) { outbox.push(c); }
  function flushCommands() {
    if (!outbox.length || !hostLink) return;
    hostLink.send({ t: 'cmd', c: outbox });
    outbox = [];
  }
  const ref = o => (o instanceof G.Entity ? ['e', o.nid] : ['b', o.nid]);
  net.clientActions = function (p) {
    const hero = () => p.hero;
    return {
      move(x, y) {
        // A held stick asks every step: only pass it on when it changed or now and then.
        const now = performance.now();
        if (lastMove && now - lastMove.at < 90 && Math.hypot(x - lastMove.x, y - lastMove.y) < 40) return;
        lastMove = { x, y, at: now };
        hero().attackTarget = null; hero().demolishTarget = null;
        send(['m', Math.round(x), Math.round(y)]);
      },
      stop() { lastMove = null; send(['s']); },
      attack(foe) { if (!foe.nid) return; lastMove = null; hero().attackTarget = foe; hero().demolishTarget = null; send(['a', ref(foe)]); },
      clearDemolish() { hero().demolishTarget = null; send(['x']); },
      demolish(b) { hero().demolishTarget = b; send(['d', ref(b)]); },
      cast(ab, x, y) {
        if (!G.canCast(hero(), ab)) return false;
        send(['c', hero().def.abilities.indexOf(ab), Math.round(x), Math.round(y)]);
        return true;
      },
      follow() { send(['f']); return true; },
      build(hit, type) { send(['b', hit.base.id, hit.base.slots.indexOf(hit.slot), type]); return true; }
    };
  };

  // ---------------------------------------------------------------------------
  // In-game notices and the "connection lost" screen
  // ---------------------------------------------------------------------------
  let toastEl = null, toastTimer = 0;
  function toast(text) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.id = 'netToast'; document.body.appendChild(toastEl); }
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 4500);
  }
  net.toast = toast;

  function showLost(why, closed) {
    net.inGame = false;
    const el = document.getElementById('gameOver');
    if (!el || G.winner !== null) return;
    el.classList.add('defeat');
    el.querySelector('.result').textContent = 'Disconnected';
    el.querySelector('.detail').textContent = why + (closed ? '' : ' If the host is still playing, go back to the menu and join the same room to get your hero back.');
    el.querySelector('button').textContent = 'Back to menu';
    el.hidden = false;
    G.netLost = true;
  }

  // Return to the menu (reloading the page), landing on the network screen.
  net.backToMenu = function () {
    set('sessionStorage', 'frost.netReturn', '1');
    location.href = location.pathname + location.search;
  };
  net.takeReturnFlag = function () {
    const v = get('sessionStorage', 'frost.netReturn') === '1';
    if (v) set('sessionStorage', 'frost.netReturn', '0');
    return v;
  };
})(window.Game);
