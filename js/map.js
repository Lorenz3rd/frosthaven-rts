// Maps. G.MAPS lists them for the menu; G.map.use(id) loads one at the start of a match. A layout gives the
// map's size, its bases (built by bases.js), hero spawns, creature zones and its own obstacles:
//   Frosthaven: a timber village astride a frozen river, six bases a side in three lanes. Rocks and trees are
//     blocking circles (drawn as cabins, woodpiles and pines).
//   Mountain: a diamond-shaped summit. Each side spawns in the base camp at its corner; the summit's edge is a
//     cliff and four crevasses (gaps) split the bases in front of each camp. Neither can be crossed: walkers
//     route round the crevasses (map.gapSteer) and are kept on the summit (map.resolve). The two other
//     corners hold neutral bases with only 4 building slots.
//   Coast: sea cliffs split by a channel with four bridges, and an inlet across it (see COAST). The water is
//     gaps too; walkers route over the bridges and round the inlet (layout.route, via map.gapSteer).
//   Docks: a harbor, ten bases in a ring round a basin where a ship holds the eleventh (see DOCKS).
(function (G) {
  G.MAPS = [
    { id: 'frosthaven', name: 'Frosthaven', desc: 'A timber village astride a frozen river. Three lanes, six bases a side.' },
    { id: 'mountain', name: 'Mountain', desc: 'A summit split by crevasses that can’t be crossed. Two corner bases hold only 4 buildings.' },
    { id: 'coast', name: 'Coast', desc: 'Sea cliffs split by a channel. Four bridges cross it; nothing can wade the water.' },
    { id: 'docks', name: 'Docks', desc: 'A harbor of ten bases in a ring. A ship moored in the basin holds the middle base, boarded by four gangways; two bridged channels split West from East.' }
  ];
  G.mapById = id => G.MAPS.find(m => m.id === id) || G.MAPS[0];

  // rocks, trees: blocking circles { x, y, cr }. gaps: the circles a crevasse is made of (block walkers, not
  // shots). chasms: the crevasses themselves, for routing and drawing. ice: cosmetic patches.
  const map = { id: 'frosthaven', w: 7000, h: 3860, rocks: [], trees: [], ice: [], gaps: [], chasms: [], layout: null };
  G.map = map;

  // ---------------------------------------------------------------------------
  // Frosthaven: the original battlefield. Bases: 3 rows a side in two columns (rear, front), counted from
  // each side's outer edge. Edge-to-edge gaps: 360 between bases on a side, 1920 between the two sides.
  // ---------------------------------------------------------------------------
  const FROSTHAVEN = (function () {
    const W = 7000, H = 3860, COLS = [650, 2030], ROWS = [H / 2 - 1280, H / 2, H / 2 + 1280];
    const bases = [];
    for (const side of [G.TEAM.PLAYER, G.TEAM.ENEMY])
      for (const cx of COLS)
        for (const y of ROWS)
          bases.push({ x: side === G.TEAM.PLAYER ? cx : W - cx, y, side, hq: cx === COLS[0] && y === H / 2, front: cx === COLS[1] && y === H / 2 });
    // Oxen roam no-man's-land above and below the middle lane, clear of the front bases.
    const x0 = COLS[1] + 510 + 150;
    return {
      w: W, h: H, bases,
      // Roads (cosmetic): the three lanes, and the streets joining each column's bases.
      roads: [...ROWS.map(y => [0, y, W, y]), ...[COLS[0], COLS[1], W - COLS[1], W - COLS[0]].map(x => [x, ROWS[0], x, ROWS[2]])],
      river: true, village: true,
      zones: [{ x0, x1: W - x0, y0: 150, y1: H / 2 - 550 }, { x0, x1: W - x0, y0: H / 2 + 550, y1: H - 150 }],
      // One hero by each rear base: middle, then top, then bottom.
      spawn(team, i) {
        const y = [H / 2, H / 2 - 1280, H / 2 + 1280][i % 3], x = team === G.TEAM.PLAYER ? COLS[0] : W - COLS[0];
        return { x: x + (team === G.TEAM.PLAYER ? 110 : -110), y: y + 40 };
      },
      generate: generateFrosthaven
    };
  })();

  // keepClear: [{x, y, r}] areas rocks must not cover (spawn points etc.)
  function generateFrosthaven(seed, keepClear) {
    const rand = G.rng(seed);
    for (let i = 0; i < 65; i++) {
      map.ice.push({
        x: rand() * map.w, y: rand() * map.h,
        rx: 80 + rand() * 180, ry: 50 + rand() * 110, rot: rand() * Math.PI
      });
    }

    let tries = 0;
    while (map.rocks.length < 115 && tries++ < 6000) {
      const r = 22 + rand() * 50;
      const x = r + rand() * (map.w - 2 * r);
      const y = r + rand() * (map.h - 2 * r);
      const clashes =
        keepClear.some(c => G.dist(x, y, c.x, c.y) < r + c.r) ||
        map.rocks.some(o => G.dist(x, y, o.x, o.y) < r + o.r + 40);
      if (clashes) continue;
      map.rocks.push(rockShape(rand, x, y, r));
    }

    // Trees: solid trunks, generated after rocks so rock layout is unchanged.
    tries = 0;
    while (map.trees.length < 90 && tries++ < 6000) {
      const x = 40 + rand() * (map.w - 80), y = 40 + rand() * (map.h - 80);
      const clashes =
        Math.abs(x - map.w / 2) < 160 ||
        keepClear.some(c => G.dist(x, y, c.x, c.y) < c.r + 60) ||
        map.rocks.some(o => G.dist(x, y, o.x, o.y) < o.r + 40) ||
        map.trees.some(t => G.dist(x, y, t.x, t.y) < 70);
      if (clashes) continue;
      map.trees.push({ x, y, cr: 12, h: 150 + rand() * 130, rot: rand() * Math.PI * 2, variant: Math.floor(rand() * 4) });
    }
  }

  function rockShape(rand, x, y, r) {
    const pts = [];
    const n = 8 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const rr = r * (0.85 + rand() * 0.25);
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    return { x, y, r, cr: r * 0.92, pts };
  }

  // ---------------------------------------------------------------------------
  // Mountain. (u, v): offsets from the map center along x and y. The summit is the diamond
  // |u|/LU + |v|/LV <= 1 (west and east corners: the base camps; north and south: the 4-slot bases), plus a
  // round ledge under every base so none hangs over the cliff. Each side's camp faces a row of three bases,
  // the middle one furthest forward; a crevasse runs between the middle base and each flank base, from
  // behind the row out toward the middle of the summit.
  // ---------------------------------------------------------------------------
  const MOUNTAIN = (function () {
    const W = 8600, H = 6400, CX = W / 2, CY = H / 2, LU = CX - 60, LV = CY - 60;
    const K = 1 / Math.hypot(1 / LU, 1 / LV);   // world distance per unit of the diamond's 1 - |u|/LU - |v|/LV
    const LEDGE = 570;                            // ledge radius around a base center (base radius + 60)
    const bases = [];
    for (const side of [G.TEAM.PLAYER, G.TEAM.ENEMY]) {
      const s = side === G.TEAM.PLAYER ? -1 : 1;
      bases.push({ x: CX + s * 3600, y: CY, side, hq: true });
      bases.push({ x: CX + s * 1250, y: CY, side, front: true });
      bases.push({ x: CX + s * 1850, y: CY - 1150, side });
      bases.push({ x: CX + s * 1850, y: CY + 1150, side });
    }
    bases.push({ x: CX, y: CY - 2600, side: null, slots: 4 }, { x: CX, y: CY + 2600, side: null, slots: 4 });

    // Crevasses: ellipses (half-length a, half-width b) centered between each middle base and flank base,
    // across the line joining them.
    const chasms = [];
    for (const s of [-1, 1])
      for (const t of [-1, 1]) {
        const c = { x: CX + s * 1250, y: CY }, f = { x: CX + s * 1850, y: CY + t * 1150 };
        const len = G.dist(c.x, c.y, f.x, f.y);
        let ux = (f.y - c.y) / len, uy = -(f.x - c.x) / len;
        if (ux * s > 0) { ux = -ux; uy = -uy; }   // the axis runs from its back end (near the camp) to its front
        chasms.push({ x: (c.x + f.x) / 2, y: (c.y + f.y) / 2, ux, uy, a: 760, b: 110 });
      }

    // Distance from (x, y) in to the diamond's edge (negative outside).
    const diamondIn = (x, y) => (1 - Math.abs(x - CX) / LU - Math.abs(y - CY) / LV) * K;
    // Nearest point to (x, y) in the diamond shrunk by m.
    function intoDiamond(x, y, m) {
      const f = Math.max(0, 1 - m / K), lu = LU * f, lv = LV * f;
      const sx = Math.sign(x - CX) || 1, sy = Math.sign(y - CY) || 1, px = Math.abs(x - CX), py = Math.abs(y - CY);
      if (px / lu + py / lv <= 1) return { x, y };
      const ex = -lu, ey = lv, t = G.clamp(((px - lu) * ex + py * ey) / (ex * ex + ey * ey), 0, 1);
      return { x: CX + sx * (lu + ex * t), y: CY + sy * ey * t };
    }
    const shape = {
      // Is a body of radius r at (x, y) wholly on the summit?
      inside(x, y, r) {
        if (diamondIn(x, y) >= r) return true;
        for (const b of bases) if (G.dist(x, y, b.x, b.y) <= LEDGE - r) return true;
        return false;
      },
      // Nearest spot on the summit for a body of radius r.
      nearest(x, y, r) {
        if (shape.inside(x, y, r)) return { x, y };
        let best = intoDiamond(x, y, r), bd = G.dist(x, y, best.x, best.y);
        for (const b of bases) {
          const d = G.dist(x, y, b.x, b.y), k = LEDGE - r;
          if (d - k < bd) { bd = d - k; best = { x: b.x + (x - b.x) / (d || 1) * k, y: b.y + (y - b.y) / (d || 1) * k }; }
        }
        return best;
      },
      // Signed distance to the cliff edge: positive on the summit, negative over the drop.
      edge(x, y) {
        let d = diamondIn(x, y);
        for (const b of bases) d = Math.max(d, LEDGE - G.dist(x, y, b.x, b.y));
        return d;
      },
      diamond: { CX, CY, LU, LV }, ledge: LEDGE
    };

    return {
      w: W, h: H, bases, chasms, shape,
      zones: [{ x0: CX - 1000, x1: CX + 1000, y0: CY - 1950, y1: CY - 550 }, { x0: CX - 1000, x1: CX + 1000, y0: CY + 550, y1: CY + 1950 }],
      // Every hero starts in the camp: one just in front of the Command Center, the others to either side.
      spawn(team, i) {
        const b = bases.find(o => o.hq && o.side === team), face = team === G.TEAM.PLAYER ? 0 : Math.PI;
        const a = face + [0, -1, 1][i % 3] * Math.PI / 3;
        return { x: b.x + Math.cos(a) * 240, y: b.y + Math.sin(a) * 240 };
      },
      generate: generateMountain
    };
  })();

  function generateMountain(seed, keepClear) {
    const rand = G.rng(seed), L = map.layout, sh = L.shape;
    // Each crevasse is a chain of circles along its axis, as wide as the ellipse there.
    map.chasms = L.chasms.map(c => Object.assign({}, c));
    for (const c of map.chasms) {
      let t = -c.a;
      while (t <= c.a) {
        const half = Math.max(36, c.b * Math.sqrt(Math.max(0, 1 - (t / c.a) ** 2)));
        map.gaps.push({ x: c.x + c.ux * t, y: c.y + c.uy * t, cr: half, gap: true });
        t += Math.max(18, half * 0.45);
      }
    }
    const nearChasm = (x, y, pad) => map.gaps.some(g => G.dist(x, y, g.x, g.y) < g.cr + pad);

    for (let i = 0; i < 26; i++) {
      const x = rand() * map.w, y = rand() * map.h;
      if (sh.edge(x, y) < 200) continue;
      map.ice.push({ x, y, rx: 70 + rand() * 140, ry: 40 + rand() * 90, rot: rand() * Math.PI });
    }

    // Boulders: fewer than the village has rocks, in clusters of one to three.
    let tries = 0;
    while (map.rocks.length < 70 && tries++ < 6000) {
      const r = 26 + rand() * 54;
      const x = r + rand() * (map.w - 2 * r), y = r + rand() * (map.h - 2 * r);
      const clashes = sh.edge(x, y) < r + 60 || nearChasm(x, y, r + 140) ||
        keepClear.some(c => G.dist(x, y, c.x, c.y) < r + c.r) ||
        map.rocks.some(o => G.dist(x, y, o.x, o.y) < r + o.r + 40);
      if (clashes) continue;
      map.rocks.push(rockShape(rand, x, y, r));
    }

    // Stunted pines, mostly toward the cliffs.
    tries = 0;
    while (map.trees.length < 45 && tries++ < 6000) {
      const x = 40 + rand() * (map.w - 80), y = 40 + rand() * (map.h - 80), e = sh.edge(x, y);
      const clashes = e < 50 || e > 900 || nearChasm(x, y, 90) ||
        keepClear.some(c => G.dist(x, y, c.x, c.y) < c.r + 60) ||
        map.rocks.some(o => G.dist(x, y, o.x, o.y) < o.r + 40) ||
        map.trees.some(t => G.dist(x, y, t.x, t.y) < 70);
      if (clashes) continue;
      map.trees.push({ x, y, cr: 12, h: 120 + rand() * 110, rot: rand() * Math.PI * 2, variant: Math.floor(rand() * 4) });
    }
  }

  // ---------------------------------------------------------------------------
  // Coast: sea cliffs. A channel of seawater runs the map's height, from the sea at the top to the sea at
  // the bottom, so the west and east shores meet only on its four bridges. Halfway down, an inlet crosses
  // it, reaching into each shore; walkers go round its far tip. Each side's Command Center stands on its
  // shore opposite the inlet, with a base by each bridge and one more in a rear corner (the bottom-left for
  // the west, the top-right for the east: the map turns about its center onto itself).
  // The water blocks walkers like a crevasse (gaps), but shots fly over it.
  // ---------------------------------------------------------------------------
  const COAST = (function () {
    const W = 9000, H = 8400, CX = W / 2, CY = H / 2;
    const B = 300;                                   // the channel's half-width
    const BA = 260, L = 2000;                        // the inlet's half-width, and its tips' distance from the center
    const BW = 360;                                  // a bridge's clear width
    const BRIDGES = [CY - 3200, CY - 1150, CY + 1150, CY + 3200];
    const APPROACH = 140;                            // a bridge's end: this far out from the bank
    const bases = [];
    for (const side of [G.TEAM.PLAYER, G.TEAM.ENEMY]) {
      const s = side === G.TEAM.PLAYER ? -1 : 1;
      bases.push({ x: CX + s * 3700, y: CY, side, hq: true });
      for (const by of BRIDGES) bases.push({ x: CX + s * 1250, y: by, side, front: by === CY + s * 1150 });
      bases.push({ x: CX + s * 3500, y: CY - s * 2700, side });
    }

    // The water: the channel's stretches between the bridges (past the map at both ends), and the inlet's
    // two arms, as rectangles [x0, y0, x1, y1]. The inlet's tips are round (circles of radius BA).
    const stretches = [];
    let y0 = -400;
    for (const by of BRIDGES) { stretches.push([CX - B, y0, CX + B, by - BW / 2]); y0 = by + BW / 2; }
    stretches.push([CX - B, y0, CX + B, H + 400]);
    const arms = [[CX - L, CY - BA, CX, CY + BA], [CX, CY - BA, CX + L, CY + BA]];
    const tips = [{ x: CX - L, y: CY }, { x: CX + L, y: CY }];

    // The coast: the shore runs a little way outside the map's edges, wavering. off*(t): how far out.
    const wave = (t, p) => 110 + 45 * Math.sin(t / 260 + p) + 30 * Math.sin(t / 97 + p * 2.3);
    const coast = {
      W, H, CX, CY, B, BA, L, BW, BRIDGES, tips,
      offTop: x => wave(x, 0.4), offBottom: x => wave(x, 2.9), offLeft: y => wave(y, 1.3), offRight: y => wave(y, 4.2),
      // Signed distance to the nearest water (positive on land), and the nearest point on the cliff top.
      land(x, y) {
        let d = Math.abs(x - CX) - B, rx = CX + Math.sign(x - CX || 1) * B, ry = y;
        const ax = G.clamp(x, CX - L, CX + L), da = Math.hypot(x - ax, y - CY) - BA;
        if (da < d) { d = da; const k = BA / ((da + BA) || 1); rx = ax + (x - ax) * k; ry = CY + (y - CY) * k; }
        const edges = [[y + coast.offTop(x), x, -coast.offTop(x)], [H - y + coast.offBottom(x), x, H + coast.offBottom(x)],
          [x + coast.offLeft(y), -coast.offLeft(y), y], [W - x + coast.offRight(y), W + coast.offRight(y), y]];
        for (const [e, ex, ey] of edges) if (e < d) { d = e; rx = ex; ry = ey; }
        return { d, rx, ry };
      }
    };

    // Does p->q pass over water (the channel's rectangles, the inlet's capsule; grown by m)?
    const overWater = (px, py, qx, qy, m) =>
      stretches.some(([x0, y0, x1, y1]) => segBox(px, py, qx, qy, x0 - m, y0 - m, x1 + m, y1 + m)) || overInlet(px, py, qx, qy, m);
    const overInlet = (px, py, qx, qy, m) => segSegDist(px, py, qx, qy, CX - L, CY, CX + L, CY) < BA + m;
    // Length of the way from p to q on one shore (s): straight, or round the inlet's tip.
    function shoreWay(px, py, qx, qy, s) {
      if (!overInlet(px, py, qx, qy, 0)) return G.dist(px, py, qx, qy);
      const tx = CX + s * (L + BA);
      return G.dist(px, py, tx, CY) + G.dist(tx, CY, qx, qy);
    }
    // Round the inlet's tip on side s: points on a circle about the tip, 45 degrees apart, from the walker's
    // side of the inlet to the target's. Head for the furthest one in sight.
    function roundTip(e, tx, ty, s, m) {
      const ys = Math.sign(e.y - CY) || 1, yt = Math.sign(ty - CY) || -ys;
      if (ys === yt) return null;   // the target is in the water, or just off its side: walk up to it
      const rho = BA + (e.r || 0) + 70, cx = CX + s * L;
      let way = null;
      for (const a of [ys * 90, ys * 45, 0, yt * 45, yt * 90]) {
        const t = a * Math.PI / 180, p = { x: cx + s * rho * Math.cos(t), y: CY + rho * Math.sin(t) };
        if (!way || !overInlet(e.x, e.y, p.x, p.y, m)) way = p;
      }
      return way;
    }

    // Where a walker `e` heading for (tx, ty) should head instead (null: straight there). Across the
    // channel: to the end of the bridge with the shortest way, then straight over it. Along a shore with the
    // inlet in the way: round its tip.
    function route(e, tx, ty) {
      const r = e.r || 0, m = r * 0.5;
      if (!overWater(e.x, e.y, tx, ty, m)) return null;
      const to = tx < CX ? -1 : 1, lane = Math.max(10, BW / 2 - r - 8);
      // On a bridge or lined up at one of its ends: over it (or back off it) toward the target's shore.
      if ((e.x - CX) * to < B + APPROACH - 10)
        for (const by of BRIDGES)
          if (Math.abs(e.y - by) <= lane + 4 && Math.abs(e.x - CX) < B + APPROACH + 15)
            return { x: CX + to * (B + APPROACH), y: G.clamp(e.y, by - lane, by + lane) };
      const s = e.x < CX ? -1 : 1;
      if (s === to) return roundTip(e, tx, ty, s, m);
      let best = BRIDGES[0], bc = Infinity;
      for (const by of BRIDGES) {
        const c = shoreWay(e.x, e.y, CX + s * (B + APPROACH), by, s) + shoreWay(CX + to * (B + APPROACH), by, tx, ty, to);
        if (c < bc) { bc = c; best = by; }
      }
      const end = { x: CX + s * (B + APPROACH), y: best };
      return overInlet(e.x, e.y, end.x, end.y, m) ? roundTip(e, end.x, end.y, s, m) : end;
    }

    return {
      w: W, h: H, bases, coast, route, stretches, arms, daylight: true,
      // Oxen graze each side's empty corner: the west's top-left, the east's bottom-right.
      zones: [{ x0: CX - 4300, x1: CX - 2050, y0: CY - 3900, y1: CY - 1500 }, { x0: CX + 2050, x1: CX + 4300, y0: CY + 1500, y1: CY + 3900 }],
      // Every hero starts by the Command Center: one just in front of it, the others to either side.
      spawn(team, i) {
        const b = bases.find(o => o.hq && o.side === team), face = team === G.TEAM.PLAYER ? 0 : Math.PI;
        const a = face + [0, -1, 1][i % 3] * Math.PI / 3;
        return { x: b.x + Math.cos(a) * 240, y: b.y + Math.sin(a) * 240 };
      },
      generate: generateCoast
    };
  })();

  // Whether segment p->q meets the box [x0, x1] x [y0, y1] (Liang-Barsky).
  function segBox(px, py, qx, qy, x0, y0, x1, y1) {
    let t0 = 0, t1 = 1;
    const dx = qx - px, dy = qy - py;
    for (const [p, q] of [[-dx, px - x0], [dx, x1 - px], [-dy, py - y0], [dy, y1 - py]]) {
      if (p === 0) { if (q < 0) return false; continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return true;
  }

  // Shortest distance between segments p->q and a->b.
  const segSegDist = (px, py, qx, qy, ax, ay, bx, by) => crossAt(px, py, qx, qy, ax, ay, bx, by) !== null ? 0 :
    Math.min(G.segDist(px, py, ax, ay, bx, by), G.segDist(qx, qy, ax, ay, bx, by), G.segDist(ax, ay, px, py, qx, qy), G.segDist(bx, by, px, py, qx, qy));

  function generateCoast(seed, keepClear) {
    const rand = G.rng(seed), L = map.layout, co = L.coast;
    // The water is filled with overlapping circles: rows along each rectangle's length, a few across.
    const R = 115, STEP = 90;
    function fill([x0, y0, x1, y1]) {
      const vert = y1 - y0 >= x1 - x0, across = vert ? x1 - x0 : y1 - y0, along = vert ? y1 - y0 : x1 - x0;
      const n = Math.max(1, Math.ceil((across - 2 * R) / (1.6 * R)) + 1), m = Math.max(1, Math.ceil((along - 2 * R) / STEP) + 1);
      for (let i = 0; i < n; i++)
        for (let j = 0; j < m; j++) {
          const a = n === 1 ? across / 2 : R + i * (across - 2 * R) / (n - 1), b = m === 1 ? along / 2 : R + j * (along - 2 * R) / (m - 1);
          map.gaps.push({ x: vert ? x0 + a : x0 + b, y: vert ? y0 + b : y0 + a, cr: R, gap: true });
        }
    }
    L.stretches.forEach(fill);
    L.arms.forEach(fill);
    for (const t of co.tips) map.gaps.push({ x: t.x, y: t.y, cr: co.BA, gap: true });

    const shore = (x, y) => co.land(x, y).d;
    // Clear of the bridges' ends, so nothing stands in the way onto one.
    const byBridge = (x, y, pad) => co.BRIDGES.some(by => Math.abs(y - by) < co.BW / 2 + pad && Math.abs(x - co.CX) < co.B + 260 + pad);

    for (let i = 0; i < 30; i++) {
      const x = rand() * map.w, y = rand() * map.h;
      if (shore(x, y) < 200) continue;
      map.ice.push({ x, y, rx: 70 + rand() * 140, ry: 40 + rand() * 90, rot: rand() * Math.PI });
    }

    // Weathered boulders, thickest toward the cliffs.
    let tries = 0;
    while (map.rocks.length < 80 && tries++ < 8000) {
      const r = 24 + rand() * 50;
      const x = r + rand() * (map.w - 2 * r), y = r + rand() * (map.h - 2 * r), e = shore(x, y);
      const clashes = e < r + 70 || (e > 1200 && rand() < 0.6) || byBridge(x, y, r + 60) ||
        keepClear.some(c => G.dist(x, y, c.x, c.y) < r + c.r) ||
        map.rocks.some(o => G.dist(x, y, o.x, o.y) < r + o.r + 40);
      if (clashes) continue;
      map.rocks.push(rockShape(rand, x, y, r));
    }

    // Wind-bent pines, in stands away from the cliff tops.
    tries = 0;
    while (map.trees.length < 70 && tries++ < 8000) {
      const x = 40 + rand() * (map.w - 80), y = 40 + rand() * (map.h - 80);
      const clashes = shore(x, y) < 140 || byBridge(x, y, 80) ||
        (map.trees.length && rand() < 0.75 && !map.trees.some(t => G.dist(x, y, t.x, t.y) < 260)) ||
        keepClear.some(c => G.dist(x, y, c.x, c.y) < c.r + 60) ||
        map.rocks.some(o => G.dist(x, y, o.x, o.y) < o.r + 40) ||
        map.trees.some(t => G.dist(x, y, t.x, t.y) < 70);
      if (clashes) continue;
      map.trees.push({ x, y, cr: 12, h: 130 + rand() * 120, rot: rand() * Math.PI * 2, variant: Math.floor(rand() * 4) });
    }
  }

  // ---------------------------------------------------------------------------
  // Docks: a harbor. Ten bases stand in a ring, five a side, around a round basin. A ship lies moored in
  // the basin's middle, and its deck holds an eleventh base, reached by four gangways (north, east, south,
  // west). Two channels cut in from the sea at the top and bottom, between each side's end bases, and stop
  // short of the basin; a bridge crosses each one. Beyond the map's edges lies the sea.
  // Unlike the Coast's water (circles of `gaps`), the water here is a walkable area, `dry` (like the
  // Mountain's summit `shape`): it keeps quay edges, gangways and the curved hull exact. Shots fly over it.
  // Walkers find their way with `route`: a small graph of waypoints round the basin, round the channels'
  // ends and over the bridges and gangways.
  // ---------------------------------------------------------------------------
  const DOCKS = (function () {
    const W = 7800, H = 7800, CX = W / 2, CY = H / 2;
    const RB = 2900;                                 // the ring of bases' radius
    const RM = 1450;                                 // the basin's radius
    const SA = 1050, SB = 680;                       // the ship's deck: an ellipse, SA north-south, SB east-west
    const B = 180, TIP = 2150;                       // a channel's half-width; its round end's center, from the map center
    const BW = 360, HALF = BW / 2, APPROACH = 140;   // a bridge's clear width; its ends lie this far out from the bank
    const BY = Math.round(RB * Math.cos(Math.PI / 10));   // the channel bridges: level with the bases beside them
    const OFF = 120;                                 // the quays along the sea: this far outside the map's edges
    const bases = [];
    for (const side of [G.TEAM.PLAYER, G.TEAM.ENEMY]) {
      const s = side === G.TEAM.PLAYER ? -1 : 1;
      // Clockwise from north: 18, 54, 90, 126 and 162 degrees. The Command Center's base faces the other
      // side across the basin; each side's front is the base by a channel bridge (the map turns about its
      // center onto itself: the west's is by the south bridge, the east's by the north one).
      for (const deg of [18, 54, 90, 126, 162]) {
        const a = deg * Math.PI / 180;
        bases.push({ x: CX + s * RB * Math.sin(a), y: CY - RB * Math.cos(a), side, hq: deg === 90, front: deg === (s < 0 ? 162 : 18) });
      }
    }
    bases.push({ x: CX, y: CY, side: null });       // on the ship

    // Bridges: from end a to end b (each this side of APPROACH on dry ground), HALF either side of the line.
    // The gangways run from the basin's bank onto the deck.
    const bridge = (ax, ay, bx, by, gangway) => {
      const len = Math.hypot(bx - ax, by - ay);
      return { ax, ay, bx, by, len, ux: (bx - ax) / len, uy: (by - ay) / len, gangway };
    };
    const gangways = [[0, -1, SA - 150], [1, 0, SB - 130], [0, 1, SA - 150], [-1, 0, SB - 130]]
      .map(([dx, dy, inner]) => bridge(CX + dx * (RM + APPROACH), CY + dy * (RM + APPROACH), CX + dx * inner, CY + dy * inner, true));
    const crossings = [-1, 1].map(s => bridge(CX - B - APPROACH, CY + s * BY, CX + B + APPROACH, CY + s * BY, false));
    const bridges = [...gangways, ...crossings];
    // Where a point lies along bridge k (t from end a) and across it (l).
    const along = (k, x, y) => (x - k.ax) * k.ux + (y - k.ay) * k.uy;
    const across = (k, x, y) => -(x - k.ax) * k.uy + (y - k.ay) * k.ux;
    const onBridge = (k, x, y, m) => { const t = along(k, x, y); return t >= 0 && t <= k.len && Math.abs(across(k, x, y)) <= HALF - m; };

    // The channels' water, as rectangles [x0, y0, x1, y1] (open where the bridges cross) and round ends.
    const channels = [
      [CX - B, -OFF - 400, CX + B, CY - BY - HALF], [CX - B, CY - BY + HALF, CX + B, CY - TIP],
      [CX - B, CY + TIP, CX + B, CY + BY - HALF], [CX - B, CY + BY + HALF, CX + B, H + OFF + 400]
    ];
    const tips = [{ x: CX, y: CY - TIP }, { x: CX, y: CY + TIP }];
    // Each channel bridged over, as a capsule: the straight from beyond the map's edge to its round end.
    const capsules = [[CX, -OFF - 400, CX, CY - TIP], [CX, CY + TIP, CX, H + OFF + 400]];

    const inDeck = (x, y) => ((x - CX) / SB) ** 2 + ((y - CY) / SA) ** 2 <= 1;
    // Nearest point on the deck's edge to (x, y) (a few steps of 0fps.net's trig-free ellipse method).
    function deckEdge(x, y) {
      const px = Math.abs(x - CX), py = Math.abs(y - CY);
      let tx = Math.SQRT1_2, ty = Math.SQRT1_2;
      for (let i = 0; i < 3; i++) {
        const ex = (SB * SB - SA * SA) * tx ** 3 / SB, ey = (SA * SA - SB * SB) * ty ** 3 / SA;
        const r = Math.hypot(SB * tx - ex, SA * ty - ey), q = Math.hypot(px - ex, py - ey) || 1;
        tx = G.clamp(((px - ex) * r / q + ex) / SB, 0, 1); ty = G.clamp(((py - ey) * r / q + ey) / SA, 0, 1);
        const n = Math.hypot(tx, ty); tx /= n; ty /= n;
      }
      return { x: CX + Math.sign(x - CX || 1) * SB * tx, y: CY + Math.sign(y - CY || 1) * SA * ty };
    }
    // Signed distances (positive on dry ground): to the water of the basin and channels, from the deck's
    // edge, and from a bridge's sides and ends.
    const landIn = (x, y) => Math.min(Math.hypot(x - CX, y - CY) - RM, ...capsules.map(c => G.segDist(x, y, ...c) - B));
    function deckIn(x, y) {
      const p = deckEdge(x, y), d = G.dist(x, y, p.x, p.y);
      return inDeck(x, y) ? d : -d;
    }
    const bridgeIn = (k, x, y) => { const t = along(k, x, y); return Math.min(HALF - Math.abs(across(k, x, y)), t, k.len - t); };

    const dry = {
      // Is a body of radius r at (x, y) wholly on dry ground: a quay, a bridge or the deck?
      inside(x, y, r) {
        if (landIn(x, y) >= r) return true;
        for (const k of bridges) if (bridgeIn(k, x, y) >= r) return true;
        return G.dist(x, y, CX, CY) < RM && deckIn(x, y) >= r;
      },
      // Nearest dry spot for a body of radius r: back onto the quay, the bridge or the deck, whichever is closest.
      nearest(x, y, r) {
        if (dry.inside(x, y, r)) return { x, y };
        const opts = [];
        let p = { x, y };
        for (let i = 0; i < 2; i++) {
          const d = G.dist(p.x, p.y, CX, CY) || 1;
          if (d < RM + r) p = { x: CX + (p.x - CX) / d * (RM + r), y: CY + (p.y - CY) / d * (RM + r) };
          for (const [ax, ay, bx, by] of capsules) {
            const qy = G.clamp(p.y, Math.min(ay, by), Math.max(ay, by)), e = G.dist(p.x, p.y, ax, qy);
            if (e < B + r) { const k = (B + r) / (e || 1); p = e ? { x: ax + (p.x - ax) * k, y: qy + (p.y - qy) * k } : { x: ax + Math.sign(x - ax || 1) * (B + r), y: qy }; }
          }
        }
        opts.push(p);
        for (const k of bridges) {
          const t = G.clamp(along(k, x, y), 0, k.len), l = G.clamp(across(k, x, y), -(HALF - r), HALF - r);
          opts.push({ x: k.ax + k.ux * t - k.uy * l, y: k.ay + k.uy * t + k.ux * l });
        }
        if (G.dist(x, y, CX, CY) < RM) {
          // Straight in from the edge's nearest point, along its normal.
          const e = deckEdge(x, y), nx = (e.x - CX) / (SB * SB), ny = (e.y - CY) / (SA * SA), n = Math.hypot(nx, ny) || 1;
          opts.push({ x: e.x - nx / n * r, y: e.y - ny / n * r });
        }
        let best = p, bd = Infinity;
        for (const o of opts) {
          const d = G.dist(x, y, o.x, o.y);
          if (d < bd && dry.inside(o.x, o.y, r - 1)) { bd = d; best = o; }
        }
        return best;
      }
    };

    // Can a walker of radius r go straight from p to q? Over the channels: clear of their water by half
    // its body (it slides along a straight bank). Over the basin: wholly outside it by its whole body (or
    // it catches where a gangway meets the bank), or both ends on the deck (an ellipse: nothing lies
    // between), or both on one gangway, as far out as the body can stand. A squad's anchor (r 0) only
    // counts as on a gangway near its middle, so the block behind it fits.
    function clear(px, py, qx, qy, r) {
      const m = r * 0.5, mb = r ? r - 1 : HALF - 40;
      for (const [x0, y0, x1, y1] of channels) if (segBox(px, py, qx, qy, x0 - m, y0 - m, x1 + m, y1 + m)) return false;
      for (const t of tips) if (G.segDist(t.x, t.y, px, py, qx, qy) < B + m) return false;
      if (G.segDist(CX, CY, px, py, qx, qy) >= RM + Math.max(0, r - 1)) return true;
      if (inDeck(px, py) && inDeck(qx, qy)) return true;
      return gangways.some(k => onBridge(k, px, py, mb) && onBridge(k, qx, qy, mb));
    }

    // The waypoints: a ring round the basin, points round each channel's end, and both ends of every bridge.
    // Ways between them (clear with a walker's margin) and the shortest ways over them are worked out once.
    const nodes = [];
    for (let i = 0; i < 24; i++) { const a = i * Math.PI / 12; nodes.push({ x: CX + Math.cos(a) * (RM + 200), y: CY + Math.sin(a) * (RM + 200) }); }
    for (const t of tips) {
      const s = Math.sign(CY - t.y);   // toward the basin
      for (const deg of [-90, -45, 0, 45, 90]) { const a = deg * Math.PI / 180; nodes.push({ x: t.x + Math.sin(a) * (B + 170), y: t.y + s * Math.cos(a) * (B + 170) }); }
    }
    for (const k of bridges) nodes.push({ x: k.ax, y: k.ay, k }, { x: k.bx, y: k.by, k });
    const N = nodes.length, MARGIN = 24;
    const D = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => i === j ? 0 :
      clear(nodes[i].x, nodes[i].y, nodes[j].x, nodes[j].y, MARGIN) ? G.dist(nodes[i].x, nodes[i].y, nodes[j].x, nodes[j].y) : Infinity));
    const NEXT = D.map((row, i) => row.map((d, j) => (d < Infinity ? j : -1)));
    for (let k = 0; k < N; k++)
      for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++)
          if (D[i][k] + D[k][j] < D[i][j]) { D[i][j] = D[i][k] + D[k][j]; NEXT[i][j] = NEXT[i][k]; }

    // Where to aim for waypoint i: on a bridge's end, level with the walker (within the bridge), so a crowd
    // files over side by side. A squad's anchor (no body) keeps to the middle, so its whole block fits.
    const lane = e => (e.r ? Math.max(10, HALF - e.r - 8) : 0);
    function aim(i, e) {
      const n = nodes[i], k = n.k;
      if (!k) return { x: n.x, y: n.y };
      const l = G.clamp(across(k, e.x, e.y), -lane(e), lane(e));
      return { x: n.x - k.uy * l, y: n.y + k.ux * l };
    }
    // Waypoint i reached: close to it, and at a bridge's end, lined up within the bridge.
    function reached(i, e) {
      const a = aim(i, e), k = nodes[i].k;
      return G.dist(e.x, e.y, a.x, a.y) < 30 && (!k || Math.abs(across(k, e.x, e.y)) <= lane(e) + 4);
    }
    // Walkers keep their way for a while (the path of waypoints, re-planned every half second or when the
    // goal moves): each step only checks whether the next waypoint is already in sight.
    const plans = new WeakMap();
    function plan(e, tx, ty) {
      let best = null, bc = Infinity;
      const from = [], to = [], r = e.r || 0;
      for (let i = 0; i < N; i++) {
        if (clear(e.x, e.y, nodes[i].x, nodes[i].y, r)) from.push(i);
        if (clear(nodes[i].x, nodes[i].y, tx, ty, r)) to.push(i);
      }
      for (const i of from) {
        const di = G.dist(e.x, e.y, nodes[i].x, nodes[i].y);
        for (const j of to) {
          const c = di + D[i][j] + G.dist(nodes[j].x, nodes[j].y, tx, ty);
          if (c < bc) { bc = c; best = [i, j]; }
        }
      }
      if (!best) return [];
      const path = [best[0]];
      for (let i = best[0]; i !== best[1];) path.push(i = NEXT[i][best[1]]);
      return path;
    }
    function route(e, tx, ty) {
      const r = e.r || 0;
      // A goal out on the water (a soldier's place in a block hanging over the edge): the nearest dry spot.
      const wet = !dry.inside(tx, ty, Math.max(1, r));
      if (wet) ({ x: tx, y: ty } = dry.nearest(tx, ty, Math.max(1, r)));
      if (clear(e.x, e.y, tx, ty, r)) return wet && G.dist(e.x, e.y, tx, ty) > 4 ? { x: tx, y: ty } : null;
      let p = plans.get(e);
      if (!p || !p.path.length || --p.ttl <= 0 || G.dist(p.tx, p.ty, tx, ty) > 60) {
        p = { tx, ty, ttl: 30, path: plan(e, tx, ty) };
        if (typeof e === 'object' && e.constructor !== Object) plans.set(e, p);   // entities only, not one-off probes
      }
      const path = p.path;
      // Drop waypoints reached, or passed: the next one is in sight.
      while (path.length > 1 && (reached(path[0], e) || clear(e.x, e.y, nodes[path[1]].x, nodes[path[1]].y, r))) path.shift();
      if (path.length === 1 && reached(path[0], e)) path.shift();
      return path.length ? aim(path[0], e) : null;
    }

    return {
      w: W, h: H, bases, dry, route, village: true, daylight: true,
      harbor: {
        W, H, CX, CY, RB, RM, SA, SB, B, TIP, BW, BY, OFF, bridges, gangways, crossings, nodes, capsules,
        // Signed distance to the water (positive on land; the ship's deck and the bridges count as water
        // here), and the nearest point on the quay's edge.
        land(x, y) {
          const rho = G.dist(x, y, CX, CY);
          let d = rho - RM, rx = CX + (x - CX) / (rho || 1) * RM, ry = CY + (y - CY) / (rho || 1) * RM;
          for (const [ax, ay, bx, by] of capsules) {
            const qy = G.clamp(y, Math.min(ay, by), Math.max(ay, by)), e = G.dist(x, y, ax, qy) - B;
            if (e < d) { d = e; const k = B / ((e + B) || 1); rx = ax + (x - ax) * k; ry = qy + (y - qy) * k; }
          }
          const edges = [[y + OFF, x, -OFF], [H + OFF - y, x, H + OFF], [x + OFF, -OFF, y], [W + OFF - x, W + OFF, y]];
          for (const [e, ex, ey] of edges) if (e < d) { d = e; rx = ex; ry = ey; }
          return { d, rx, ry };
        }
      },
      // Oxen graze each side's empty corner: the west's top-left, the east's bottom-right.
      zones: [{ x0: 150, x1: 1400, y0: 150, y1: 1400 }, { x0: W - 1400, x1: W - 150, y0: H - 1400, y1: H - 150 }],
      // Every hero starts by the Command Center: one just in front of it, the others to either side.
      spawn(team, i) {
        const b = bases.find(o => o.hq && o.side === team), face = team === G.TEAM.PLAYER ? 0 : Math.PI;
        const a = face + [0, -1, 1][i % 3] * Math.PI / 3;
        return { x: b.x + Math.cos(a) * 240, y: b.y + Math.sin(a) * 240 };
      },
      generate: generateDocks
    };
  })();

  function generateDocks(seed, keepClear) {
    const rand = G.rng(seed), L = map.layout, hb = L.harbor;
    const shore = (x, y) => hb.land(x, y).d, rho = (x, y) => G.dist(x, y, hb.CX, hb.CY);
    // Clear of the bridges' ends and the waypoints walkers steer by.
    const inWay = (x, y, pad) => hb.nodes.some(n => G.dist(x, y, n.x, n.y) < pad + 90) ||
      hb.crossings.some(k => Math.abs(y - k.ay) < hb.BW / 2 + pad && Math.abs(x - hb.CX) < hb.B + 260 + pad);

    // The ship's two masts (solid; drawn with the ship, not as rocks).
    for (const s of [-1, 1]) map.rocks.push({ x: hb.CX, y: hb.CY + s * 760, r: 20, cr: 20, mast: true });

    for (let i = 0; i < 24; i++) {
      const x = rand() * map.w, y = rand() * map.h;
      if (shore(x, y) < 220 || rho(x, y) < hb.RM + 400) continue;
      map.ice.push({ x, y, rx: 70 + rand() * 140, ry: 40 + rand() * 90, rot: rand() * Math.PI });
    }

    // Warehouses, woodpiles and stacked cargo (drawn as the village's buildings, see render3d), kept off the
    // quay round the basin so the way round it stays open.
    let tries = 0;
    while (map.rocks.length < 80 && tries++ < 8000) {
      const r = 24 + rand() * 50;
      const x = r + rand() * (map.w - 2 * r), y = r + rand() * (map.h - 2 * r);
      const clashes = shore(x, y) < r + 90 || rho(x, y) < hb.RM + 450 || inWay(x, y, r) ||
        keepClear.some(c => G.dist(x, y, c.x, c.y) < r + c.r) ||
        map.rocks.some(o => G.dist(x, y, o.x, o.y) < r + o.r + 60);
      if (clashes) continue;
      map.rocks.push(rockShape(rand, x, y, r));
    }

    // A few stands of pines toward the map's edges.
    tries = 0;
    while (map.trees.length < 40 && tries++ < 8000) {
      const x = 40 + rand() * (map.w - 80), y = 40 + rand() * (map.h - 80);
      const clashes = shore(x, y) < 140 || rho(x, y) < hb.RB - 200 || inWay(x, y, 40) ||
        (map.trees.length && rand() < 0.7 && !map.trees.some(t => G.dist(x, y, t.x, t.y) < 240)) ||
        keepClear.some(c => G.dist(x, y, c.x, c.y) < c.r + 60) ||
        map.rocks.some(o => G.dist(x, y, o.x, o.y) < o.r + 40) ||
        map.trees.some(t => G.dist(x, y, t.x, t.y) < 70);
      if (clashes) continue;
      map.trees.push({ x, y, cr: 12, h: 130 + rand() * 120, rot: rand() * Math.PI * 2, variant: Math.floor(rand() * 4) });
    }
  }

  const LAYOUTS = { frosthaven: FROSTHAVEN, mountain: MOUNTAIN, coast: COAST, docks: DOCKS };

  // Load a map (unknown ids fall back to Frosthaven). Call before G.createBases.
  map.use = function (id) {
    map.id = G.mapById(id).id;
    map.layout = LAYOUTS[map.id];
    map.w = map.layout.w; map.h = map.layout.h;
    map.rocks = []; map.trees = []; map.ice = []; map.gaps = []; map.chasms = [];
    grid = null; gridFor = null;
  };

  map.generate = function (seed, keepClear) {
    map.rocks = []; map.trees = []; map.ice = []; map.gaps = []; map.chasms = [];
    map.layout.generate(seed, keepClear);
  };

  // Where the i-th hero (0-2) of a side starts and respawns.
  map.spawnPoint = (team, i) => map.layout.spawn(team, i);
  // Where neutral creatures roam: [{ x0, x1, y0, y1 }].
  map.zones = () => map.layout.zones;

  // The menu's map choice, kept on this PC.
  G.savedMapId = function () { try { return G.mapById(localStorage.getItem('frost.map')).id; } catch (e) { return G.MAPS[0].id; } };
  G.saveMapId = function (id) { try { localStorage.setItem('frost.map', id); } catch (e) { /* storage blocked */ } };

  // team: whose walker asks, so the gates of its own walls let it through (see bases.js).
  // The ground walkers are kept on, if the layout limits it: the Mountain's summit, the Docks' quays and deck.
  const footing = () => map.layout.shape || map.layout.dry;
  map.blocked = function (x, y, r, team) {
    if (x < r || y < r || x > map.w - r || y > map.h - r) return true;
    const sh = footing();
    if (sh && !sh.inside(x, y, r)) return true;
    return map.hitsRock(x, y, r, team);
  };

  // Everything solid: rocks, trees, crevasses, plus placed buildings. Each has {x, y, cr}.
  map.solids = () => map.rocks.concat(map.trees, map.gaps, G.buildingSolids ? G.buildingSolids() : []);

  // Rocks, trees and crevasses never move, so they are bucketed in a grid: collision checks (run for every
  // unit, every step) only look at the few near the point instead of all ~200.
  const CELL = 200;
  let grid = null, gridCols = 0, gridRows = 0, maxCr = 0, gridFor = null;
  function buildGrid() {
    gridCols = Math.ceil(map.w / CELL); gridRows = Math.ceil(map.h / CELL);
    grid = Array.from({ length: gridCols * gridRows }, () => []);
    maxCr = 0;
    for (const k of map.rocks.concat(map.trees, map.gaps)) {
      const i = G.clamp(Math.floor(k.x / CELL), 0, gridCols - 1), j = G.clamp(Math.floor(k.y / CELL), 0, gridRows - 1);
      grid[j * gridCols + i].push(k);
      maxCr = Math.max(maxCr, k.cr);
    }
    gridFor = map.rocks;
  }
  // Buildings get a grid of their own, rebuilt whenever one goes up or comes down (buildingSolids()
  // hands back a new list then).
  let bGrid = null, bMaxCr = 0, bGridFor = null;
  function buildBuildingGrid(list) {
    bGrid = Array.from({ length: gridCols * gridRows }, () => []);
    bMaxCr = 0;
    for (const k of list) {
      const i = G.clamp(Math.floor(k.x / CELL), 0, gridCols - 1), j = G.clamp(Math.floor(k.y / CELL), 0, gridRows - 1);
      bGrid[j * gridCols + i].push(k);
      bMaxCr = Math.max(bMaxCr, k.cr);
    }
    bGridFor = list;
  }
  function gather(cells, x, y, pad) {
    const i0 = Math.max(0, Math.floor((x - pad) / CELL)), i1 = Math.min(gridCols - 1, Math.floor((x + pad) / CELL));
    const j0 = Math.max(0, Math.floor((y - pad) / CELL)), j1 = Math.min(gridRows - 1, Math.floor((y + pad) / CELL));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++)
        for (const k of cells[j * gridCols + i]) near.push(k);
  }
  // Solids that might touch a circle at (x, y) of radius r. Reuses one array: don't hold on to it.
  const near = [];
  function solidsNear(x, y, r) {
    if (gridFor !== map.rocks) { buildGrid(); bGridFor = null; }  // generate() replaces the rock list
    near.length = 0;
    gather(grid, x, y, r + maxCr);
    if (G.buildingSolids) {
      const list = G.buildingSolids();
      if (list !== bGridFor) buildBuildingGrid(list);
      gather(bGrid, x, y, r + bMaxCr);
    }
    return near;
  }

  // Wall posts: a gate post stops everyone but its own side. overWalls: shots fly over walls entirely,
  // and over crevasses (nobody walks over those, burrowers included).
  const passes = (k, team, overWalls) => (k.wall && (overWalls || (k.gate && k.team === team))) || (k.gap && overWalls === true);
  map.hitsRock = (x, y, r, team, overWalls) => solidsNear(x, y, r).some(k => !passes(k, team, overWalls) && G.dist(x, y, k.x, k.y) < r + k.cr);

  // Push a circle entity out of rocks/buildings and keep it on the map. Burrowers pass under walls.
  map.resolve = function (e) {
    for (const k of solidsNear(e.x, e.y, e.r)) {
      if (!k.gap && passes(k, e.team, e.burrowed)) continue;
      let dx = e.x - k.x, dy = e.y - k.y;
      let d = Math.hypot(dx, dy);
      const min = e.r + k.cr;
      if (d < min) {
        if (d < 0.001) { dx = 1; dy = 0; d = 1; }
        e.x = k.x + (dx / d) * min;
        e.y = k.y + (dy / d) * min;
      }
    }
    e.x = G.clamp(e.x, e.r, map.w - e.r);
    e.y = G.clamp(e.y, e.r, map.h - e.r);
    const sh = footing();
    if (sh) { const p = sh.nearest(e.x, e.y, e.r); e.x = p.x; e.y = p.y; }
  };

  // Crevasses in the way: where a walker `e` ({ x, y, r }) heading for (tx, ty) should head instead, or
  // null for a clear way. When the straight path crosses a crevasse, aim just past whichever end of it
  // makes the shorter way round. Re-asked every step, so once past the end the walker turns for the goal.
  map.gapSteer = function (e, tx, ty) {
    if (map.layout.route) return map.layout.route(e, tx, ty);
    if (!map.chasms.length) return null;
    const r = e.r || 0;
    let hit = null, hk = Infinity;
    for (const c of map.chasms) {
      // Where the path crosses the crevasse's axis (stretched past each end by the walker's body).
      const ext = c.a + r + 30;
      const ax = c.x - c.ux * ext, ay = c.y - c.uy * ext, bx = c.x + c.ux * ext, by = c.y + c.uy * ext;
      const k = crossAt(e.x, e.y, tx, ty, ax, ay, bx, by);
      if (k !== null && k < hk) { hk = k; hit = c; }
    }
    if (!hit) return null;
    const c = hit, out = c.a + r + 70;
    let best = null, bc = Infinity;
    for (const s of [-1, 1]) {
      const wx = c.x + c.ux * out * s, wy = c.y + c.uy * out * s;
      const cost = G.dist(e.x, e.y, wx, wy) + G.dist(wx, wy, tx, ty);
      if (cost < bc && !(map.layout.shape && !map.layout.shape.inside(wx, wy, r))) { bc = cost; best = { x: wx, y: wy }; }
    }
    return best;
  };
  // Fraction along p->q where it crosses segment a->b, or null if it doesn't.
  function crossAt(px, py, qx, qy, ax, ay, bx, by) {
    const rx = qx - px, ry = qy - py, sx = bx - ax, sy = by - ay;
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((ax - px) * sy - (ay - py) * sx) / den, u = ((ax - px) * ry - (ay - py) * rx) / den;
    return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : null;
  }

  map.use('frosthaven');
})(window.Game);
