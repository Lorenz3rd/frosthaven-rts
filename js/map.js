// Map: a snowfield with ice patches (cosmetic), rocks and dead trees (blocking circles).
(function (G) {
  const map = { w: 7000, h: 3860, rocks: [], trees: [], ice: [] };
  G.map = map;

  // keepClear: [{x, y, r}] areas rocks must not cover (spawn points etc.)
  map.generate = function (seed, keepClear) {
    const rand = G.rng(seed);
    map.rocks = [];
    map.ice = [];

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
      const pts = [];
      const n = 8 + Math.floor(rand() * 4);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const rr = r * (0.85 + rand() * 0.25);
        pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      map.rocks.push({ x, y, r, cr: r * 0.92, pts });
    }

    // Dead trees: solid trunks, generated after rocks so rock layout is unchanged.
    map.trees = [];
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
  };

  // team: whose walker asks, so the gates of its own walls let it through (see bases.js).
  map.blocked = function (x, y, r, team) {
    if (x < r || y < r || x > map.w - r || y > map.h - r) return true;
    return map.hitsRock(x, y, r, team);
  };

  // Everything solid: rocks, trees, plus placed buildings. Each has {x, y, cr}.
  map.solids = () => map.rocks.concat(map.trees, G.buildingSolids ? G.buildingSolids() : []);

  // Rocks and trees never move, so they are bucketed in a grid: collision checks (run for every unit,
  // every step) only look at the few near the point instead of all ~200.
  const CELL = 200;
  let grid = null, gridCols = 0, gridRows = 0, maxCr = 0, gridFor = null;
  function buildGrid() {
    gridCols = Math.ceil(map.w / CELL); gridRows = Math.ceil(map.h / CELL);
    grid = Array.from({ length: gridCols * gridRows }, () => []);
    maxCr = 0;
    for (const k of map.rocks.concat(map.trees)) {
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

  // Wall posts: a gate post stops everyone but its own side. overWalls: shots fly over walls entirely.
  const passes = (k, team, overWalls) => k.wall && (overWalls || (k.gate && k.team === team));
  map.hitsRock = (x, y, r, team, overWalls) => solidsNear(x, y, r).some(k => !passes(k, team, overWalls) && G.dist(x, y, k.x, k.y) < r + k.cr);

  // Push a circle entity out of rocks/buildings and keep it on the map.
  map.resolve = function (e) {
    for (const k of solidsNear(e.x, e.y, e.r)) {
      if (passes(k, e.team)) continue;
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
  };

})(window.Game);
