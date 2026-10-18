// Network multiplayer: rooms over the Wi-Fi or the internet, up to 3 vs 3.
//
// One player hosts. The host's browser runs the real game; everyone else's browser is a window onto it.
//   - Rooms are found by name through the free PeerJS broker (the "room finder": it only introduces the
//     browsers to each other). Game traffic then goes straight between the PCs over WebRTC data
//     channels: across the local network when they share one (Wi-Fi, a PC's hotspot, a cable), over the
//     internet when they don't, or through a TURN relay when no direct path exists (a relay account set
//     up under Connection settings or in netconfig.js; the host's PC is the one that needs it).
//   - "Same network" (on unless turned off): a browser offers a page only its internet-facing address,
//     hidden behind a random *.local name, unless the page has microphone access. With access, every
//     local address is offered as it is, so PCs sharing a network find each other even when the Wi-Fi
//     can't look the names up, or one PC shares a hotspot. The microphone is closed straight away.
//   - Joining runs in stages (room finder, host answers, network path, game channel, welcome), each with
//     its own time limit. A failure is explained from what both PCs offered, with a report to copy.
//   - A link that closes or goes silent for SILENCE_MS reconnects by itself, in the lobby and in battle.
//   - Clients send commands (move, attack, cast, build...) and the host applies them to their hero.
//   - The host sends world snapshots 20 times a second: every entity, building, projectile, shot, coin
//     pile and effect, as changes since the last snapshot, plus the particles and floating numbers born
//     since then. Clients keep stand-in copies ("mirrors") of everything and draw those with the normal
//     renderer, smoothing movement between snapshots. Over a slow or jittery link the host sends
//     snapshots less often and clients smooth over longer, so the game slows its updates rather than stalls.
//   - A player who drops out has their hero taken off the field until they're back (automatically, or by
//     joining the room again with the same name).
//
// Wire format: JSON strings; anything over CHUNK characters is split into '~id|i|n|part' pieces.
(function (G) {
  const PREFIX = 'frosthaven-rts-';
  const MAX_PER_TEAM = 3;
  const SNAP_MIN = 3, SNAP_MAX = 6;  // simulation steps between snapshots: 20 a second, down to 10 on a struggling link
  const LERP_MIN = 55, LERP_MAX = 250;  // clients ease entities to each new snapshot over this long (follows arrival jitter)
  const CHUNK = 48000;           // characters per data channel message (browsers cap messages near 256 KB)
  const BACKLOG = 2e6;           // bytes queued on a channel before we stop sending it deltas and resync
  const SILENCE_MS = 6000;       // no word from a peer for this long: the link is gone (reconnecting is quick)
  // Joining, stage by stage: how long each may take.
  const FINDER_MS = 10000;       // reaching the room finder
  const ANSWER_MS = 10000;       // the host's PC answering the call
  const PATH_MS = 12000;         // finding a network path to it (a working one is found in a few seconds)
  const OPEN_MS = 10000;         // the game channel opening on that path
  const WELCOME_MS = 8000;       // the host's game letting us in
  const JOIN_TRIES = 2;          // attempts at a first join (only failures another try might fix are retried)
  const RECONNECT_MS = 90000;    // a dropped player keeps trying to get back this long
  const HOST_WAIT_MS = 60000;    // host: a caller with no open channel after this long is given up on
  const LOBBY_HOLD_MS = 30000;   // host: a dropped player's lobby place is held this long
  const ASK_MS = 15000;          // waiting on the microphone prompt before going on without it
  const PEER_LIB = typeof Peer === 'function';

  const net = G.net = {
    role: null,            // 'host' | 'client' | null
    lobby: null,           // { room, races: [west, east], players: [{ id, name, team, hero, host, connected }], started }
    myId: null,
    onChange: null,        // menu: lobby changed, or { error | notice, left, report } (left: back to the room screen)
    onStatus: null,        // menu: progress while creating or joining a room
    onStart: null,         // menu: a client was handed the match config and its first snapshot; launch the game
    inGame: false,
    reconnecting: false
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const status = text => { if (net.onStatus) net.onStatus(text); };
  function changed(msg) { if (net.onChange) net.onChange(msg); }

  // ---------------------------------------------------------------------------
  // Identity: a per-tab id (so several tabs on one PC are separate players) and remembered settings.
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
  net.savedLan = () => get('localStorage', 'frost.netLan') !== '0';
  net.setLan = on => set('localStorage', 'frost.netLan', on ? '1' : '0');

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
    // Ignore whitespace: a copy checked out on Windows (CRLF line endings) is still the same game.
    s = s.replace(/\s+/g, '');
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (printCache = (h >>> 0).toString(16));
  }

  // A failed create / join / reconnect: what went wrong, for the player, plus a report to copy.
  // retry: another attempt might work. final: nothing will (don't keep reconnecting).
  function failure(code, message, o) { return Object.assign({ code, message, retry: false, final: false, report: '' }, o || {}); }
  net.describe = f => (f && f.message) || String(f);

  // ---------------------------------------------------------------------------
  // Connection settings: STUN servers (from netconfig.js) to find a way through routers, and TURN relays
  // (netconfig.js, or this PC's Connection settings) for networks that allow no direct path.
  // ---------------------------------------------------------------------------
  net.relay = () => { try { return JSON.parse(get('localStorage', 'frost.netRelay') || 'null'); } catch (e) { return null; } };
  net.setRelay = r => set('localStorage', 'frost.netRelay', r && r.urls && r.urls.length ? JSON.stringify(r) : '');
  // Relay settings as typed: one or more addresses ("turn:host:port", "host:port"), or the ICE server
  // list pasted from the relay's dashboard, username and credential included.
  net.parseRelay = function (text, username, credential) {
    text = String(text || '').trim();
    if (!text) return null;
    const field = k => { const m = text.match(new RegExp(k + '["\']?\\s*:\\s*["\']([^"\']+)["\']')); return m ? m[1] : ''; };
    let urls = [...text.matchAll(/turns?:[^\s"',\]]+/g)].map(m => m[0]);
    if (!urls.length) urls = text.split(/[\s,]+/).filter(Boolean).map(u => 'turn:' + u.replace(/^[a-z]+:\/\//i, ''));
    return { urls: [...new Set(urls)], username: String(username || field('username')).trim(), credential: String(credential || field('credential')).trim() };
  };
  function iceServers() {
    const c = G.NET_CONFIG || {}, list = [];
    if (c.stun && c.stun.length) list.push({ urls: c.stun });
    for (const t of c.turn || []) list.push(t);
    const r = net.relay();
    if (r && r.urls && r.urls.length) list.push({ urls: r.urls, username: r.username, credential: r.credential });
    return list;
  }
  const hasRelay = () => iceServers().some(s => [].concat(s.urls).some(u => /^turns?:/.test(u)));
  function rtcConfig() {
    const config = { iceServers: iceServers() };
    if ((G.NET_CONFIG || {}).forceRelay) config.iceTransportPolicy = 'relay';
    return config;
  }

  // Checks relay settings: asks the relay for an address, the way a real connection would.
  net.testRelay = async function (r) {
    if (!r || !r.urls || !r.urls.length) return { ok: false, text: 'Type the relay server’s address first.' };
    let pc;
    try { pc = new RTCPeerConnection({ iceServers: [{ urls: r.urls, username: r.username, credential: r.credential }], iceTransportPolicy: 'relay' }); }
    catch (e) { return { ok: false, text: 'Those settings aren’t a valid relay address (' + e.message + '). Addresses look like turn:relay.example.com:3478.' }; }
    const errs = [];
    let addr = null;
    pc.onicecandidate = e => { if (e.candidate && / typ relay /.test(e.candidate.candidate)) addr = addr || e.candidate.candidate.split(' ')[4]; };
    pc.onicecandidateerror = e => errs.push(e);
    pc.createDataChannel('test');
    await pc.setLocalDescription(await pc.createOffer());
    const end = performance.now() + 10000;
    while (!addr && pc.iceGatheringState !== 'complete' && performance.now() < end) await sleep(100);
    pc.close();
    if (addr) return { ok: true, text: `The relay works: it gave this PC the address ${addr}. Players who can’t connect directly will go through it.` };
    if (errs.some(e => e.errorCode === 401)) return { ok: false, text: 'The relay refused the username or password. Copy them again from the relay’s dashboard.' };
    if (errs.some(e => /lookup/i.test(e.errorText || ''))) return { ok: false, text: 'Couldn’t find that relay server name. Check the address.' };
    if (errs.length) return { ok: false, text: 'Couldn’t reach the relay server (' + errs[0].errorCode + ' ' + (errs[0].errorText || '') + '). This network may block its port: add the port 443 addresses from its dashboard too (turns:…:443).' };
    return { ok: false, text: 'The relay didn’t answer within 10 seconds. Check the address; this network may block it.' };
  };

  // "Same network": microphone access, so the browser offers every local address (see the top).
  // Returns null when on, or why it's off.
  let lanOn = false;
  async function openLan() {
    if (!net.savedLan() || lanOn) return null;
    const md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) return 'this page can’t ask for it (open the game from a file, http://localhost or https, not another PC’s address)';
    try {
      const st = await navigator.permissions.query({ name: 'microphone' });
      if (st.state === 'granted') { lanOn = true; return null; }   // granted before: nothing to open
      if (st.state === 'denied') return 'microphone access is blocked for this page (allow it from the icon at the left of the address bar)';
    } catch (e) { /* no permissions API: just ask */ }
    status('Allow microphone access in the browser’s prompt (top left) so PCs on the same network can connect directly. Nothing is recorded.');
    const grab = async c => { const s = await md.getUserMedia(c); for (const t of s.getTracks()) t.stop(); };
    const ask = (async () => {
      try { await grab({ audio: true }); }
      catch (e) {
        if (e.name === 'NotReadableError') return;   // allowed, but in use elsewhere: good enough
        if (e.name !== 'NotFoundError') throw e;
        await grab({ video: true });                 // no microphone: a camera does the same
      }
    })();
    ask.then(() => { lanOn = true; }, () => {});
    try {
      await Promise.race([ask, sleep(ASK_MS).then(() => { throw { name: 'Timeout' }; })]);
      lanOn = true;
      return null;
    } catch (e) {
      return e.name === 'NotAllowedError' ? 'microphone access was not allowed'
        : e.name === 'NotFoundError' ? 'this PC has no microphone or camera'
        : e.name === 'Timeout' ? 'the microphone prompt wasn’t answered'
        : 'microphone access failed (' + e.name + ')';
    }
  }

  // ---------------------------------------------------------------------------
  // Diagnostics: the addresses each PC offered, from the session descriptions (they collect every
  // trickled candidate, and stay readable after the connection closes). host = the PC's own address
  // (*.local when hidden), srflx = its public address, relay = a TURN relay's.
  // ---------------------------------------------------------------------------
  function candidates(desc) {
    return ((desc && desc.sdp) || '').split(/\r?\n/).filter(l => l.startsWith('a=candidate:')).map(l => {
      const f = l.split(' ');
      return { type: f[7], address: f[4], port: f[5], protocol: (f[2] || '').toLowerCase() };
    });
  }
  const showCands = list => list.map(c => `${c.type} ${c.address}:${c.port} ${c.protocol}`).join(', ') || 'none';
  const isPrivate = a => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|f[cd]|fe80)/i.test(a) || /\.local$/.test(a);
  function pathFacts(pc) {
    const L = pc ? candidates(pc.localDescription) : [], R = pc ? candidates(pc.remoteDescription) : [];
    const has = (list, t) => list.some(c => c.type === t);
    const pub = list => list.filter(c => c.type === 'srflx').map(c => c.address);
    const real = list => list.some(c => c.type === 'host' && !/\.local$/.test(c.address) && isPrivate(c.address));
    return { L, R, has, sameNet: pub(L).some(a => pub(R).includes(a)), realL: real(L), realR: real(R) };
  }

  // Why no network path to the other PC worked, in words; `side` is who's reading it.
  function explainPath(pc, a, side) {
    const { L, R, has, sameNet, realL, realR } = pathFacts(pc);
    const other = side === 'host' ? 'their PC' : 'the host’s PC', me = 'this PC';
    const hints = [];
    let code, why;
    if (a.connectedOnce) {
      code = 'dropped';
      why = `A connection to ${other} was made, then lost within seconds: the network is dropping traffic between the PCs (weak or overloaded Wi-Fi?).`;
    } else if (!has(L, 'srflx') && !has(L, 'relay')) {
      code = 'no-udp';
      why = `${me[0].toUpperCase() + me.slice(1)} couldn’t get an internet address for game traffic: this network blocks the kind of traffic games use (UDP), or a VPN, extension or policy limits the browser.`;
      hints.push('Try another network (a phone hotspot works), or turn off a VPN.');
    } else if (!R.length) {
      code = 'no-remote';
      why = `${other[0].toUpperCase() + other.slice(1)} offered no network addresses: its browser or network blocks WebRTC.`;
    } else if (!has(R, 'srflx') && !has(R, 'relay')) {
      code = 'remote-no-udp';
      why = `The network ${side === 'host' ? 'they are' : 'the host is'} on blocks the kind of traffic games use (UDP).`;
    } else if (sameNet) {
      code = 'same-network';
      why = 'You’re on the same network as ' + (side === 'host' ? 'them' : 'the host') + ', but the PCs couldn’t reach each other directly, and your router doesn’t pass traffic back in through its public address.';
      if (!realL && !realR) hints.push('Turn on “Same network” (Connection settings) on the host’s PC, and allow the microphone when the browser asks: without it the browser hides the PC’s local address.');
      else hints.push('The PCs know each other’s local addresses, so something between them blocks traffic: the Wi-Fi keeps devices apart (guest, school or work networks do), or a firewall / antivirus on one PC.');
      hints.push('A way around it: the joining PC connects to the host PC’s own hotspot (Windows: Settings › Network & internet › Mobile hotspot), or both use a phone hotspot.');
    } else {
      code = 'no-direct';
      why = 'Your network and ' + (side === 'host' ? 'theirs' : 'the host’s') + ' don’t allow a direct connection between them (a strict router or firewall: common on mobile data and school or work Wi-Fi).';
    }
    if (!hasRelay()) hints.push('A relay server gets through every network: set one up under Connection settings on the host’s PC.');
    else if (!has(L, 'relay') && !has(R, 'relay')) hints.push('A relay server is set up but gave no address: check it with “Test relay” in Connection settings.');
    return failure(code, why + (hints.length ? ' ' + hints.join(' ') : ''), { retry: code === 'dropped', short: 'No network path to ' + other });
  }

  function report(what, a, pc, f) {
    const { L, R } = pathFacts(pc);
    return [
      `Frost RTS network report · ${new Date().toISOString()}`,
      `${what}${a ? ` · attempt ${a.n}` : ''}${f ? ` · ${f.code}` : ''}`,
      f ? `Problem: ${f.message}` : '',
      a ? 'Timeline:\n' + a.marks.map(m => '  ' + m).join('\n') : '',
      `This PC offered: ${showCands(L)}`,
      `Other PC offered: ${showCands(R)}`,
      pc ? `States: ice ${pc.iceConnectionState}, connection ${pc.connectionState}, signaling ${pc.signalingState}` : '',
      a && a.iceErrors.length ? 'Address errors: ' + a.iceErrors.join(' | ') : '',
      `Same network: ${net.savedLan() ? (lanOn ? 'on' : 'on, but no microphone access') : 'off'} · relay: ${hasRelay() ? 'set up' : 'none'} · build ${fingerprint()}`,
      navigator.userAgent
    ].filter(Boolean).join('\n');
  }
  net.lastReport = '';

  // How a link travels and its round trip: 'lan' (same network), 'direct' (over the internet) or
  // 'relay' (through a TURN server), from the connection's selected candidate pair.
  async function measure(link) {
    const pc = link.pc;
    if (!pc || !pc.getStats || pc.connectionState === 'closed') return;
    try {
      const stats = await pc.getStats();
      let pair = null;
      stats.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId); });
      if (!pair) stats.forEach(r => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
      if (!pair) return;
      const local = stats.get(pair.localCandidateId) || {}, remote = stats.get(pair.remoteCandidateId) || {};
      const addr = c => c.address || c.ip || '';
      link.route = local.candidateType === 'relay' || remote.candidateType === 'relay' ? 'relay'
        : local.candidateType === 'host' && (remote.candidateType === 'host' || isPrivate(addr(remote))) ? 'lan' : 'direct';
      if (pair.currentRoundTripTime !== undefined) link.ping = Math.round(pair.currentRoundTripTime * 1000);
    } catch (e) { /* closed meanwhile */ }
  }

  // ---------------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------------
  let peer = null, warm = null, chunkSeq = 0;

  function wrap(conn) {
    const link = { conn, pc: conn.peerConnection, last: performance.now(), parts: {}, onMessage: null, player: null, ready: false, needFull: false, mute: false };
    link.sendRaw = s => {
      if (!conn.open || link.mute) return;
      try {
        if (s.length <= CHUNK) { conn.send(s); return; }
        const id = ++chunkSeq, n = Math.ceil(s.length / CHUNK);
        for (let i = 0; i < n; i++) conn.send('~' + id + '|' + i + '|' + n + '|' + s.slice(i * CHUNK, (i + 1) * CHUNK));
      } catch (e) { console.warn('[net] send failed', e); }
    };
    link.send = obj => link.sendRaw(JSON.stringify(obj));
    // Bytes waiting to go out: the browser's queue plus messages PeerJS is holding back.
    link.backlog = () => (conn.dataChannel ? conn.dataChannel.bufferedAmount : 0) + (conn.bufferSize || 0) * CHUNK;
    link.close = () => { try { conn.close(); } catch (e) { /* gone */ } try { link.pc && link.pc.close(); } catch (e) { /* gone */ } };
    conn.on('data', d => {
      if (link.mute) return;
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

  function needLib() {
    if (PEER_LIB) return null;
    return failure('no-lib', 'Couldn’t load the networking library (PeerJS from cdnjs.cloudflare.com). Check that this PC is online, then reload the page.');
  }

  // Joining starts sooner with the room finder already reached: done when the room screen opens.
  net.warmUp = function () {
    if (!PEER_LIB || peer || (warm && !warm.destroyed)) return;
    try { warm = new Peer({ debug: 1, config: rtcConfig() }); warm.on('error', () => { /* a join will retry */ }); } catch (e) { warm = null; }
  };

  // Tear everything down (leaving the room, or after a fatal error).
  function shutdown() {
    clearInterval(beat); beat = 0;
    clearTimeout(finderTimer); finderTimer = 0;
    if (peer) { try { peer.destroy(); } catch (e) { /* already gone */ } }
    peer = null; hostLink = null; peerErr = null;
    pending.clear();
    net.role = null; net.lobby = null;
  }

  net.leave = function () {
    const s = session;
    session = null;   // stops any reconnecting
    if (net.role === 'host') for (const p of players()) if (p.link) p.link.send({ t: 'closed' });
    if (s && hostLink) hostLink.send({ t: 'bye' });
    // Give the goodbye a moment to leave before the connection closes.
    const p = peer;
    peer = null;
    setTimeout(() => { try { p && p.destroy(); } catch (e) { /* gone */ } }, 150);
    shutdown();
    hideBanner();
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

  // Resolves with { warning } (null, or why "Same network" is off); rejects with a failure.
  net.host = async function (roomName, playerName) {
    const lib = needLib(); if (lib) throw lib;
    const room = String(roomName || '').trim(), id = slug(room), name = cleanName(playerName);
    if (!id) throw failure('input', 'Type a room name (letters or numbers).');
    if (!name) throw failure('input', 'Type your name first.');
    set('localStorage', 'frost.netName', name); set('localStorage', 'frost.netRoom', room);
    session = null;
    shutdown();
    if (warm) { try { warm.destroy(); } catch (e) { /* gone */ } warm = null; }
    fingerprint();
    const off = await openLan();
    status('Creating the room…');
    await new Promise((resolve, reject) => {
      const p = peer = new Peer(PREFIX + id, { debug: 1, config: rtcConfig() });
      let settled = false;
      const fail = f => { if (settled) return; settled = true; clearTimeout(timer); if (peer === p) shutdown(); reject(f); };
      const timer = setTimeout(() => fail(failure('no-finder', 'Couldn’t reach the room finder (0.peerjs.com) within 10 seconds. Check that this PC is online; some school, work or public Wi-Fi blocks it.')), FINDER_MS);
      p.on('open', () => {
        if (peer !== p) return;
        if (settled) { finderBack(); return; }
        settled = true; clearTimeout(timer);
        net.role = 'host';
        net.myId = net.myToken();
        net.lobby = { room, races: ['human', 'algox'], started: false,
          players: [{ id: net.myId, name, team: 0, hero: G.HEROES[0].id, host: true, connected: true, link: null }] };
        startBeat();
        resolve();
        changed();
      });
      p.on('connection', onIncoming);
      p.on('disconnected', () => { if (peer === p && settled && net.role === 'host') finderLost(); });
      p.on('error', e => {
        console.warn('[net] host error', e.type, e);
        if (settled) return;   // after the room is open: the room finder retries by itself (finderLost)
        fail(failure(e.type, e.type === 'unavailable-id' ? `A room called “${room}” is already open. To play in it, use Join Room. If it was yours a moment ago, wait half a minute for the room finder to let the name go, or pick another name.`
          : e.type === 'browser-incompatible' ? 'This browser doesn’t support WebRTC. Use Chrome or Edge.'
          : e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error' || e.type === 'socket-closed' ? 'Couldn’t reach the room finder (0.peerjs.com). Check that this PC is online; some school, work or public Wi-Fi blocks it.'
          : `Couldn’t create the room (${e.type}).`));
      });
    });
    return { warning: off ? `“Same network” is off on this PC: ${off}. Players on the same Wi-Fi or on this PC’s hotspot may not be able to connect (players elsewhere can).` : null };
  };

  // The room finder dropped this PC: players already in are unaffected, but nobody new can find the
  // room until it's back. Keep reconnecting.
  let finderTimer = 0, finderTries = 0;
  function finderLost() {
    if (finderTimer) return;
    finderTries = 0;
    console.warn('[net] lost the room finder; reconnecting');
    changed({ notice: 'Lost touch with the room finder: players already here are fine, but nobody new can join until it’s back. Reconnecting…', error: true });
    const retry = () => {
      finderTimer = 0;
      if (!peer || peer.destroyed || net.role !== 'host' || !peer.disconnected) return;
      finderTries++;
      try { peer.reconnect(); } catch (e) { /* next time */ }
      finderTimer = setTimeout(retry, Math.min(15000, 2000 * finderTries));
    };
    finderTimer = setTimeout(retry, 1000);
  }
  function finderBack() {
    clearTimeout(finderTimer); finderTimer = 0;
    console.info('[net] room finder reconnected');
    changed({ notice: 'Room finder reconnected: players can join again.' });
    if (net.inGame) toast('Room finder reconnected: players can join again');
  }

  const pending = new Set();   // callers that haven't said hello yet
  function onIncoming(conn) {
    const link = wrap(conn);
    const meta = conn.metadata || {};
    link.who = cleanName(meta.name) || 'A player';
    link.t0 = performance.now();
    link.a = { n: meta.n || 1, marks: [], iceErrors: [], connectedOnce: false };
    const mark = what => link.a.marks.push(`${String(Math.round(performance.now() - link.t0)).padStart(6)} ms  ${what}`);
    mark(`${link.who} is calling`);
    link.onMessage = m => {
      if (m.t === 'hello') { hello(link, m); return; }
      // Answered straight away: a host tab in the background gets its timers slowed to once a minute,
      // so its own pings can't be relied on to keep a lobby link alive.
      if (m.t === 'ping') { link.send({ t: 'pong' }); return; }
      const p = link.player;
      if (!p || p.link !== link) return;
      if (m.t === 'pick') pick(p, m);
      else if (m.t === 'cmd' && Array.isArray(m.c)) for (const c of m.c) cmdQueue.push({ p, c });
      else if (m.t === 'bye') dropLink(link, true);
    };
    conn.on('close', () => dropLink(link));
    conn.on('error', e => { mark('channel error: ' + (e && e.type)); dropLink(link); });
    // The hello can only come once the channel is open: the silence clock starts then.
    conn.on('open', () => { link.last = performance.now(); mark('game channel open'); });
    const pc = link.pc;
    if (pc) {
      pc.addEventListener('iceconnectionstatechange', () => {
        mark('network path: ' + pc.iceConnectionState);
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') link.a.connectedOnce = true;
        if (pc.iceConnectionState === 'failed' && pending.has(link)) giveUp(link);
      });
      pc.addEventListener('connectionstatechange', () => {
        mark('connection: ' + pc.connectionState);
        if (pc.connectionState === 'failed' && pending.has(link)) giveUp(link);
      });
      pc.addEventListener('icecandidateerror', e => { if (link.a.iceErrors.length < 12) link.a.iceErrors.push(`${e.errorCode} ${e.errorText || ''} ${e.url || ''}`.trim()); });
    }
    pending.add(link);
    if (!net.lobby || !net.lobby.started) changed({ notice: `${link.who} is connecting…` });
  }

  // A caller that never got a working channel: tell the host why, as far as this side can tell.
  function giveUp(link) {
    if (!pending.delete(link)) return;
    const f = link.conn.open ? failure('no-hello', `${link.who} connected but their game never introduced itself (it may be frozen).`) : explainPath(link.pc, link.a, 'host');
    const text = link.conn.open ? f.message : `${link.who} couldn’t connect: ${f.message}`;
    net.lastReport = report('Host: a player couldn’t connect', link.a, link.pc, f);
    console.warn('[net] ' + text + '\n' + net.lastReport);
    link.close();
    if (net.inGame) toast(`${link.who} couldn’t connect (see the joining PC for details)`);
    else changed({ notice: text, error: true, report: net.lastReport });
  }

  function rejectLink(link, code, reason) {
    link.send({ t: 'reject', code, reason });
    setTimeout(() => link.close(), 400);
    const why = { version: 'their game files are a different version (they need the same files as this PC)', full: 'the room is full', started: 'the battle had already started' }[code];
    if (why) {
      const text = `${link.who} tried to join, but ${why}.`;
      console.warn('[net] ' + text);
      if (net.inGame) toast(text); else changed({ notice: text, error: true });
    }
  }

  function hello(link, m) {
    pending.delete(link);
    if (!net.lobby) return rejectLink(link, 'closed', 'The room has closed.');
    if (m.ver !== fingerprint()) return rejectLink(link, 'version', `Your game files don’t match the host’s (host build ${fingerprint()}, yours ${m.ver}). Everyone needs the same version: update both PCs (git pull, or copy the host’s game folder), then reload with Ctrl+Shift+R.`);
    const name = cleanName(m.name);
    if (!name) return rejectLink(link, 'name', 'Type your name first.');
    let p = players().find(q => q.id === m.id && !q.host);
    // Coming back from another tab or after closing the browser: the same name takes back a dropped hero.
    if (!p) p = players().find(q => !q.connected && !q.host && q.name.toLowerCase() === name.toLowerCase());
    if (p) {
      if (p.link && p.link !== link) { const old = p.link; p.link = null; old.close(); }
    } else {
      if (net.lobby.started) return rejectLink(link, 'started', 'This battle has already started. Only players who were in it can rejoin.');
      if (players().length >= MAX_PER_TEAM * 2) return rejectLink(link, 'full', 'The room is full (6 players).');
      p = { id: m.id, name: '', team: openTeam(), hero: G.HEROES[players().length % G.HEROES.length].id, host: false, connected: false, link: null };
      players().push(p);
    }
    p.name = uniqueName(name, p);
    const back = !p.connected && (net.lobby.started || p.leftAt);
    p.connected = true; p.link = link; p.leftAt = 0; link.player = p;
    console.info(`[net] ${p.name} joined after ${Math.round(performance.now() - link.t0)} ms`);
    link.send({ t: 'welcome', you: p.id, lobby: publicLobby() });
    if (net.lobby.started) {
      heroBack(p);
      sendGame(link);
    }
    if (back) note(`${p.name} is back`);
    changed({ notice: back ? `${p.name} is back.` : `${p.name} joined.` });
    lobbyChanged();
    setTimeout(() => measure(link), 1500);
  }

  // A player's link closed or went silent. In the lobby their place is held a while (they're probably
  // reconnecting); in battle their hero leaves the field until they're back. bye: they left on purpose.
  function dropLink(link, bye) {
    if (pending.has(link)) { if (bye) pending.delete(link); else giveUp(link); return; }
    const p = link.player;
    if (!p || p.link !== link) return;
    p.link = null; p.connected = false;
    link.close();
    if (!net.lobby) return;
    if (!net.lobby.started) {
      if (bye) net.lobby.players = players().filter(q => q !== p);
      else { p.leftAt = performance.now(); changed({ notice: `${p.name} lost the connection: holding their place while they reconnect…`, error: true }); }
    } else {
      heroAway(p);
      note(bye ? `${p.name} left the game` : `${p.name} lost the connection — their hero is out until they’re back`);
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
    if (net.role !== 'host' || net.lobby.started || !G.RACES.some(r => r.id === raceId)) return;
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
  let session = null;          // client: { room, id, name, myId } while in a room (outlives reconnects)
  let hostLink = null, pendingConfig = null, pendingSnap = null, peerErr = null;

  // The room finder, reached (reusing the one warmed up on the room screen).
  function ensurePeer() {
    return new Promise((resolve, reject) => {
      if (!peer && warm && !warm.destroyed) { peer = warm; warm = null; }
      if (!peer || peer.destroyed) {
        peer = new Peer({ debug: 1, config: rtcConfig() });
      }
      const p = peer;
      p.options.config = rtcConfig();   // settings may have changed since it was made
      if (!p._ntWired) {
        p._ntWired = true;
        p.on('error', e => { console.warn('[net] client error', e.type, e.message || ''); if (peer === p && peerErr) peerErr(e); });
      }
      if (p.open) return resolve(p);
      if (p.disconnected && !p.destroyed) { try { p.reconnect(); } catch (e) { /* the timeout reports it */ } }
      const onOpen = () => { off(); resolve(p); };
      const onError = e => {
        if (!['network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible', 'unavailable-id'].includes(e.type)) return;
        off();
        reject(failure('no-finder', e.type === 'browser-incompatible' ? 'This browser doesn’t support WebRTC. Use Chrome or Edge.'
          : 'Couldn’t reach the room finder (0.peerjs.com). Check that this PC is online; some school, work or public Wi-Fi blocks it.', { retry: e.type !== 'browser-incompatible', short: 'The room finder didn’t answer' }));
      };
      const off = () => { p.off('open', onOpen); p.off('error', onError); };
      p.on('open', onOpen);
      p.on('error', onError);
    });
  }

  // One try at reaching the host and being let in. Resolves { link, welcome }; rejects with a failure.
  function connectHost(s, n, rejoin) {
    return new Promise((resolve, reject) => {
      const a = { n, t0: performance.now(), marks: [], iceErrors: [], connectedOnce: false, stage: '' };
      const mark = what => { a.marks.push(`${String(Math.round(performance.now() - a.t0)).padStart(6)} ms  ${what}`); };
      let conn = null, pc = null, link = null, timer = 0, over = false;
      const end = f => {
        if (over) return;
        over = true; clearTimeout(timer); peerErr = null;
        if (!f) return;
        mark('gave up: ' + f.code);
        f.report = report(rejoin ? 'Reconnecting to the host' : 'Joining room “' + s.room + '”', a, pc, f);
        net.lastReport = f.report;
        if (link) { link.dead = true; link.close(); }
        reject(f);
      };
      const stage = (name, ms, why) => { a.stage = name; clearTimeout(timer); timer = setTimeout(() => end(why()), ms); };
      const say = text => { if (!rejoin) status(text); };
      say('Looking for the room…');
      stage('finder', FINDER_MS, () => failure('no-finder', 'Couldn’t reach the room finder (0.peerjs.com) within 10 seconds. Check that this PC is online; some school, work or public Wi-Fi blocks it.', { retry: true, short: 'The room finder didn’t answer' }));
      ensurePeer().then(() => {
        if (over) return;
        mark('room finder reached');
        peerErr = e => {
          if (e.type === 'peer-unavailable') end(failure('no-room', rejoin ? `The room “${s.room}” isn’t open any more (the host may have closed it, or lost the room finder for a moment).`
            : `No room called “${s.room}” is open. Check the spelling (the host’s lobby shows the room name), and that the host has created it.`, { retry: !!rejoin, short: 'The room wasn’t found' }));
          else if (['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'].includes(e.type)) end(failure('no-finder', 'Lost the room finder (0.peerjs.com) while joining. Check that this PC is online.', { retry: true, short: 'Lost the room finder' }));
        };
        conn = peer.connect(PREFIX + s.id, { serialization: 'raw', reliable: true, metadata: { name: s.name, id: s.myId, n } });
        pc = conn.peerConnection;
        link = wrap(conn);
        mark('calling the host');
        stage('answer', ANSWER_MS, () => failure('no-answer', `Found the room “${s.room}”, but the host’s PC didn’t answer. Its game may be frozen or its tab asleep (minimized a long time), or it lost the room finder. Ask the host to check their screen; if it keeps happening, the host can create the room again.`, { retry: true, short: 'The host didn’t answer' }));
        pc.addEventListener('signalingstatechange', () => {
          if (!pc.remoteDescription || a.stage !== 'answer') return;
          mark('host answered');
          say('Found the room: connecting to the host’s PC…');
          stage('path', PATH_MS, () => explainPath(pc, a, 'client'));
          watchPath();
        });
        // Give up as soon as no path can work, not at the time limit: this PC has no usable address at
        // all, or every address pair has been tried and failed (twice in a row, a second apart).
        const watchPath = async () => {
          let failedPolls = 0;
          while (!over && a.stage === 'path') {
            await sleep(1000);
            if (over || a.stage !== 'path') return;
            // (Local addresses alone may still connect on a network that only blocks the internet.)
            const { L } = pathFacts(pc);
            if (pc.iceGatheringState === 'complete' && !L.length && performance.now() - a.t0 > 3000) {
              mark('no usable address on this PC');
              return end(explainPath(pc, a, 'client'));
            }
            let pairs = 0, failed = 0;
            const states = {};
            try { (await pc.getStats()).forEach(r => { if (r.type === 'candidate-pair') { pairs++; states[r.state] = (states[r.state] || 0) + 1; if (r.state === 'failed') failed++; } }); } catch (e) { return; }
            const sum = Object.entries(states).map(([k, v]) => v + ' ' + k).join(', ');
            if (sum !== a.pairSum) { a.pairSum = sum; mark('address pairs: ' + (sum || 'none yet')); }
            failedPolls = pc.iceGatheringState === 'complete' && pairs > 0 && failed === pairs ? failedPolls + 1 : 0;
            if (failedPolls >= 2) { mark(`all ${pairs} address pairs failed`); return end(explainPath(pc, a, 'client')); }
          }
        };
        pc.addEventListener('iceconnectionstatechange', () => {
          const st = pc.iceConnectionState;
          mark('network path: ' + st);
          if (st === 'connected' || st === 'completed') {
            a.connectedOnce = true;
            if (a.stage === 'path') stage('open', OPEN_MS, () => failure('no-channel', 'Reached the host’s PC, but the game channel didn’t open on the connection. Something on the network is interfering (a VPN, or an antivirus “web shield”?).', { retry: true, short: 'The game channel didn’t open' }));
          }
          if (st === 'failed' && (a.stage === 'path' || a.stage === 'open')) end(explainPath(pc, a, 'client'));
        });
        pc.addEventListener('connectionstatechange', () => {
          mark('connection: ' + pc.connectionState);
          if (pc.connectionState === 'failed' && (a.stage === 'path' || a.stage === 'open')) end(explainPath(pc, a, 'client'));
        });
        pc.addEventListener('icecandidateerror', e => { if (a.iceErrors.length < 12) a.iceErrors.push(`${e.errorCode} ${e.errorText || ''} ${e.url || ''}`.trim()); });
        conn.on('open', () => {
          if (over) return;
          mark('game channel open');
          say('Connected: waiting for the host’s game…');
          stage('welcome', WELCOME_MS, () => failure('no-welcome', 'Connected to the host’s PC, but its game didn’t let you in. It may be frozen: ask the host to check their screen, then try again.', { retry: true, short: 'The host’s game didn’t respond' }));
          link.send({ t: 'hello', id: s.myId, name: s.name, ver: fingerprint() });
        });
        conn.on('close', () => { if (!over) end(failure('closed', 'The host’s PC closed the connection while you were joining.', { retry: true, short: 'The host closed the connection' })); });
        conn.on('error', e => {
          mark('channel error: ' + (e && e.type));
          if (!over && e && e.type === 'negotiation-failed') end(explainPath(pc, a, 'client'));
        });
        link.onMessage = m => {
          if (over) return;
          if (m.t === 'reject') { end(failure('rejected-' + (m.code || 'other'), m.reason, { final: true })); return; }
          if (m.t !== 'welcome') return;
          mark('let in');
          over = true; clearTimeout(timer); peerErr = null;
          console.info('[net] joined:\n' + a.marks.join('\n'));
          resolve({ link, welcome: m });
        };
      }, f => end(f));
    });
  }

  // Resolves with { warning } once in the room; rejects with a failure.
  net.join = async function (roomName, playerName) {
    const lib = needLib(); if (lib) throw lib;
    const room = String(roomName || '').trim(), id = slug(room), name = cleanName(playerName);
    if (!id) throw failure('input', 'Type the room name.');
    if (!name) throw failure('input', 'Type your name first.');
    set('localStorage', 'frost.netName', name); set('localStorage', 'frost.netRoom', room);
    if (net.role === 'host') shutdown();
    const s = session = { room, id, name, myId: net.myToken() };
    const off = await openLan();
    let last = null;
    for (let n = 1; n <= JOIN_TRIES; n++) {
      if (session !== s) throw failure('cancelled', 'Cancelled.');
      try {
        const { link, welcome } = await connectHost(s, n, false);
        if (session !== s) { link.close(); throw failure('cancelled', 'Cancelled.'); }
        adopt(s, link, welcome);
        return { warning: null, lanOff: off };
      } catch (f) {
        last = f;
        console.warn(`[net] join attempt ${n} failed: ${f.message}\n${f.report || ''}`);
        if (session !== s || !f.retry || n === JOIN_TRIES) break;
        status(`${f.short || 'That didn’t work'}: trying again…`);
      }
    }
    if (session === s) { session = null; shutdown(); }
    throw last;
  };

  // In the room: this link is the way to the host now.
  function adopt(s, link, m) {
    hostLink = link;
    net.role = 'client'; net.myId = m.you; net.lobby = m.lobby;
    link.onMessage = clientMessage;
    link.conn.on('close', () => { if (hostLink === link) linkLost('the connection closed'); });
    if (link.pc) link.pc.addEventListener('iceconnectionstatechange', () => { if (hostLink === link && link.pc.iceConnectionState === 'failed') linkLost('the network path failed'); });
    startBeat();
    setTimeout(() => measure(link), 1500);
    changed();
  }

  let pinged = 0;
  function clientMessage(m) {
    // Keep-alive from the host's own traffic too: timers in a long-hidden tab may fire only once a minute.
    const now = performance.now();
    if (hostLink && now - pinged > 1000) { pinged = now; hostLink.send({ t: 'ping' }); }
    if (m.t === 'lobby') { net.lobby = m.lobby; changed(); return; }
    if (m.t === 'note') { toast(m.text); return; }
    if (m.t === 'closed') { endSession(net.inGame ? 'The host ended the game.' : 'The host closed the room.', true); return; }
    if (m.t === 'game') { if (!net.inGame) pendingConfig = m.config; return; }   // rejoining a battle we're still showing: keep it
    if (m.t === 'snap') {
      if (net.inGame) applySnap(m);
      else if (m.full && pendingConfig) { pendingSnap = m; net.inGame = true; if (net.onStart) net.onStart(pendingConfig); }
    }
  }

  // The link to the host closed or went silent: reconnect by ourselves (the host keeps our place).
  let reconnecting = false;
  function linkLost(why) {
    if (!session || reconnecting) return;
    const link = hostLink;
    hostLink = null;
    if (link) { link.dead = true; link.close(); }
    reconnectLoop(session, why);
  }

  async function reconnectLoop(s, why) {
    reconnecting = net.reconnecting = true;
    console.warn('[net] lost the host (' + why + '): reconnecting');
    const t0 = performance.now();
    let n = 0, last = null;
    while (session === s && performance.now() - t0 < RECONNECT_MS) {
      n++;
      const text = `Lost the connection to the host (${why}). Reconnecting${n > 1 ? `, attempt ${n}` : ''}…`;
      if (net.inGame) { G.netLost = true; banner(text + ' The battle carries on when it’s back.'); }
      else changed({ notice: text, error: true });
      try {
        const { link, welcome } = await connectHost(s, n, true);
        if (session !== s) { link.close(); break; }
        reconnecting = net.reconnecting = false;
        adopt(s, link, welcome);
        hideBanner();
        if (net.inGame) { G.netLost = false; toast('Reconnected to the host'); }
        else changed({ notice: 'Reconnected to the host.' });
        return;
      } catch (f) {
        last = f;
        console.warn(`[net] reconnect attempt ${n} failed: ${f.message}`);
        if (f.final) break;
        await sleep(Math.min(4000, 700 * n));
      }
    }
    reconnecting = net.reconnecting = false;
    hideBanner();
    if (session !== s) return;
    endSession(last && last.final ? last.message
      : `Lost the connection to the host (${why}) and couldn’t get back within ${Math.round(RECONNECT_MS / 1000)} seconds.` + (last ? ' Last try: ' + last.message : ''), false, last && last.report);
  }

  // Out of the room for good. closed: the host ended it on purpose (nothing to rejoin).
  function endSession(why, closed, rep) {
    session = null;
    const wasIn = net.inGame;
    shutdown();
    hideBanner();
    if (rep) net.lastReport = rep;
    if (wasIn) showLost(why, closed, rep);
    else changed({ error: why, left: true, report: rep || '' });
  }

  // Heartbeat: pings both ways each second; a silent link is dropped (and the player reconnects).
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
        for (const p of players()) if (p.link && now - p.link.last > SILENCE_MS) dropLink(p.link);
        for (const l of pending) if (now - (l.conn.open ? l.last : l.t0) > (l.conn.open ? SILENCE_MS : HOST_WAIT_MS)) giveUp(l);
        // Lobby places held for dropped players run out.
        if (net.lobby && !net.lobby.started) {
          const gone = players().filter(p => !p.connected && !p.host && p.leftAt && now - p.leftAt > LOBBY_HOLD_MS);
          if (gone.length) {
            net.lobby.players = players().filter(p => !gone.includes(p));
            changed({ notice: gone.map(p => p.name).join(', ') + ' didn’t come back: their place is open again.', error: true });
            lobbyChanged();
          }
        }
      } else if (net.role === 'client' && hostLink) {
        hostLink.send({ t: 'ping' });
        if (++beatNo % 2 === 0) measure(hostLink);
        if (now - hostLink.last > SILENCE_MS) linkLost(`no word from it for ${Math.round(SILENCE_MS / 1000)} seconds`);
      }
    }, 1000);
  }

  // Test hooks (tools/nettest): break the link the way a network would.
  net._test = {
    drop(how) {
      const links = net.role === 'host' ? players().filter(p => p.link).map(p => p.link) : [hostLink].filter(Boolean);
      for (const l of links) { if (how === 'mute') l.mute = true; else l.pc && l.pc.close(); }
      return links.length;
    },
    dropFinder() { if (peer && !peer.destroyed) peer.disconnect(); },
    freezeTimers() { clearInterval(beat); beat = 0; },   // as in a long-hidden tab
    printParts() {
      const fnText = (k, v) => (typeof v === 'function' ? v.toString() : v);
      const parts = { data: JSON.stringify([G.HEROES, G.BUILDINGS, G.SQUAD_KINDS, G.RACES], fnText) };
      for (const k of Object.keys(G).sort()) if (typeof G[k] === 'function') parts[k] = G[k].toString();
      return parts;
    },
    session: () => session
  };

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
    order(h, o) { return G.commandOrder(h, o); },
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
        case 'o': if (!h.dead && G.COMMAND_ORDERS.includes(c[1])) C.order(h, c[1]); break;
        case 'b': {
          const base = G.bases[c[1]], slot = base && base.slots[c[2]], def = G.BUILDINGS[c[3]];
          if (slot && !slot.core && !slot.wall && def && !def.command && def.menu !== false && !h.dead) C.build(h, { base, slot }, c[3]);
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
  const HERO_F = COMMON_F.concat(['def', 'swing', 'swingAlt', 'castAnim', 'castSlot', 'moving', 'lift', 'untargetable', 'invisible', 'buffs',
    'gold', 'cooldowns', 'state', 'form', 'dash', 'attackTarget', 'demolishTarget', 'history', 'unlock']);
  const SOLDIER_F = COMMON_F.concat(['kind', 'ranged', 'swing', 'moving', 'auraOn', 'aim', 'untargetable', 'ward', 'carapace', 'burrowed', 'digIn']);
  const DUMMY_F = COMMON_F.concat(['homeX']);
  const CREATURE_F = COMMON_F.concat(['homeX', 'swing', 'moving']);
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
    const F = e instanceof G.Hero ? HERO_F : e instanceof G.Soldier ? SOLDIER_F : e instanceof G.Creature ? CREATURE_F : DUMMY_F;
    const o = {};
    for (const k of F) {
      const s = ENC_SPECIAL[k];
      const v = s ? s(e) : enc(e[k], 1);
      o[k] = v === undefined ? null : v;
    }
    return o;
  }
  const slotKey = b => b.base.id * 16 + b.base.slots.indexOf(b.slot);   // build slots, wall slots, core

  // list(): live objects. cls(o): short type tag. encode(o) -> plain object. skip(o): fields not
  // re-sent after creation (clients advance those themselves).
  const COLLS = {
    E: { list: () => G.entities, cls: e => (e instanceof G.Hero ? 'H' : e instanceof G.Soldier ? 'S' : e instanceof G.Creature ? 'N' : 'D'), encode: encEntity },
    B: { list: () => G.buildingList(), cls: b => 'b',
      encode: b => ({ k: slotKey(b), type: b.type, team: b.team, hp: round(b.hp), maxHp: b.maxHp, aim: b.aim === undefined ? null : round(b.aim), fired: b.fired ? round(b.fired) : 0,
        beam: b.beam ? enc(b.beam, 1) : null, beamDmg: b.beamDmg || 0, cold: b.cold > 0 ? 1 : 0 }) },
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
    const proto = cls === 'H' ? G.Hero.prototype : cls === 'S' ? G.Soldier.prototype : cls === 'N' ? G.Creature.prototype : G.AlgoxDummy.prototype;
    return Object.assign(Object.create(proto), {
      x: 0, y: 0, r: 10, hp: 1, maxHp: 1, team: 0, dead: false, facing: 0, flash: 0,
      slowTimer: 0, slowAmount: 0, stunTimer: 0, rootTimer: 0, knock: null, dots: [], dotAcc: 0,
      shieldAmt: 0, shieldTimer: 0, shieldColor: 0x9fdcff, buffs: {}, marks: {},
      swing: 0, swingAlt: false, castAnim: 0, castSlot: -1, moving: false, lift: 0, untargetable: false, invisible: false,
      cooldowns: {}, state: {}, history: [], form: null, dash: null, attackTarget: null, demolishTarget: null,
      gold: 0, target: null, followers: [], homeX: 0, unlock: G.newUnlocks()
    });
  }

  function slotOf(k) { const base = G.bases[Math.floor(k / 16)]; return base ? { base, slot: base.slots[k % 16] } : null; }

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
        else if (k === 'B') { for (const f in data) if (f !== 'k') o[f] = f === 'beam' ? dec(data[f]) : data[f]; if (o.aim === null) delete o.aim; }
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
    // A hidden tab draws no frames, so nothing would age these out: skip them (they'd be long gone anyway).
    if (document.hidden) return endCheck(m);
    for (const r of m.pa || []) G.particles.push({ x: r[0], y: r[1], h: r[2] === null ? undefined : r[2], vx: r[3], vy: r[4], life: r[5], color: r[6], size: r[7], t: r[8] });
    for (const r of m.fl || []) G.floaters.push({ x: r[0], y: r[1], text: r[2], color: r[3], t: r[4] });
    endCheck(m);
  }
  function endCheck(m) { if (m.w !== null && m.w !== undefined && G.winner === null && G.endGame) G.endGame(m.w); }

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
    if (!hostLink) { outbox = []; return; }   // reconnecting: orders given meanwhile are dropped
    if (!outbox.length) return;
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
      order(o) { send(['o', o]); return true; },
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

  // While reconnecting in battle: a notice that stays up until the link is back.
  let bannerEl = null;
  function banner(text) {
    if (!bannerEl) { bannerEl = document.createElement('div'); bannerEl.id = 'netBanner'; bannerEl.setAttribute('role', 'status'); document.body.appendChild(bannerEl); }
    bannerEl.textContent = text;
    bannerEl.hidden = false;
  }
  function hideBanner() { if (bannerEl) bannerEl.hidden = true; }

  // A report onto the clipboard (for "Copy details"). Resolves true when it got there.
  net.copyReport = async function (text) {
    text = text || net.lastReport;
    if (!text) return false;
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* not allowed here: the old way */ }
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { /* no clipboard */ }
    ta.remove();
    return ok;
  };

  function showLost(why, closed, rep) {
    net.inGame = false;
    G.netLost = true;
    const el = document.getElementById('gameOver');
    if (!el || G.winner !== null) return;
    el.classList.add('defeat');
    el.querySelector('.result').textContent = 'Disconnected';
    el.querySelector('.detail').textContent = why + (closed ? '' : ' If the host is still playing, go back to the menu and join the same room to get your hero back.');
    el.querySelector('button').textContent = 'Back to menu';
    if (rep && !el.querySelector('.copy')) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'copy'; b.textContent = 'Copy details';
      b.addEventListener('click', async () => { b.textContent = (await net.copyReport(rep)) ? 'Copied' : 'Couldn’t copy'; });
      el.querySelector('.panel').appendChild(b);
    }
    el.hidden = false;
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
