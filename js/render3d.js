// Renderer: builds a Three.js scene from the 2D simulation and keeps it in sync each frame.
// World (x, y) maps to (x, height, y). A 2D overlay canvas draws HP bars, damage text and snowfall.
(function (G) {
  const R = {};
  G.render3d = R;

  let renderer, scene, moon, overlay, octx;
  const meshes = new Map();          // sim object (entity / slot / projectile) -> Object3D
  const baseViews = [];              // per-base { ring, banner, fire, light, slots: [{slot, mesh}] }
  const projLights = [];
  let heroLight, foeLight, particles, moveRing, targetRing, demolishRing;
  const debris = [];                 // chunks of demolished buildings, falling and fading out
  const snow = [];
  let viewW = 800, viewH = 600;      // full canvas size (CSS pixels)
  let lastT = performance.now(), time = 0;

  const TEAM_HEX = { [G.TEAM.PLAYER]: 0x2f5f96, [G.TEAM.ENEMY]: 0x8c1f18 };
  const NEUTRAL_HEX = 0x4a4741;
  const MAX_PARTICLES = 3000;
  const LIGHT_POOL = 6;              // real point lights shared by every virtual light (G.kit.light); each costs every lit pixel
  const lightPool = [];

  // ---------- helpers ----------
  const smooth = (a, b, x) => { const t = G.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  function canvasTex(size, draw, repeat) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }

  function makeNoise(rand) {
    const N = 256, p = new Float32Array(N * N);
    for (let i = 0; i < p.length; i++) p[i] = rand();
    const v = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const at = (i, j) => p[(j & 255) * N + (i & 255)];
      const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
      const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
      return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
    };
    return (x, y) => v(x, y) * 0.55 + v(x * 2.3, y * 2.3) * 0.3 + v(x * 5.1, y * 5.1) * 0.15;
  }

  const { mat, shadowed, merge } = G.kit;
  const glowSprite = G.kit.glow;

  // Model registries. Race files (js/models/*.js) add their buildings, units and shots; heroes3d.js adds
  // heroes and summons; fx3d.js adds effects and projectile styles.
  R.RACE_MODELS = {};      // race id -> { buildings: { type: fn(slot, base, team) }, unit(team, kind, ranged), shot(s) }
  R.HERO_MODELS = {};      // hero id -> fn(team) -> Group with userData.animate(u, e, time, dt)
  R.SUMMON_MODELS = {};    // squad kind -> fn(team) -> Group (soldier contract)
  R.FX = {};               // fx kind -> { make(o), update(m, o, time, dt) }
  R.PROJ = {};             // projectile style -> fn(p) -> Object3D

  // ---------- init ----------
  R.init = function (canvas) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    // Above 1.5x the extra pixels cost far more GPU time than they add sharpness (antialias is on).
    baseRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(baseRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07090c);
    scene.fog = new THREE.Fog(0x07090c, 2000, 5000);
    // Batches fill once per frame (split screen renders twice), after the renderer's matrix update.
    scene.onBeforeRender = () => { if (batchedFrame !== frameNo) { batchedFrame = frameNo; batchModels(); } };

    G.camera.init();

    overlay = document.getElementById('overlay');
    octx = overlay.getContext('2d');

    // Cold moonlight + dim sky bounce. Warm light comes only from fires.
    scene.add(new THREE.HemisphereLight(0x55657e, 0x1a1410, 0.55));
    moon = new THREE.DirectionalLight(0x9db0d6, 0.75);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    Object.assign(moon.shadow.camera, { left: -2000, right: 2000, top: 2000, bottom: -2000, near: 10, far: 6000 });
    moon.shadow.bias = -0.0008;
    scene.add(moon, moon.target);

    const rand = G.rng(4242);
    const noise = makeNoise(rand);
    buildGround(rand, noise);
    buildRiver(rand);
    buildIce();
    buildRocks();
    buildTrees(rand);
    buildBases(rand);

    heroLight = new THREE.PointLight(0x7fcfff, 1.6, 420, 2);
    scene.add(heroLight);
    // The CPU hero (single player) carries its own glow.
    foeLight = new THREE.PointLight(0x7fcfff, 0, 420, 2);
    scene.add(foeLight);
    for (let i = 0; i < 4; i++) {
      const l = G.kit.light(0x8fd8ff, 0, 380, 2);
      projLights.push(l); scene.add(l);
    }
    // The real lights that braziers, crystals, projectiles and effects take turns using (see syncLights).
    for (let i = 0; i < LIGHT_POOL; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 1, 2);
      lightPool.push(l); scene.add(l);
    }

    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
    pg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
    particles = new THREE.Points(pg, new THREE.PointsMaterial({
      size: 14, map: G.kit.glowTex(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    particles.frustumCulled = false;
    scene.add(particles);

    moveRing = new THREE.Mesh(new THREE.RingGeometry(10, 15, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x9adf6a, transparent: true, depthWrite: false }));
    scene.add(moveRing);

    // Red circle under the hero's current attack target (enemy unit or building).
    targetRing = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff4a34, transparent: true, depthWrite: false }));
    // Faint fill inside the ring so the target reads at a glance.
    targetRing.add(new THREE.Mesh(new THREE.CircleGeometry(0.8, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff4a34, transparent: true, opacity: 0.18, depthWrite: false })));
    targetRing.visible = false;
    scene.add(targetRing);

    // Gold circle under the friendly building the hero is about to demolish.
    demolishRing = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xe0b050, transparent: true, depthWrite: false }));
    demolishRing.visible = false;
    scene.add(demolishRing);

    // Film grain for the CSS overlay.
    const grain = document.getElementById('grain');
    if (grain) {
      const c = document.createElement('canvas'); c.width = c.height = 160;
      const g = c.getContext('2d'), img = g.createImageData(160, 160);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 26;
      }
      g.putImageData(img, 0, 0);
      grain.style.backgroundImage = `url(${c.toDataURL()})`;
    }
  };

  R.resize = function (w, h) {
    viewW = w; viewH = h;
    renderer.setSize(w, h, false);
    const dpr = window.devicePixelRatio || 1;
    overlay.width = Math.floor(w * dpr); overlay.height = Math.floor(h * dpr);
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    snow.length = 0;
    const n = Math.floor(w * h / 7000);
    for (let i = 0; i < n; i++)
      snow.push({ x: Math.random() * w, y: Math.random() * h, s: 0.6 + Math.random() * 2, v: 40 + Math.random() * 90, ph: Math.random() * 6.28 });
  };

  // ---------- world building ----------
  function buildGround(rand, noise) {
    const m = G.map, PAD = 2600;
    const W = m.w + PAD * 2, H = m.h + PAD * 2;
    const geo = new THREE.PlaneGeometry(W, H, Math.round(W / 45), Math.round(H / 45)).rotateX(-Math.PI / 2);
    geo.translate(m.w / 2, 0, m.h / 2);
    const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3);
    const snowC = [0.66, 0.7, 0.76], mudC = [0.2, 0.16, 0.13], frozenC = [0.24, 0.29, 0.34];
    const mid = m.w / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getZ(i);
      let mud = smooth(0.52, 0.78, noise(x / 700, y / 700)) * 0.75;
      for (const b of G.bases) {
        const d = G.dist(x, y, b.x, b.y);
        if (d < b.r + 160) mud = Math.max(mud, 0.82 * (1 - smooth(b.r - 120, b.r + 140, d)) * (0.75 + 0.25 * noise(x / 90, y / 90)));
      }
      const bank = 1 - smooth(55, 260, Math.abs(x - mid));
      const fine = 0.82 + 0.3 * noise(x / 60 + 50, y / 60);
      let c = [0, 1, 2].map(k => G.lerp(G.lerp(snowC[k], mudC[k], mud), frozenC[k], bank * 0.7) * fine);
      // Outside the playable map, fade into black wasteland.
      const out = Math.max(0, -x, x - m.w, -y, y - m.h);
      const dark = 1 - 0.9 * smooth(0, 700, out);
      cols.set(c.map(v => v * dark), i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));

    const tex = canvasTex(512, (g, s) => {
      g.fillStyle = '#b9bec4'; g.fillRect(0, 0, s, s);
      const tiled = fn => { for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) fn(ox, oy); };
      for (let i = 0; i < 500; i++) {
        const x = rand() * s, y = rand() * s, r = 6 + rand() * 46, dark = rand() < 0.55;
        tiled((ox, oy) => {
          const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
          grd.addColorStop(0, dark ? 'rgba(30,26,22,0.22)' : 'rgba(255,255,255,0.18)');
          grd.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = grd; g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
        });
      }
      for (let i = 0; i < 2600; i++) {   // grit, gravel, frozen dirt
        g.fillStyle = rand() < 0.7 ? `rgba(20,18,16,${0.15 + rand() * 0.35})` : `rgba(255,255,255,${0.2 + rand() * 0.4})`;
        g.fillRect(rand() * s, rand() * s, 1 + rand() * 2.5, 1 + rand() * 2.5);
      }
      g.strokeStyle = 'rgba(25,22,20,0.25)';  // dead grass stalks
      for (let i = 0; i < 220; i++) {
        const x = rand() * s, y = rand() * s;
        g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 8, y - 4 - rand() * 8); g.stroke();
      }
    }, true);
    tex.repeat.set(W / 420, H / 420);

    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 1 }));
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  function buildRiver(rand) {
    const m = G.map;
    const tex = canvasTex(256, (g, s) => {
      g.fillStyle = '#5f7486'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 40; i++) {
        g.strokeStyle = `rgba(${rand() < 0.5 ? '230,240,250' : '10,15,22'},${0.25 + rand() * 0.4})`;
        g.lineWidth = 0.5 + rand() * 1.5;
        let x = rand() * s, y = rand() * s;
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 6; k++) { x += (rand() - 0.5) * 50; y += (rand() - 0.5) * 50; g.lineTo(x, y); }
        g.stroke();
      }
    }, true);
    tex.repeat.set(1, m.h / 240);
    const river = new THREE.Mesh(new THREE.PlaneGeometry(130, m.h + 3000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: tex, color: 0x95aabd, roughness: 0.15, metalness: 0.4 }));
    river.position.set(m.w / 2, 1.2, m.h / 2);
    river.receiveShadow = true;
    scene.add(river);
  }

  function buildIce() {
    const iceMat = new THREE.MeshStandardMaterial({ color: 0x7d93a8, roughness: 0.1, metalness: 0.35, transparent: true, opacity: 0.4 });
    G.map.ice.forEach((p, i) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2), iceMat);
      m.scale.set(p.rx, 1, p.ry);
      m.rotation.y = p.rot;
      m.position.set(p.x, 0.3 + i * 0.012, p.y);
      m.receiveShadow = true;
      scene.add(m);
    });
  }

  function buildRocks() {
    const hash = (x, y, z) => { const s = Math.sin(x * 12.99 + y * 78.23 + z * 37.72) * 43758.55; return s - Math.floor(s); };
    const rockMat = mat(0xffffff, { vertexColors: true });
    const rocks = new THREE.Group();
    for (const k of G.map.rocks) {
      const geo = new THREE.IcosahedronGeometry(k.r, 1);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const j = 0.78 + 0.4 * hash(Math.round(x + k.x), Math.round(y), Math.round(z + k.y));
        pos.setXYZ(i, x * j, y * j * 0.75, z * j);
      }
      geo.computeVertexNormals();
      const nor = geo.attributes.normal, cols = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i += 3) {   // per face: snow on top, dark stone on the sides
        const ny = (nor.getY(i) + nor.getY(i + 1) + nor.getY(i + 2)) / 3;
        const v = 0.85 + 0.3 * hash(i, k.x, k.y);
        const c = ny > 0.62 ? [0.62 * v, 0.66 * v, 0.72 * v] : [0.13 * v, 0.13 * v, 0.14 * v];
        for (let q = 0; q < 3; q++) cols.set(c, (i + q) * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      const mesh = shadowed(new THREE.Mesh(geo, rockMat));
      mesh.position.set(k.x, k.r * 0.12, k.y);
      mesh.rotation.y = hash(k.x, k.y, 1) * 6.28;
      rocks.add(mesh);
    }
    scene.add(G.kit.mergeStatic(rocks, new Set()));  // one draw call for every rock
  }

  function treeGeometry(rand) {
    const h = 1, parts = [];
    parts.push(new THREE.CylinderGeometry(0.02, 0.06, h, 6).translate(0, h / 2, 0));
    const branches = 4 + Math.floor(rand() * 4);
    for (let i = 0; i < branches; i++) {
      const len = 0.25 + rand() * 0.3;
      const g = new THREE.CylinderGeometry(0.006, 0.022, len, 5).translate(0, len / 2, 0);
      g.rotateZ(0.5 + rand() * 0.7).rotateY(rand() * Math.PI * 2).translate(0, h * (0.35 + rand() * 0.55), 0);
      parts.push(g);
      if (rand() < 0.6) {   // a twig off the branch tip
        const t = new THREE.CylinderGeometry(0.004, 0.01, len * 0.5, 4).translate(0, len * 0.25, 0);
        t.rotateZ(-0.6 + rand() * 1.2).rotateY(rand() * 6.28).translate(0, h * (0.5 + rand() * 0.45), 0);
        parts.push(t);
      }
    }
    return merge(parts);
  }

  function buildTrees(rand) {
    const variants = [0, 1, 2, 3].map(() => treeGeometry(rand));
    const bark = mat(0x1c1712);
    const trees = new THREE.Group();
    for (const t of G.map.trees) {
      const m = shadowed(new THREE.Mesh(variants[t.variant], bark));
      m.scale.set(t.h * 0.9, t.h, t.h * 0.9);
      m.rotation.y = t.rot;
      m.position.set(t.x, 0, t.y);
      trees.add(m);
    }
    scene.add(G.kit.mergeStatic(trees, new Set()));  // one draw call for every tree
  }

  function buildBases(rand) {
    const stake = merge([
      new THREE.CylinderGeometry(5, 6.5, 0.82, 6).translate(0, 0.41, 0),
      new THREE.ConeGeometry(5, 0.18, 6).translate(0, 0.91, 0)
    ]);  // unit height; each instance is scaled to its own height
    const stakeSpots = [];
    for (const b of G.bases) {
      const steps = Math.floor((2 * Math.PI * b.r) / 30);
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const gate = [0, Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI * 2].some(g => Math.abs(a - g) < 0.13);
        if (gate) continue;
        stakeSpots.push({ x: b.x + Math.cos(a) * (b.r + (rand() - 0.5) * 8), y: b.y + Math.sin(a) * (b.r + (rand() - 0.5) * 8), h: 55 + rand() * 30 });
      }
    }
    const stakes = new THREE.InstancedMesh(stake, mat(0x2e241b), stakeSpots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    stakeSpots.forEach((s, i) => {
      e.set((rand() - 0.5) * 0.15, rand() * 6, (rand() - 0.5) * 0.15);
      m4.compose(new THREE.Vector3(s.x, 0, s.y), q.setFromEuler(e), new THREE.Vector3(1, s.h, 1));
      stakes.setMatrixAt(i, m4);
    });
    stakes.castShadow = stakes.receiveShadow = true;
    scene.add(stakes);

    const stone = mat(0x2b2b2d);
    for (const b of G.bases) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(b.r - 14, b.r - 4, 128).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: NEUTRAL_HEX, transparent: true, opacity: 0.55, depthWrite: false }));
      ring.position.set(b.x, 1.5, b.y);
      scene.add(ring);

      // Center: stone brazier with a fire, and a war banner.
      const center = new THREE.Group();
      center.position.set(b.x, 0, b.y);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(34, 24, 30, 8), stone);
      bowl.position.y = 15;
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(48, 54, 10, 8), stone);
      plinth.position.y = 5;
      const coals = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 2, 8), new THREE.MeshBasicMaterial({ color: 0xff5a1a }));
      coals.position.y = 30;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, 230, 6), mat(0x241a12));
      pole.position.set(-70, 115, -30);
      const bannerMat = mat(NEUTRAL_HEX, { side: THREE.DoubleSide, flatShading: false });
      const bannerGeo = new THREE.PlaneGeometry(70, 110, 6, 6);
      const banner = new THREE.Mesh(bannerGeo, bannerMat);
      banner.position.set(-70 + 36, 165, -30);
      center.add(shadowed(bowl), shadowed(plinth), coals, shadowed(pole), shadowed(banner));
      const fire = glowSprite(0xff7a2a, 120);
      fire.position.y = 55;
      const fireCore = glowSprite(0xffd28a, 50);
      fireCore.position.y = 42;
      center.add(fire, fireCore);
      const light = G.kit.light(0xff7a30, 2.2, 900, 2);
      light.position.y = 70;
      center.add(light);
      center.visible = !b.core;  // the Command Center takes the brazier's place
      scene.add(center);

      const slots = b.slots.map(slot => {
        const sm = new THREE.Mesh(new THREE.RingGeometry(G.SLOT_R - 8, G.SLOT_R, 48).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false }));
        sm.position.set(slot.x, 2, slot.y);
        sm.visible = !slot.core;
        scene.add(sm);
        return { slot, mesh: sm };
      });
      // Storm field: a hazy dome over the whole base, shown only while a Storm Tower stands there.
      const field = new THREE.Mesh(new THREE.SphereGeometry(b.r, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1),
        new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }));
      field.position.set(b.x, 0, b.y);
      field.visible = false;
      scene.add(field);

      baseViews.push({ base: b, ring, bannerMat, bannerGeo, bannerBase: bannerGeo.attributes.position.array.slice(), fire, fireCore, light, slots, field, phase: rand() * 10 });
    }
  }

  // ---------- models ----------
  function makeHut(slot, base, team) {
    const g = new THREE.Group();
    const wood = mat(0x3a2a1d), dark = mat(0x16100b), stoneM = mat(0x2f2f31);
    const found = new THREE.Mesh(new THREE.BoxGeometry(150, 14, 120), stoneM); found.position.y = 7;
    const walls = new THREE.Mesh(new THREE.BoxGeometry(136, 70, 106), wood); walls.position.y = 49;
    // Roof: a 4-sided pyramid, thatch underneath, a crust of dirty snow on top.
    const roof = new THREE.Mesh(new THREE.ConeGeometry(118, 80, 4), mat(0x3b3226)); roof.rotation.y = Math.PI / 4; roof.scale.z = 0.82; roof.position.y = 124;
    const snowCap = new THREE.Mesh(new THREE.ConeGeometry(84, 58, 4), mat(0x7f8790)); snowCap.rotation.y = Math.PI / 4; snowCap.scale.z = 0.82; snowCap.position.y = 141;
    const door = new THREE.Mesh(new THREE.BoxGeometry(4, 46, 30), dark); door.position.set(69, 37, 0);
    const winMat = new THREE.MeshBasicMaterial({ color: 0xffa040 });
    const win1 = new THREE.Mesh(new THREE.BoxGeometry(4, 16, 16), winMat); win1.position.set(69, 52, 34);
    const win2 = win1.clone(); win2.position.z = -34;
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(20, 60, 20), stoneM); chimney.position.set(-30, 140, 26);
    const glow = glowSprite(0xff8a30, 60, 0.6); glow.position.set(76, 52, 34);
    const glow2 = glow.clone(); glow2.position.z = -34;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(34, 22), mat(TEAM_HEX[team], { side: THREE.DoubleSide }));
    flag.position.set(-30, 190, 26 + 18);
    const fpole = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 50, 4), dark); fpole.position.set(-30, 185, 26);
    g.add(shadowed(found), shadowed(walls), shadowed(roof), shadowed(snowCap), door, win1, win2, shadowed(chimney), glow, glow2, flag, fpole);
    g.position.set(slot.x, 0, slot.y);
    g.rotation.y = -Math.atan2(base.y - slot.y, base.x - slot.x);  // door faces the base center
    g.scale.setScalar(0.95);
    return g;
  }

  function teamFlag(team, x, y, z) {
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(34, 22), mat(TEAM_HEX[team], { side: THREE.DoubleSide }));
    flag.position.set(x, y + 5, z + 18);
    const fpole = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 50, 4), mat(0x16100b)); fpole.position.set(x, y, z);
    return [flag, fpole];
  }

  // Faces the base center, like the hut.
  function placeInSlot(g, slot, base) {
    g.position.set(slot.x, 0, slot.y);
    g.rotation.y = -Math.atan2(base.y - slot.y, base.x - slot.x);
    g.scale.setScalar(0.95);
    return g;
  }

  // Dig-in: a ramshackle ring of stakes and sandbags with a few archers peeking over.
  function makeDigin(slot, base, team) {
    const g = new THREE.Group();
    const wood = mat(0x3a2a1d), dark = mat(0x16100b), sack = mat(0x6b5f4a), snowM = mat(0x7f8790);
    const parts = [];
    const pit = new THREE.Mesh(new THREE.CylinderGeometry(70, 76, 8, 10), mat(0x2a2620)); pit.position.y = 4;
    parts.push(pit);
    for (let i = 0; i < 14; i++) {        // leaning, uneven stakes
      const a = (i / 14) * Math.PI * 2, h = 34 + ((i * 37) % 17);
      const stake = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, h, 5), i % 3 ? wood : dark);
      stake.position.set(Math.cos(a) * 66, h / 2, Math.sin(a) * 66);
      stake.rotation.set(Math.sin(i * 2.1) * 0.2, 0, Math.cos(i * 1.7) * 0.25);
      parts.push(stake);
    }
    for (let i = 0; i < 9; i++) {          // sandbag wall, front half
      const a = -Math.PI / 2 + (i / 8) * Math.PI;
      const bag = new THREE.Mesh(new THREE.BoxGeometry(18, 12, 30), sack);
      bag.position.set(Math.cos(a) * 54, 8 + (i % 2) * 10, Math.sin(a) * 54); bag.rotation.y = -a;
      parts.push(bag);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(60, 4, 70), wood); roof.position.set(-30, 52, 0); roof.rotation.z = 0.25;
    const roofSnow = new THREE.Mesh(new THREE.BoxGeometry(58, 3, 68), snowM); roofSnow.position.set(-30, 55, 0); roofSnow.rotation.z = 0.25;
    const posts = [-30, 30].map(z => { const m = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 50, 5), dark); m.position.set(-50, 25, z); return m; });
    parts.push(roof, roofSnow, ...posts);
    const teamM = mat(TEAM_HEX[team]), skin = mat(0x8a6a52);
    for (const [x, z] of [[20, -26], [30, 8], [8, 34]]) {   // archers
      const body = new THREE.Mesh(new THREE.CylinderGeometry(6, 8, 22, 6), teamM); body.position.set(x, 22, z);
      const head = new THREE.Mesh(new THREE.SphereGeometry(6, 6, 5), skin); head.position.set(x, 38, z);
      const bow = new THREE.Mesh(new THREE.TorusGeometry(10, 1, 4, 8, Math.PI), wood); bow.position.set(x + 9, 30, z); bow.rotation.set(0, Math.PI / 2, Math.PI / 2);
      parts.push(body, head, bow);
    }
    const glow = glowSprite(0xff8a30, 60, 0.45); glow.position.set(-30, 20, 0);
    g.add(...parts.map(shadowed), glow, ...teamFlag(team, -50, 75, -30));
    return placeInSlot(g, slot, base);
  }

  // Support tower: tall timber watchtower on splayed legs with a heavy crossbow on top.
  function makeSupport(slot, base, team) {
    const g = new THREE.Group();
    const wood = mat(0x3a2a1d), dark = mat(0x16100b), snowM = mat(0x7f8790);
    const parts = [];
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [x, z] of corners) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(5, 7, 220, 6), wood);
      leg.position.set(x * 36, 110, z * 36); leg.rotation.set(z * 0.1, 0, -x * 0.1);
      parts.push(leg);
    }
    for (const y of [60, 130]) {           // cross bracing
      for (const r of [Math.PI / 4, -Math.PI / 4]) {
        const brace = new THREE.Mesh(new THREE.BoxGeometry(116 - y * 0.2, 5, 5), dark);
        brace.position.y = y; brace.rotation.y = r;
        parts.push(brace);
      }
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(92, 8, 92), wood); deck.position.y = 210;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(92, 22, 92), wood); rail.position.y = 225;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(72, 50, 4), mat(0x3b3226)); roof.position.y = 290; roof.rotation.y = Math.PI / 4;
    const snowCap = new THREE.Mesh(new THREE.ConeGeometry(48, 30, 4), snowM); snowCap.position.y = 304; snowCap.rotation.y = Math.PI / 4;
    const posts = corners.map(([x, z]) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 50, 5), dark); m.position.set(x * 40, 250, z * 40); return m; });
    parts.push(deck, rail, roof, snowCap, ...posts);
    // Turret: a heavy crossbow that swings toward its target.
    const turret = new THREE.Group(); turret.position.y = 240;
    const stock = new THREE.Mesh(new THREE.BoxGeometry(56, 6, 8), wood); stock.position.x = 30;
    const prod = new THREE.Mesh(new THREE.BoxGeometry(5, 4, 54), dark); prod.position.x = 52;
    turret.add(stock, prod);
    const fire = glowSprite(0xff8a30, 50, 0.5); fire.position.y = 245;
    g.add(...parts.map(shadowed), shadowed(turret), fire, ...teamFlag(team, -40, 320, 0));
    g.userData.turret = turret;
    return placeInSlot(g, slot, base);
  }

  // Siege: a catapult on a wheeled frame. The frame turns to aim; the arm throws when it fires.
  function makeSiege(slot, base, team) {
    const g = new THREE.Group();
    const wood = mat(0x3a2a1d), dark = mat(0x16100b), stoneM = mat(0x55555c);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(78, 84, 6, 10), mat(0x2a2620)); pad.position.y = 3;
    const turret = new THREE.Group();
    const parts = [];
    for (const z of [-26, 26]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(120, 10, 10), wood); rail.position.set(0, 22, z);
      const upA = new THREE.Mesh(new THREE.BoxGeometry(8, 60, 8), wood); upA.position.set(-6, 52, z); upA.rotation.z = 0.35;
      const upB = new THREE.Mesh(new THREE.BoxGeometry(8, 60, 8), wood); upB.position.set(16, 52, z); upB.rotation.z = -0.35;
      parts.push(rail, upA, upB);
      for (const x of [-40, 40]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 6, 10).rotateX(Math.PI / 2), dark);
        wheel.position.set(x, 16, z + Math.sign(z) * 8); parts.push(wheel);
      }
    }
    const cross = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 64), wood); cross.position.set(-40, 22, 0);
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 60, 6).rotateX(Math.PI / 2), dark); axle.position.set(5, 78, 0);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(26, 26, 30), stoneM); counter.position.set(26, 50, 0);
    parts.push(cross, axle, counter);
    // Arm pivots at the axle: at rest the cup lies at the back, firing whips it up and over the front.
    const arm = new THREE.Group(); arm.position.set(5, 78, 0);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(110, 6, 6), wood); beam.position.x = -45;
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(10, 6, 8, 8), dark); cup.position.set(-98, 6, 0);
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(8, 0), stoneM); rock.position.set(-98, 14, 0);
    arm.add(beam, cup, rock);
    turret.add(...parts.map(shadowed), shadowed(arm));
    g.add(shadowed(pad), turret, ...teamFlag(team, -60, 75, -60));
    g.userData.turret = turret; g.userData.arm = arm; g.userData.rock = rock;
    return placeInSlot(g, slot, base);
  }

  // Human barracks: one longhouse, dressed for the troops it trains.
  function makeBarracks(slot, base, team, variant) {
    const g = new THREE.Group();
    const wood = mat(0x3a2a1d), dark = mat(0x16100b), stoneM = mat(0x2f2f31);
    const found = new THREE.Mesh(new THREE.BoxGeometry(130, 14, 180), stoneM); found.position.y = 7;
    const walls = new THREE.Mesh(new THREE.BoxGeometry(116, 64, 166), wood); walls.position.y = 46;
    // Long gabled roof: a triangular prism with its ridge running along the building.
    // rotateX(-90deg) turns the cylinder's axis along the building and points one edge straight up.
    const prism = new THREE.Mesh(new THREE.CylinderGeometry(76, 76, 186, 3).rotateX(-Math.PI / 2), mat(0x3b3226));
    prism.position.y = 78 + 38;            // triangle base sits on the walls (y = 78)
    const snow = new THREE.Mesh(new THREE.CylinderGeometry(44, 44, 176, 3).rotateX(-Math.PI / 2), mat(0x7f8790));
    snow.position.y = 116 + 76 - 44 + 2;   // apex just above the roof's apex
    const door = new THREE.Mesh(new THREE.BoxGeometry(4, 50, 44), dark); door.position.set(59, 39, 0);
    const shieldMat = mat(TEAM_HEX[team]);
    const shields = [-55, 55].map(z => {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 3, 10).rotateZ(Math.PI / 2), shieldMat);
      s.position.set(60, 50, z); return s;
    });
    const glow = glowSprite(0xff8a30, 70, 0.5); glow.position.set(66, 40, 0);
    g.add(shadowed(found), shadowed(walls), shadowed(prism), shadowed(snow), door, ...shields, glow, ...teamFlag(team, -40, 205, 0));
    const K = G.kit, steel = K.metal(0x8a8f96);
    if (variant === 'armored') {
      // Iron-banded walls, a forge chimney and a rack of plate armor on stands.
      for (const z of [-60, 0, 60]) K.add(g, K.g.box(120, 6, 4), steel, 0, 60, z + 1);
      K.add(g, K.g.box(26, 120, 26), mat(0x2f2f31), -40, 110, 60);
      K.addGlow(g, 0xff7a2a, 50, -40, 175, 60, 0.7);
      for (const z of [-30, 30]) {
        K.add(g, K.g.cyl(2, 2, 40, 4), dark, 78, 20, z);
        K.add(g, K.g.cyl(9, 11, 18, 6), steel, 78, 40, z);
        K.add(g, K.g.sph(6, 6, 5), steel, 78, 54, z);
      }
    } else if (variant === 'short') {
      // Javelin racks and a straw target out front.
      for (const z of [-50, 50]) {
        K.add(g, K.g.box(6, 30, 30), wood, 74, 15, z);
        for (let i = 0; i < 5; i++) K.add(g, K.g.cyl(1.2, 1.2, 46, 4), mat(0x8a7a62), 76, 30, z - 12 + i * 6, { rz: 0.2 });
      }
      K.add(g, K.g.cyl(14, 14, 6, 10), mat(0xc9b070), 110, 30, 0, { rz: Math.PI / 2 });
      K.add(g, K.g.cyl(6, 6, 6.5, 10), mat(0xa02a20), 110, 30, 0, { rz: Math.PI / 2 });
      K.add(g, K.g.cyl(1.5, 1.5, 30, 4), dark, 110, 12, 0);
    } else if (variant === 'long') {
      // A tall lookout on the roof and archery butts along the side.
      K.add(g, K.g.box(30, 40, 30), wood, -20, 190, 0);
      K.add(g, K.g.cone(26, 30, 4), mat(0x3b3226), -20, 225, 0, { ry: Math.PI / 4 });
      for (const x of [-40, 0, 40]) {
        K.add(g, K.g.cyl(12, 12, 8, 10), mat(0xd8c890), x, 22, 100, { rx: Math.PI / 2 });
        K.add(g, K.g.cyl(5, 5, 8.5, 10), mat(0x2f5f96), x, 22, 100, { rx: Math.PI / 2 });
      }
    } else {
      // Footmen: a weapon rack of spears and round shields by the door.
      for (let i = 0; i < 4; i++) K.add(g, K.g.cyl(1.4, 1.4, 60, 4), mat(0x5a4330), 72, 30, -30 + i * 20, { rz: 0.15 });
      for (const z of [-20, 20]) K.add(g, K.g.cyl(10, 10, 3, 10), mat(TEAM_HEX[team]), 76, 18, z, { rz: Math.PI / 2 });
    }
    return placeInSlot(g, slot, base);
  }

  // ---- Ally buildings: smaller than a barracks, each dressed for the specialist it trains. ----

  // Engineer Lodge: a timber workshop with an open lean-to, an anvil, a lumber stack and a hoist.
  function makeEngineerLodge(slot, base, team) {
    const g = new THREE.Group();
    const wood = mat(0x3a2a1d), dark = mat(0x16100b), stoneM = mat(0x2f2f31), plank = mat(0x5a4330);
    const steel = mat(0x55595f, { metalness: 0.6, roughness: 0.45 });
    const found = new THREE.Mesh(new THREE.BoxGeometry(110, 10, 100), stoneM); found.position.y = 5;
    const walls = new THREE.Mesh(new THREE.BoxGeometry(60, 52, 86), wood); walls.position.set(-20, 36, 0);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(48, 48, 92, 3).rotateX(-Math.PI / 2), mat(0x3b3226)); roof.position.set(-20, 62 + 24, 0);
    const snow = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, 86, 3).rotateX(-Math.PI / 2), mat(0x7f8790)); snow.position.set(-20, 112 - 26 + 2, 0);
    // Lean-to roof over the work area out front, on two posts.
    const lean = new THREE.Mesh(new THREE.BoxGeometry(46, 4, 86), plank); lean.position.set(26, 54, 0); lean.rotation.z = -0.25;
    const posts = [-36, 36].map(z => { const m = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 48, 5), wood); m.position.set(46, 28, z); return m; });
    const anvil = new THREE.Mesh(new THREE.BoxGeometry(18, 10, 10), steel); anvil.position.set(24, 22, 14);
    const anvilBase = new THREE.Mesh(new THREE.BoxGeometry(10, 12, 8), dark); anvilBase.position.set(24, 11, 14);
    const logs = [0, 1, 2].map(i => { const m = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 40, 6).rotateX(Math.PI / 2), plank); m.position.set(26 + (i % 2) * 6, 15 + i * 8, -22); return m; });
    // Gear sign over the door.
    const gear = new THREE.Mesh(new THREE.TorusGeometry(9, 3, 4, 8), mat(0xd9a530, { metalness: 0.5 })); gear.rotation.y = Math.PI / 2; gear.position.set(11, 52, 0);
    const forge = glowSprite(0xff8a30, 46, 0.6); forge.position.set(14, 22, 30);
    g.add(shadowed(found), shadowed(walls), shadowed(roof), shadowed(snow), shadowed(lean), ...posts.map(shadowed),
      shadowed(anvil), shadowed(anvilBase), ...logs.map(shadowed), gear, forge, ...teamFlag(team, -40, 140, 30));
    return placeInSlot(g, slot, base);
  }

  // Medic Tent: a pale canvas tent with a red cross on the flap and a lantern by the entrance.
  function makeMedicTent(slot, base, team) {
    const g = new THREE.Group();
    const canvas = mat(0xd8d2c4), dark = mat(0x16100b), red = new THREE.MeshBasicMaterial({ color: 0xc8202a });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(110, 4, 96), mat(0x4a3e30)); floor.position.y = 2;
    const tent = new THREE.Mesh(new THREE.CylinderGeometry(58, 58, 104, 3).rotateX(-Math.PI / 2).rotateZ(0), canvas);
    tent.rotation.y = Math.PI / 2; tent.position.y = 29;
    const snow = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 98, 3).rotateX(-Math.PI / 2), mat(0x9aa2ab));
    snow.rotation.y = Math.PI / 2; snow.position.y = 87 - 22 + 4;
    const flap = new THREE.Mesh(new THREE.BoxGeometry(2, 40, 34), dark); flap.position.set(52, 20, 0);
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(2, 22, 7), red); c1.position.set(46, 52, 0); c1.rotation.z = -0.52;
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(2, 7, 22), red); c2.position.set(46, 52, 0); c2.rotation.z = -0.52;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 40, 4), dark); pole.position.set(62, 20, 26);
    const lamp = glowSprite(0xffd890, 40, 0.8); lamp.position.set(62, 42, 26);
    const crates = [[-30, 34], [-42, 30]].map(([x, z]) => { const m = new THREE.Mesh(new THREE.BoxGeometry(14, 14, 14), mat(0x6b4a2a)); m.position.set(x, 7, z + 20); return m; });
    g.add(shadowed(floor), shadowed(tent), shadowed(snow), flap, c1, c2, pole, lamp, ...crates.map(shadowed), ...teamFlag(team, -30, 120, -10));
    return placeInSlot(g, slot, base);
  }

  // Officer Quarters: a small stone keep with a crenellated top and a gold-trimmed war banner.
  function makeOfficerQuarters(slot, base, team) {
    const g = new THREE.Group();
    const stoneM = mat(0x3a3a3e), dark = mat(0x16100b), gold = mat(0xd9a530, { metalness: 0.5, roughness: 0.4 });
    const found = new THREE.Mesh(new THREE.BoxGeometry(100, 12, 100), mat(0x2f2f31)); found.position.y = 6;
    const keep = new THREE.Mesh(new THREE.BoxGeometry(72, 96, 72), stoneM); keep.position.y = 60;
    const merlons = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12), stoneM);
      const a = (j - 1) * 28;
      const [x, z] = [[a, 32], [a, -32], [32, a], [-32, a]][i];
      m.position.set(x, 114, z); merlons.push(m);
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(4, 40, 26), dark); door.position.set(37, 32, 0);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(76, 4, 76), gold); trim.position.y = 104;
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(24, 52), mat(TEAM_HEX[team], { side: THREE.DoubleSide }));
    banner.rotation.y = Math.PI / 2; banner.position.set(37, 72, 0);
    const bannerTrim = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 28), gold); bannerTrim.position.set(38, 98, 0);
    const win = new THREE.Mesh(new THREE.BoxGeometry(4, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffa040 })); win.position.set(37, 72, 26);
    const glow = glowSprite(0xff8a30, 36, 0.5); glow.position.set(42, 72, 26);
    g.add(shadowed(found), shadowed(keep), ...merlons.map(shadowed), door, shadowed(trim), banner, bannerTrim, win, glow, ...teamFlag(team, 0, 140, 0));
    return placeInSlot(g, slot, base);
  }

  // Demolitionist Workshop: a squat sandbagged bunker with powder kegs and a rack of rockets.
  function makeDemoWorkshop(slot, base, team) {
    const g = new THREE.Group();
    const stoneM = mat(0x2f2f31), dark = mat(0x16100b), sack = mat(0x6b5f4a), keg = mat(0x4a3220), wood = mat(0x3a2a1d);
    const bunker = new THREE.Mesh(new THREE.CylinderGeometry(40, 48, 44, 8), stoneM); bunker.position.y = 22;
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(30, 42, 14, 8), mat(0x3b3226)); roof.position.y = 51;
    const snow = new THREE.Mesh(new THREE.CylinderGeometry(22, 30, 6, 8), mat(0x7f8790)); roof.position.y = 51; snow.position.y = 61;
    const slit = new THREE.Mesh(new THREE.BoxGeometry(4, 8, 34), dark); slit.position.set(44, 32, 0);
    const sacks = [];
    for (let i = 0; i < 7; i++) {
      const a = -0.9 + i * 0.3, m = new THREE.Mesh(new THREE.BoxGeometry(14, 9, 20), sack);
      m.position.set(Math.cos(a) * 58, 5, Math.sin(a) * 58); m.rotation.y = -a; sacks.push(m);
    }
    const kegs = [[-30, -40], [-42, -30], [-36, -36]].map(([x, z], i) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 16, 8), keg); m.position.set(x, i === 2 ? 24 : 8, z); return m;
    });
    // Rocket rack: a tilted frame with three rockets pointed at the sky.
    const rack = new THREE.Group(); rack.position.set(-20, 0, 44); rack.rotation.x = -0.35;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(30, 4, 6), wood); frame.position.y = 18;
    rack.add(frame);
    for (const x of [-10, 0, 10]) {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 30, 6), mat(0x8c3a22)); body.position.set(x, 30, 0);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(3, 8, 6), mat(0x8a8f96, { metalness: 0.6 })); nose.position.set(x, 49, 0);
      rack.add(body, nose);
    }
    const fuse = glowSprite(0xff8a30, 30, 0.7); fuse.position.set(-36, 36, -36);
    g.add(shadowed(bunker), shadowed(roof), shadowed(snow), slit, ...sacks.map(shadowed), ...kegs.map(shadowed), shadowed(rack), fuse,
      ...teamFlag(team, 0, 90, 0));
    return placeInSlot(g, slot, base);
  }

  // Storm Tower: a stone pylon topped with a frost-blue orb and a drifting cloud of haze.
  function makeStorm(slot, base, team) {
    const g = new THREE.Group();
    const stoneM = mat(0x2f2f31), dark = mat(0x16100b);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(50, 56, 8, 8), stoneM); pad.position.y = 4;
    const pylon = new THREE.Mesh(new THREE.CylinderGeometry(16, 26, 190, 8), stoneM); pylon.position.y = 103;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(30, 16, 14, 8), dark); cap.position.y = 200;
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(24, 1), new THREE.MeshBasicMaterial({ color: 0xcff4ff }));
    orb.position.y = 232;
    const halo = glowSprite(0x9fdcff, 150, 0.6); halo.position.y = 232;
    g.add(shadowed(pad), shadowed(pylon), shadowed(cap), orb, halo, ...teamFlag(team, -40, 260, 0));
    return placeInSlot(g, slot, base);
  }

  // Command Center: a walled frost citadel. Stepped stone plinth, a crenellated octagonal curtain wall
  // with four slate-roofed turrets, a great gate flanked by braziers, and a tall keep with gilt trim,
  // team banners and a spire crowned by a glowing frost crystal. Faces the enemy side (+x = gate).
  function makeCommand(slot, base, team) {
    const g = new THREE.Group();
    const stoneM = mat(0x2f2f31), stoneHi = mat(0x45454a), dark = mat(0x16100b);
    const slate = mat(0x23262c), snowM = mat(0x7f8790), gilt = mat(0xb08a4e, { metalness: 0.6, roughness: 0.45 });
    const teamM = mat(TEAM_HEX[team], { side: THREE.DoubleSide });
    const winMat = new THREE.MeshBasicMaterial({ color: 0xffa040 });
    const parts = [], fx = [];
    const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); parts.push(o); return o; };

    // Stepped plinth.
    add(new THREE.CylinderGeometry(150, 160, 14, 8), stoneM, 0, 7, 0).rotation.y = Math.PI / 8;
    add(new THREE.CylinderGeometry(136, 146, 12, 8), stoneHi, 0, 20, 0).rotation.y = Math.PI / 8;

    // Curtain wall with merlons.
    const BASE_Y = 26, WALL_R = 118, WALL_H = 70;
    add(new THREE.CylinderGeometry(WALL_R, WALL_R + 4, WALL_H, 8), stoneM, 0, BASE_Y + WALL_H / 2, 0).rotation.y = Math.PI / 8;
    add(new THREE.CylinderGeometry(WALL_R + 3, WALL_R + 3, 6, 8), gilt, 0, BASE_Y + WALL_H, 0).rotation.y = Math.PI / 8;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      add(new THREE.BoxGeometry(14, 14, 18), stoneHi, Math.cos(a) * (WALL_R - 4), BASE_Y + WALL_H + 10, Math.sin(a) * (WALL_R - 4)).rotation.y = -a;
    }

    // Four corner turrets, each with a team pennant and a lit arrow slit.
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i / 4) * Math.PI * 2, x = Math.cos(a) * 124, z = Math.sin(a) * 124;
      add(new THREE.CylinderGeometry(24, 28, 150, 8), stoneHi, x, BASE_Y + 75, z);
      add(new THREE.CylinderGeometry(29, 29, 6, 8), gilt, x, BASE_Y + 150, z);
      add(new THREE.ConeGeometry(32, 62, 8), slate, x, BASE_Y + 181, z);
      add(new THREE.ConeGeometry(20, 34, 8), snowM, x, BASE_Y + 196, z);
      add(new THREE.CylinderGeometry(1.5, 1.5, 40, 4), dark, x, BASE_Y + 230, z);
      add(new THREE.PlaneGeometry(26, 16), teamM, x, BASE_Y + 242, z + 13);
      add(new THREE.BoxGeometry(5, 18, 10), winMat, x + Math.cos(a) * 26, BASE_Y + 110, z + Math.sin(a) * 26).rotation.y = -a;
    }

    // Great gate on the front, flanked by braziers.
    add(new THREE.BoxGeometry(24, 70, 66), stoneHi, WALL_R + 6, BASE_Y + 35, 0);
    add(new THREE.BoxGeometry(6, 52, 42), dark, WALL_R + 19, BASE_Y + 26, 0);
    add(new THREE.BoxGeometry(8, 8, 70), gilt, WALL_R + 19, BASE_Y + 56, 0);
    for (const z of [-58, 58]) {
      add(new THREE.CylinderGeometry(12, 8, 18, 8), stoneHi, WALL_R + 34, 30, z);
      add(new THREE.CylinderGeometry(4, 5, 24, 6), dark, WALL_R + 34, 12, z);
      const glow = glowSprite(0xff7a2a, 70, 0.9); glow.position.set(WALL_R + 34, 52, z); fx.push(glow);
      const core = glowSprite(0xffd28a, 26); core.position.set(WALL_R + 34, 42, z); fx.push(core);
    }

    // The keep: battlements, gilt band, tall lit windows and a hanging banner on every face.
    add(new THREE.BoxGeometry(120, 170, 120), stoneHi, 0, BASE_Y + 85, 0);
    add(new THREE.BoxGeometry(130, 8, 130), gilt, 0, BASE_Y + 170, 0);
    for (let side = 0; side < 4; side++) {
      const a = side * Math.PI / 2, c = Math.cos(a), sn = Math.sin(a);
      for (const k of [-40, 0, 40])
        add(new THREE.BoxGeometry(16, 16, 16), stoneM, c * 58 - sn * k, BASE_Y + 182, sn * 58 + c * k);
      for (const k of [-30, 30])
        add(new THREE.BoxGeometry(4, 34, 12), winMat, c * 61 - sn * k, BASE_Y + 120, sn * 61 + c * k).rotation.y = -a;
      add(new THREE.PlaneGeometry(30, 70), teamM, c * 62, BASE_Y + 62, sn * 62).rotation.y = Math.PI / 2 - a;
      add(new THREE.BoxGeometry(4, 4, 38), gilt, c * 63, BASE_Y + 98, sn * 63).rotation.y = -a;
    }
    add(new THREE.ConeGeometry(100, 90, 4), slate, 0, BASE_Y + 218, 0).rotation.y = Math.PI / 4;
    add(new THREE.ConeGeometry(70, 64, 4), snowM, 0, BASE_Y + 232, 0).rotation.y = Math.PI / 4;

    // Spire crowned by a slowly turning frost crystal (animated in aimTower), and a great flag.
    add(new THREE.CylinderGeometry(18, 26, 130, 8), stoneHi, 0, BASE_Y + 270, 0);
    add(new THREE.CylinderGeometry(28, 28, 8, 8), gilt, 0, BASE_Y + 335, 0);
    add(new THREE.ConeGeometry(30, 50, 8), slate, 0, BASE_Y + 364, 0);
    add(new THREE.CylinderGeometry(2, 2, 90, 4), dark, -40, BASE_Y + 300, -40);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(60, 36), teamM); flag.position.set(-40, BASE_Y + 325, -10);
    flag.rotation.y = Math.PI / 2;
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(26, 0), new THREE.MeshBasicMaterial({ color: 0xcff4ff }));
    crystal.position.y = BASE_Y + 420; crystal.scale.y = 1.6;
    const halo = glowSprite(0x9fdcff, 220, 0.65); halo.position.y = BASE_Y + 420;
    const light = G.kit.light(0x9fdcff, 1.6, 900, 2); light.position.y = BASE_Y + 420;
    g.add(...parts.map(shadowed), flag, crystal, halo, light, ...fx);
    g.userData.crystal = crystal;
    g.position.set(slot.x, 0, slot.y);
    g.rotation.y = team === G.TEAM.PLAYER ? 0 : Math.PI;  // gate faces the enemy side
    return g;
  }

  const BUILDING_MODELS = { command: makeCommand, hut: makeHut, digin: makeDigin, support: makeSupport, siege: makeSiege, storm: makeStorm,
    barracks: makeBarracks,
    barracksArmored: (s, b, t) => makeBarracks(s, b, t, 'armored'),
    barracksShort: (s, b, t) => makeBarracks(s, b, t, 'short'),
    barracksLong: (s, b, t) => makeBarracks(s, b, t, 'long'),
    allyEngineer: makeEngineerLodge, allyMedic: makeMedicTent, allyOfficer: makeOfficerQuarters, allyDemolitionist: makeDemoWorkshop };
  R.RACE_MODELS.human = { buildings: BUILDING_MODELS, unit: makeSoldier, shot: makeShot };

  function raceModels(team) { return R.RACE_MODELS[G.raceOf(team)] || R.RACE_MODELS.human; }
  // Models come out of the builders as dozens of meshes; static parts are merged per material
  // (G.kit.mergeStatic) to cut draw calls.
  // Buildings of one type are built identically (only the root is placed in its slot), so they share
  // their merged geometry, which lets the instancer (batchModels) draw them all together.
  function buildingModel(slot, base, b) {
    const fn = raceModels(b.team).buildings[b.type] || BUILDING_MODELS[b.type];
    const m = fn(slot, base, b.team);
    const key = 'building:' + G.raceOf(b.team) + ':' + b.type + ':' + b.team;
    return G.kit.mergeStatic(m, animatedParts(m, b), { pieces: true, cacheKey: key });
  }
  // A building's direct children that move: whatever its userData points at, plus anything its tick
  // changes. Ticks animate through closures, so run one over a spread of times and fire states and
  // keep every child whose transform or visibility changed.
  function animatedParts(m, b) {
    const u = m.userData;
    const keep = new Set(Object.values(u).filter(v => v && v.isObject3D));
    if (!u.tick) return keep;
    const snap = () => m.children.map(c => [c.position.x, c.position.y, c.position.z, c.rotation.x, c.rotation.y, c.rotation.z,
      c.scale.x, c.scale.y, c.scale.z, c.visible].join());
    let first = null;
    for (let i = 0; i < 40; i++) {
      u.tick(Object.assign({}, b, { fired: (i % 10) / 9, aim: i * 0.3 }), 0.1 + i * 0.37, m);
      const now = snap();
      if (!first) first = now;
      else m.children.forEach((c, j) => { if (now[j] !== first[j]) keep.add(c); });
    }
    return keep;
  }
  function unitModel(e) {
    const k = G.SQUAD_KINDS[e.kind];
    const m = k.summon ? R.SUMMON_MODELS[e.kind](e.team) : raceModels(e.team).unit(e.team, e.kind, e.ranged);
    // Units of one kind are built identically, so they share their merged geometry.
    const key = (k.summon ? 'summon' : G.raceOf(e.team)) + ':' + e.kind + ':' + e.team + ':' + !!e.ranged;
    G.kit.mergeStatic(m, new Set(Object.values(m.userData).filter(v => v && v.isObject3D)), { cacheKey: key });
    // Armies are the bulk of the shadow pass. At RTS zoom a soldier's legs, head or weapon cast a few
    // pixels of shadow, so only the bigger parts (the merged body) cast one.
    m.updateMatrixWorld(true);
    m.traverse(o => {
      if (!o.isMesh || !o.castShadow) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      if (o.geometry.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis() < UNIT_MIN_CASTER_R) o.castShadow = false;
    });
    return m;
  }
  const UNIT_MIN_CASTER_R = 9;
  // Hero models are dozens of small meshes hung on animated pivots (two heroes cost ~200 draw calls).
  // Each pivot's static meshes merge per material, all the way down the hierarchy. Meshes the
  // animation moves, hides, reshapes or re-skins stay as they are: found by posing the model through a
  // spread of states (attacks, casts, forms, leaps) and keeping every mesh that changed.
  function heroModel(e) {
    const fn = R.HERO_MODELS[e.def.id];
    if (!fn) return makeHero();
    const m = fn(e.team);
    const keep = animatedMeshes(m, e);
    if (!keep) return m;  // posing failed: leave the model as built
    const nodes = [];
    m.traverse(o => { if (!o.isMesh) nodes.push(o); });
    for (const n of nodes) G.kit.mergeStatic(n, keep);
    return m;
  }
  function animatedMeshes(m, e) {
    const u = m.userData;
    if (!u.animate) return new Set();
    const list = [];
    m.traverse(o => { if (o.isMesh) list.push(o); });
    const snap = () => list.map(o => {
      const p = o.geometry.attributes.position;
      return [o.position.x, o.position.y, o.position.z, o.rotation.x, o.rotation.y, o.rotation.z, o.scale.x, o.scale.y, o.scale.z,
        o.visible, o.geometry.id, p ? p.version : 0, o.material.id].join();
    });
    const keep = new Set(Object.values(u).filter(v => v && v.isObject3D));
    let first = null;
    try {
      for (let i = 0; i < 48; i++) {
        // A stand-in that reads through to the hero, so posing it changes nothing in the game.
        const f = Object.create(e);
        Object.assign(f, {
          moving: i % 2 === 0, swing: (i % 6) / 5, swingAlt: i % 4 < 2, castAnim: ((i * 7) % 10) / 9, castSlot: i % 4,
          lift: i % 5 === 0 ? 40 : 0, form: i % 3 === 0 ? 'melee' : 'ranged', dash: i % 7 === 3 ? { tx: e.x, ty: e.y } : null,
          state: Object.assign({}, e.state, { orbit: i % 2 }), buffs: i % 3 === 1 ? { overclock: { t: 1 } } : {}
        });
        u.animate(u, f, 0.1 + i * 0.37, 1 / 60);
        const now = snap();
        if (!first) first = now;
        else list.forEach((o, j) => { if (now[j] !== first[j]) keep.add(o); });
      }
    } catch (err) {
      return null;
    }
    return keep;
  }

  // Frostfist: a frost-armored brawler. Pale rime plate, a hooded crest, icy gauntlets.
  // The right arm pivots at the shoulder and throws the punch (see syncEntities).
  function makeHero() {
    const g = new THREE.Group();
    const plateMat = mat(0x9fd4ea, { metalness: 0.5, roughness: 0.35 });
    const darkMat = mat(0x1c2a36, { metalness: 0.3, roughness: 0.6 });
    const iceMat = new THREE.MeshBasicMaterial({ color: 0xcff4ff });
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(9, 12, 26, 8), plateMat); torso.position.y = 34;
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(12.5, 12, 4, 8), darkMat); belt.position.y = 22;
    const pauldronL = new THREE.Mesh(new THREE.SphereGeometry(6, 8, 6), plateMat); pauldronL.position.set(0, 44, 12);
    const legL = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 22, 6), darkMat); legL.position.set(0, 11, 6);
    const legR = legL.clone(); legR.position.z = -6;
    const head = new THREE.Mesh(new THREE.SphereGeometry(7, 8, 6), mat(0xc9a487)); head.position.y = 52;
    const hood = new THREE.Mesh(new THREE.ConeGeometry(8.5, 12, 7), darkMat); hood.position.set(-1, 58, 0);
    const crest = new THREE.Mesh(new THREE.ConeGeometry(2, 9, 4), iceMat); crest.position.set(-2, 66, 0);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x9fe6ff });
    const e1 = new THREE.Mesh(new THREE.SphereGeometry(1.1, 4, 3), eyeMat); e1.position.set(6, 53, 2.5);
    const e2 = e1.clone(); e2.position.z = -2.5;
    // Left arm hangs at the side with its gauntlet.
    const armL = new THREE.Group(); armL.position.set(0, 42, 10);
    const forearmL = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 4, 20, 6), plateMat); forearmL.position.y = -10;
    const fistL = new THREE.Mesh(new THREE.IcosahedronGeometry(5, 0), iceMat); fistL.position.y = -22;
    armL.add(forearmL, fistL);
    // Right arm is the punching arm: a long pivoting group ending in a glowing frost fist.
    const armR = new THREE.Group(); armR.position.set(0, 42, -10);
    const forearmR = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 4, 20, 6), plateMat); forearmR.position.y = -10;
    const fistR = new THREE.Mesh(new THREE.IcosahedronGeometry(6, 0), iceMat); fistR.position.y = -22;
    const fistGlow = glowSprite(0x6fc8ff, 36); fistGlow.position.copy(fistR.position);
    armR.add(forearmR, fistR, fistGlow);
    g.add(shadowed(torso), shadowed(belt), shadowed(pauldronL), shadowed(legL), shadowed(legR), shadowed(head),
      shadowed(hood), shadowed(crest), e1, e2, shadowed(armL), shadowed(armR));
    g.userData = { plateMat, armR, legL, legR };
    g.scale.setScalar(1.5);
    return g;
  }

  function makeAlgox() {
    const g = new THREE.Group();
    const fur = mat(0x5e4a38, { emissive: 0x000000 });
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(30, 1), fur); body.scale.set(1.05, 1.05, 1.15); body.position.y = 40;
    const hump = new THREE.Mesh(new THREE.IcosahedronGeometry(20, 1), fur); hump.position.set(-8, 62, 0);
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(14, 1), mat(0x3e3024)); head.position.set(26, 52, 0);
    const tuskMat = mat(0xb8ab8c);
    const t1 = new THREE.Mesh(new THREE.ConeGeometry(3, 18, 5), tuskMat); t1.position.set(36, 50, 7); t1.rotation.z = -0.7;
    const t2 = t1.clone(); t2.position.z = -7;
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffa020 });
    const e1 = new THREE.Mesh(new THREE.SphereGeometry(2, 5, 4), eyeMat); e1.position.set(37, 58, 5);
    const e2 = e1.clone(); e2.position.z = -5;
    const armGeo = new THREE.CylinderGeometry(6, 8, 44, 6);
    const a1 = new THREE.Mesh(armGeo, fur); a1.position.set(14, 26, 30); a1.rotation.x = 0.3;
    const a2 = new THREE.Mesh(armGeo, fur); a2.position.set(14, 26, -30); a2.rotation.x = -0.3;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 110, 5), mat(0x241a12)); post.position.set(-34, 55, 0);
    const chain = new THREE.Mesh(new THREE.TorusGeometry(5, 1.4, 4, 8), mat(0x444448, { metalness: 0.7, roughness: 0.5 }));
    chain.position.set(-32, 60, 0);
    const eyeGlow = glowSprite(0xff8a20, 20, 0.8); eyeGlow.position.set(38, 58, 0);
    g.add(shadowed(body), shadowed(hump), shadowed(head), shadowed(t1), shadowed(t2), e1, e2, shadowed(a1), shadowed(a2), shadowed(post), chain, eyeGlow);
    g.userData = { fur };
    return g;
  }

  // Footman: tunic in team color, helmet, round shield, sword on a pivoting arm.
  // Armored: a bigger, plated footman. Ranged kinds trade sword and shield for a bow.
  const soldierGeo = {};
  function makeSoldier(team, kind, ranged) {
    const G3 = soldierGeo;
    if (!G3.body) {
      G3.body = new THREE.CylinderGeometry(7, 10, 26, 7);
      G3.head = new THREE.SphereGeometry(6, 7, 5);
      G3.helm = new THREE.ConeGeometry(7, 8, 7);
      G3.shield = new THREE.CylinderGeometry(9, 9, 2.5, 10);
      G3.blade = new THREE.BoxGeometry(3, 26, 1.2);
      G3.legs = new THREE.CylinderGeometry(3, 3, 12, 5);
      G3.bow = new THREE.TorusGeometry(13, 1, 4, 10, Math.PI);
      G3.pauldron = new THREE.SphereGeometry(5.5, 7, 5);
    }
    const g = new THREE.Group();
    const tunic = mat(team === G.TEAM.PLAYER ? 0x2f5f96 : 0x8c1f18, { emissive: 0x000000 });
    // Only the tunic flashes per soldier; everything else shares cached materials.
    const steel = G.kit.m(0x8a8f96, { metalness: 0.6, roughness: 0.45 });
    const dark = G.kit.m(0x2a2420);
    const l1 = new THREE.Mesh(G3.legs, dark); l1.position.set(0, 6, 4);
    const l2 = new THREE.Mesh(G3.legs, dark); l2.position.set(0, 6, -4);
    const body = new THREE.Mesh(G3.body, tunic); body.position.y = 25;
    const head = new THREE.Mesh(G3.head, G.kit.m(0xc9a487)); head.position.y = 43;
    const helm = new THREE.Mesh(G3.helm, steel); helm.position.y = 48;
    const shield = new THREE.Mesh(G3.shield, tunic); shield.rotation.x = Math.PI / 2; shield.position.set(6, 26, -11);
    // Sword arm pivots at the shoulder; rotation.z swings the blade between raised and forward (+x).
    const arm = new THREE.Group(); arm.position.set(0, 34, 10);
    g.add(shadowed(l1), shadowed(l2), shadowed(body), shadowed(head), shadowed(helm), shadowed(arm));
    if (kind === 'demolitionist') {
      // Rocket launcher: a tube resting on the right shoulder, pointing forward.
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 34, 8).rotateZ(Math.PI / 2), mat(0x3d4a3a));
      tube.position.set(4, 38, -9);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(3.5, 6, 6).rotateZ(-Math.PI / 2), mat(0x8c3a22)); tip.position.set(23, 38, -9);
      g.add(shadowed(tube), shadowed(tip));
    } else if (ranged) {
      // Bow held out front, string side toward the body; long-range archers carry a longer bow.
      const bow = new THREE.Mesh(G3.bow, mat(0x6b4a2a)); bow.rotation.z = -Math.PI / 2;
      bow.position.set(10, 30, 0);
      if (kind === 'long') bow.scale.set(1.35, 1.35, 1);
      if (kind === 'officer') bow.scale.set(0.75, 0.75, 1);
      g.add(shadowed(bow));
    } else {
      const blade = new THREE.Mesh(G3.blade, steel); blade.position.y = 13;
      arm.add(blade);
      g.add(shadowed(shield));
    }
    if (kind === 'armored') {
      // Steel plate over the tunic, big pauldrons, and a heavier frame overall.
      const plate = new THREE.Mesh(G3.body, steel); plate.position.y = 27; plate.scale.set(1.08, 0.6, 1.08);
      const p1 = new THREE.Mesh(G3.pauldron, steel); p1.position.set(0, 37, 9);
      const p2 = p1.clone(); p2.position.z = -9;
      g.add(shadowed(plate), shadowed(p1), shadowed(p2));
      g.scale.setScalar(1.35);
    }
    let aura = null;
    if (G.SQUAD_KINDS[kind].ally) {
      // Allies drop the shield and carry their trade instead; all are 1.5x a soldier.
      g.remove(shield);
      if (kind === 'engineer') {
        arm.clear();
        const handle = new THREE.Mesh(new THREE.BoxGeometry(2.5, 22, 2.5), mat(0x6b4a2a)); handle.position.y = 11;
        const hammer = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 6), steel); hammer.position.y = 22;
        arm.add(handle, hammer);
        helm.material = mat(0xd9a530);
      } else if (kind === 'medic') {
        arm.clear();
        tunic.color.setHex(0xe8e4dc);
        const red = new THREE.MeshBasicMaterial({ color: 0xc8202a });
        const c1 = new THREE.Mesh(new THREE.BoxGeometry(1, 10, 3), red); c1.position.set(9, 27, 0);
        const c2 = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 10), red); c2.position.set(9, 27, 0);
        const band = new THREE.Mesh(new THREE.BoxGeometry(15, 3, 15), mat(team === G.TEAM.PLAYER ? 0x2f5f96 : 0x8c1f18)); band.position.y = 33;
        g.add(c1, c2, band);
      } else if (kind === 'officer') {
        const plume = new THREE.Mesh(new THREE.ConeGeometry(2.5, 12, 5), mat(0xd9a530)); plume.position.y = 57;
        const cape = new THREE.Mesh(new THREE.BoxGeometry(2, 26, 18), tunic); cape.position.set(-9, 26, 0); cape.rotation.z = -0.15;
        g.add(shadowed(plume), shadowed(cape));
        // Aura: a glowing ground ring sized to the officer's reach (undoing the 1.5x scale).
        const R = G.OFFICER_AURA / 1.5;
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(new THREE.RingGeometry(R - 4, R, 64).rotateX(-Math.PI / 2), ringMat); ring.position.y = 1.5;
        const fillMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide });
        const fill = new THREE.Mesh(new THREE.CircleGeometry(R, 64).rotateX(-Math.PI / 2), fillMat); fill.position.y = 1;
        const glow = glowSprite(0xffd27a, 70, 0.7); glow.position.y = 30;
        aura = new THREE.Group(); aura.add(ring, fill, glow); aura.visible = false;
        aura.userData = { ringMat, fillMat };
        g.add(aura);
      } else if (kind === 'demolitionist') {
        const keg = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 12, 8), mat(0x4a3220)); keg.position.set(-10, 30, 0);
        const fuse = glowSprite(0xff8a30, 14, 0.9); fuse.position.set(-10, 38, 0);
        g.add(shadowed(keg), fuse);
      }
      g.scale.setScalar(1.5);
    }
    g.userData = { tunic, arm, l1, l2, ranged, aura, phase: Math.random() * 10 };
    return g;
  }

  function makeProjectile(p) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(p.r, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    g.add(core, glowSprite(p.color, p.r * 11), glowSprite(0xffffff, p.r * 4));
    return g;
  }

  // ---------- per-frame sync ----------
  // Status markers floating with an entity: shield bubble, stun stars, root shackles, Shadow mark, burning.
  const statusViews = new Map();
  function makeStatus(e) {
    const K = G.kit, g = new THREE.Group();
    const R0 = e.r;
    const shieldMat = new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const shield = new THREE.Mesh(K.g.sph(1, 20, 14), shieldMat);
    shield.scale.set(R0 * 2.1, R0 * 3.4, R0 * 2.1); shield.position.y = R0 * 1.8;
    const stun = new THREE.Group();
    for (let i = 0; i < 3; i++) { const s = K.glow(0xffe680, 16, 0.95); s.position.set(Math.cos(i * 2.1) * 14, 0, Math.sin(i * 2.1) * 14); stun.add(s); }
    const root = new THREE.Group();
    root.add(new THREE.Mesh(K.g.ring(R0 + 2, R0 + 7, 24), K.lit(0x8a7a62, { transparent: true, opacity: 0.9, side: THREE.DoubleSide })));
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      K.add(root, K.g.cone(3, 16, 4), K.m(0x6a5a44), Math.cos(a) * (R0 + 4), 8, Math.sin(a) * (R0 + 4), { rz: Math.cos(a) * 0.5, rx: -Math.sin(a) * 0.5, shadow: false });
    }
    root.position.y = 2;
    const mark = K.glow(0xb28cff, 34, 0.9);
    const burn = K.glow(0xff7a2a, R0 * 3, 0.35);
    g.add(shield, stun, root, mark, burn);
    scene.add(g);
    return { g, shield, shieldMat, stun, root, mark, burn };
  }
  function syncStatus(e) {
    let v = statusViews.get(e);
    const show = !e.dead && (e.shieldAmt > 0 || e.stunTimer > 0 || e.rootTimer > 0 || (e.marks && e.marks.shadow) || e.dots.length);
    if (!show) { if (v) v.g.visible = false; return; }
    if (!v) { v = makeStatus(e); statusViews.set(e, v); }
    v.g.visible = true;
    const lift = e.lift || 0, top = (e instanceof G.Hero ? (e.def.barH || 150) * 0.62 : e.r * 3.6) + lift;
    v.g.position.set(e.x, lift, e.y);
    v.shield.visible = e.shieldAmt > 0;
    if (v.shield.visible) { v.shieldMat.color.setHex(e.shieldColor); v.shieldMat.opacity = 0.16 + Math.sin(time * 5) * 0.05; v.shield.rotation.y = time; }
    v.stun.visible = e.stunTimer > 0;
    v.stun.position.y = top; v.stun.rotation.y = time * 5;
    v.root.visible = e.rootTimer > 0;
    v.mark.visible = !!(e.marks && e.marks.shadow);
    v.mark.position.y = top + 14; v.mark.material.opacity = 0.6 + Math.sin(time * 6) * 0.3;
    v.burn.visible = e.dots.length > 0;
    v.burn.position.y = e.r * 1.4;
    v.burn.material.color.setHex(e.dots.length && e.dots[0].color === '#b28cff' ? 0x9a6cff : 0xff7a2a);
    v.burn.material.opacity = 0.25 + Math.random() * 0.2;
  }

  function syncEntities(hero, dt) {
    // Drop meshes for entities that left the world (fallen soldiers).
    const live = new Set(G.entities);
    for (const [k, m] of meshes) {
      if (k instanceof G.Entity && !live.has(k)) { removeModel(m); meshes.delete(k); }
    }
    for (const [k, v] of statusViews) if (!live.has(k)) { scene.remove(v.g); statusViews.delete(k); }
    for (const e of G.entities) {
      let m = meshes.get(e);
      if (!m) {
        // Heroes are one of a kind; everything else is drawn instanced.
        m = e instanceof G.Hero ? heroModel(e) : e instanceof G.Soldier ? unitModel(e) : makeAlgox();
        meshes.set(e, m); addModel(m, !(e instanceof G.Hero));
      }
      m.visible = !e.dead;
      syncStatus(e);
      if (e.dead) continue;
      m.position.set(e.x, 0, e.y);
      const tint = e.flash > 0 ? 0x7a3a30 : e.stunTimer > 0 ? 0x4a4a10 : e.slowTimer > 0 ? 0x10324a : 0x000000;
      if (e instanceof G.Hero) {
        m.rotation.y = -e.facing;
        const u = m.userData;
        if (u.flashMats) for (const fm of u.flashMats) fm.emissive.setHex(tint);
        if (u.animate) u.animate(u, e, time, dt);
        else {
          const k = e.swing;
          u.armR.rotation.x = k <= 0 ? 0 : k > 0.6 ? (1 - k) / 0.4 * -0.6 : -0.6 + (0.6 - k) / 0.6 * 1.9;
        }
        m.position.y += e.lift;
        // Untouchable heroes (mid-ultimate) flicker.
        m.visible = !e.untargetable || Math.sin(time * 60) > -0.2;
        const light = e === hero ? heroLight : foeLight;
        light.color.setHex(e.def.color);
        light.position.set(e.x, 90 + e.lift, e.y);
        light.intensity = 1.5 + Math.sin(time * 3) * 0.2;
      } else if (e instanceof G.Soldier) {
        const u = m.userData;
        m.rotation.y = -e.facing;
        u.tunic.emissive.setHex(tint);
        if (u.tick) u.tick(u, e, time);
        // Swing as e.swing runs 1 -> 0: wind up (blade tilts back), then chop forward past level.
        const k = e.swing;
        // Archers just draw the empty hand back to the chest and release.
        u.arm.rotation.z = u.ranged ? (k > 0.5 ? 1.2 : k * 2.4) - 0.25
          : k <= 0 ? -0.25 : k > 0.7 ? (1 - k) / 0.3 * 0.9 : 0.9 - (0.7 - k) / 0.7 * 2.6;
        const step = e.moving ? Math.sin(time * 14 + u.phase) : 0;
        u.l1.rotation.z = step * 0.5; u.l2.rotation.z = -step * 0.5;
        m.position.y = e.moving ? Math.abs(step) * 2 : 0;
        // Attack lunge: lean back on the wind-up, then hop forward and lean into the strike.
        const lunge = u.ranged || k <= 0 ? 0 : k > 0.7 ? -(1 - k) / 0.3 : Math.sin((0.7 - k) / 0.7 * Math.PI);
        m.position.x += Math.cos(e.facing) * lunge * 6;
        m.position.z += Math.sin(e.facing) * lunge * 6;
        m.rotation.z = -lunge * 0.22;
        if (u.aura) {
          u.aura.visible = e.auraOn;
          const p = 0.5 + Math.sin(time * 4) * 0.5;
          u.aura.userData.ringMat.opacity = 0.35 + p * 0.35;
          u.aura.userData.fillMat.opacity = 0.05 + p * 0.06;
        }
      } else {
        m.rotation.y = -Math.atan2(hero.y - e.y, hero.x - e.x);
        const fur = m.userData.fur;
        fur.emissive.setHex(e.flash > 0 ? 0x7a5a40 : tint);
        m.scale.y = 1 + Math.sin(time * 2 + e.homeX) * 0.02;  // breathing
      }
    }
  }

  // A removed building falls apart: every mesh becomes a loose chunk that is flung outward, tumbles,
  // bounces on the ground and shrinks away. Chunks share the building's geometry and materials.
  const DEBRIS_GRAVITY = 900, DEBRIS_LIFE = 2.4;
  function crumble(group, x, z) {
    group.updateMatrixWorld(true);
    // Merged static parts fly apart as their original pieces (kept detached by mergeStatic).
    const pieces = group.userData.pieces || [];
    for (const p of pieces) p.matrixWorld.multiplyMatrices(group.matrixWorld, p.matrix);
    const chunks = [];
    group.traverse(m => {
      if (!m.isMesh) return;
      if (m.userData.merged) { if (m.userData.ownGeo) m.geometry.dispose(); return; }
      chunks.push(m);
    });
    for (const m of chunks.concat(pieces)) {
      const c = new THREE.Mesh(m.geometry, m.material);
      c.castShadow = m.castShadow; c.receiveShadow = m.receiveShadow;
      m.matrixWorld.decompose(c.position, c.quaternion, c.scale);
      const s0 = c.scale.clone();
      const dx = c.position.x - x, dz = c.position.z - z, d = Math.hypot(dx, dz) || 1;
      const push = 60 + Math.random() * 120;
      const v = new THREE.Vector3((dx / d) * push, 80 + Math.random() * 220, (dz / d) * push);
      const spin = new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9);
      scene.add(c);
      debris.push({ mesh: c, s0, v, spin, t: 0, life: DEBRIS_LIFE * (0.8 + Math.random() * 0.4) });
    }
    removeModel(group);
  }

  function updateDebris(dt) {
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i], c = d.mesh;
      d.t += dt;
      if (d.t >= d.life) { scene.remove(c); debris.splice(i, 1); continue; }
      d.v.y -= DEBRIS_GRAVITY * dt;
      c.position.addScaledVector(d.v, dt);
      if (c.position.y < 4) {          // landed: bounce a little and skid
        c.position.y = 4;
        d.v.y = Math.abs(d.v.y) * 0.3;
        d.v.x *= 0.6; d.v.z *= 0.6;
        d.spin.multiplyScalar(0.7);
      }
      c.rotation.x += d.spin.x * dt; c.rotation.y += d.spin.y * dt; c.rotation.z += d.spin.z * dt;
      // Shrink over the last part of its life.
      c.scale.copy(d.s0).multiplyScalar(1 - smooth(d.life * 0.5, d.life, d.t));
    }
  }

  function syncBases() {
    for (const v of baseViews) {
      const hex = v.base.team === null ? NEUTRAL_HEX : TEAM_HEX[v.base.team];
      v.ring.material.color.setHex(hex);
      v.bannerMat.color.setHex(hex);
      // Banner ripples in the wind.
      const p = v.bannerGeo.attributes.position, b0 = v.bannerBase;
      for (let i = 0; i < p.count; i++) {
        const x = b0[i * 3] + 35;
        p.setZ(i, Math.sin(time * 3 + x * 0.08 + v.phase) * x * 0.12);
      }
      p.needsUpdate = true;
      v.bannerGeo.computeVertexNormals();

      const f = 1 + Math.sin(time * 13 + v.phase) * 0.08 + Math.sin(time * 7.3 + v.phase * 2) * 0.07;
      v.light.intensity = 2.1 * f;
      v.fire.scale.set(120 * f, 140 * f, 1);
      v.fireCore.scale.set(50 / f, 60 * f, 1);

      // Storm field: slowly breathing haze while the base is shielded.
      const storm = G.stormOf(v.base);
      v.field.visible = !!storm;
      if (storm) v.field.material.color.setHex(FIELD_HEX[G.raceOf(storm.team)] || 0xbfe6ff);
      v.field.material.opacity = 0.09 + 0.03 * Math.sin(time * 1.3 + v.phase) + 0.02 * Math.sin(time * 2.9 + v.phase * 3);
      v.field.rotation.y = time * 0.02 + v.phase;

      for (const s of v.slots) {
        const built = meshes.get(s.slot);
        if (built && !s.slot.building) { crumble(built, s.slot.x, s.slot.y); meshes.delete(s.slot); s.mesh.visible = true; }
        if (s.slot.building) {
          s.mesh.visible = false;
          if (!meshes.has(s.slot)) { const h = buildingModel(s.slot, v.base, s.slot.building); meshes.set(s.slot, h); addModel(h, true); }
          aimTower(meshes.get(s.slot), s.slot.building);
          continue;
        }
      }
    }
  }

  // Empty build slots: the one the viewing player is about to build on lights up green (or red if they can't).
  function paintSlots(hero, hover) {
    for (const v of baseViews) {
      for (const s of v.slots) {
        if (s.slot.building || s.slot.core) continue;
        const isHover = hover && hover.slot === s.slot;
        const ok = isHover && !G.buildCheck(hero, v.base, s.slot);
        s.mesh.material.color.setHex(isHover ? (ok ? 0x6adf7a : 0xd04a3a) : 0xc9d2da);
        s.mesh.material.opacity = isHover ? 0.85 : 0.22;
      }
    }
  }

  const FIELD_HEX = { human: 0xbfe6ff, algox: 0xe8f6ff, lurker: 0x5fe0d8, unfettered: 0xffd070 };

  // Turn a tower's turret toward its last target; the catapult arm swings over as it fires.
  // Race models may animate themselves with userData.tick(building, time).
  function aimTower(m, b) {
    const u = m.userData;
    if (u.tick) u.tick(b, time, m);
    if (u.crystal) { u.crystal.rotation.y = time * 0.6; u.crystal.position.y = 446 + Math.sin(time * 1.5) * 6; }
    if (u.turret && b.aim !== undefined) u.turret.rotation.y = -b.aim - m.rotation.y;
    if (u.arm) {
      const f = b.fired || 0;   // 1 just fired -> 0 reloaded
      u.arm.rotation.z = f > 0.7 ? -0.25 - (1 - f) / 0.3 * 1.9 : -0.25 - f / 0.7 * 1.9;
      u.rock.visible = f < 0.3;
    }
  }

  let shaftMat;
  function makeShot(s) {
    if (s.shot === 'rocket') {
      // Rocket: red body along +x, steel nose, tail fins and a bright exhaust flare.
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 22, 6).rotateZ(Math.PI / 2), mat(0x8c3a22));
      const nose = new THREE.Mesh(new THREE.ConeGeometry(3, 8, 6).rotateZ(-Math.PI / 2), mat(0x8a8f96, { metalness: 0.6 })); nose.position.x = 15;
      const finMat = mat(0x2a2420);
      const f1 = new THREE.Mesh(new THREE.BoxGeometry(6, 10, 1), finMat); f1.position.x = -9;
      const f2 = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 10), finMat); f2.position.x = -9;
      const flare = glowSprite(0xff9a30, 34, 0.95); flare.position.x = -14;
      g.add(body, nose, f1, f2, flare);
      return g;
    }
    if (s.shot === 'boulder') return shadowed(new THREE.Mesh(new THREE.IcosahedronGeometry(20, 0), mat(0x55555c)));
    shaftMat = shaftMat || new THREE.MeshBasicMaterial({ color: 0xd9c7a0 });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(s.shot === 'bolt' ? 46 : 26, 2.5, 2.5), shaftMat));
    return g;
  }

  function syncShots() {
    const live = new Set(G.shots);
    for (const [k, m] of meshes) if (k.shot && !live.has(k)) { scene.remove(m); meshes.delete(k); }
    for (const s of G.shots) {
      let m = meshes.get(s);
      if (!m) { m = raceModels(s.team).shot(s); meshes.set(s, m); scene.add(m); s.px = s.x0; s.py = s.y0; s.ph = s.h0; }
      m.position.set(s.x, s.h, s.y);
      if (s.rolling) m.rotation.set(0, -Math.atan2(s.rolling.dy, s.rolling.dx), -s.spin, 'YZX');
      else if (s.shot === 'boulder') m.rotation.set(time * 5, time * 3, 0);
      else {
        // Point along the flight path.
        const dx = s.x - s.px, dy = s.y - s.py, dh = s.h - s.ph;
        if (dx || dy || dh) m.rotation.set(0, -Math.atan2(dy, dx), Math.atan2(dh, Math.hypot(dx, dy)), 'YZX');
      }
      s.px = s.x; s.py = s.y; s.ph = s.h;
    }
  }

  function syncProjectiles() {
    const live = new Set(G.projectiles);
    for (const [k, m] of meshes) if (k.vx !== undefined && !live.has(k)) { scene.remove(m); meshes.delete(k); }
    projLights.forEach(l => { l.intensity = 0; });
    G.projectiles.forEach((p, i) => {
      let m = meshes.get(p);
      const styled = p.style && R.PROJ[p.style];
      if (!m) { m = styled ? R.PROJ[p.style](p) : makeProjectile(p); meshes.set(p, m); scene.add(m); }
      m.position.set(p.x, p.h, p.y);
      // Styled projectiles point along their flight (+x forward); plain orbs tumble.
      if (styled) {
        m.rotation.set(0, -Math.atan2(p.vy, p.vx), 0);
        if (m.userData.spin) m.userData.spin.rotation.x = time * m.userData.spinRate;
        if (m.userData.tick) m.userData.tick(m, p, time);
      } else m.children[0].rotation.set(time * 9, time * 7, 0);
      if (i < projLights.length) { projLights[i].position.set(p.x, p.h + 16, p.y); projLights[i].color.set(p.color); projLights[i].intensity = 2.4; }
    });
  }

  const tmpC = new THREE.Color();
  const particleColors = new Map();  // CSS color string -> THREE.Color; parsing strings per particle per frame is slow
  function particleColor(c) {
    let v = particleColors.get(c);
    if (!v) { v = new THREE.Color(c); particleColors.set(c, v); }
    return v;
  }
  function syncParticles() {
    const pos = particles.geometry.attributes.position, col = particles.geometry.attributes.color;
    const n = Math.min(G.particles.length, MAX_PARTICLES);
    for (let i = 0; i < n; i++) {
      const p = G.particles[i];
      const k = 1 - p.t / p.life;
      pos.setXYZ(i, p.x, (p.h !== undefined ? p.h + p.t * 30 : 26 + p.t * 60) + (i % 7) * 3, p.y);
      tmpC.copy(particleColor(p.color)).multiplyScalar(k);
      col.setXYZ(i, tmpC.r, tmpC.g, tmpC.b);
    }
    particles.geometry.setDrawRange(0, n);
    pos.needsUpdate = col.needsUpdate = true;
  }

  // Lend the light pool to the virtual lights (G.kit.light) nearest the view; the rest sit dark this frame.
  const tmpL = new THREE.Vector3();
  const lightPicks = [];
  function syncLights(cam) {
    lightPicks.length = 0;
    for (const l of G.kit.lights) {
      // Only lights in the scene, with no hidden ancestor, count.
      let o = l, shown = true;
      while (o.parent) { if (!o.visible) shown = false; o = o.parent; }
      if (o !== scene) {
        // Removed from the world (or never added, e.g. a menu preview model): forget it.
        if (l.seen || ++l.idle > 300) G.kit.lights.delete(l);
        continue;
      }
      l.seen = true;
      if (!shown || l.intensity <= 0) continue;
      l.updateWorldMatrix(true, false);
      tmpL.setFromMatrixPosition(l.matrixWorld);
      const score = Math.hypot(tmpL.x - cam.fx, tmpL.z - cam.fy) - (l.distance || 2000);
      lightPicks.push({ l, x: tmpL.x, y: tmpL.y, z: tmpL.z, score });
    }
    lightPicks.sort((a, b) => a.score - b.score);
    lightPool.forEach((p, i) => {
      const v = lightPicks[i];
      if (!v) { p.intensity = 0; return; }
      p.position.set(v.x, v.y, v.z);
      p.color.copy(v.l.color);
      p.intensity = v.l.intensity; p.distance = v.l.distance; p.decay = v.l.decay;
    });
  }

  // ---------- instancing ----------
  // Armies, buildings and coin piles are hundreds of models built from a few shared geometries, and
  // every mesh in them was its own draw call (twice, with shadows): a few big squads meant thousands per
  // frame. Each frame, right after the renderer updates world matrices (scene.onBeforeRender), every
  // opaque mesh of a batched model moves to a layer no camera draws and becomes one instance of an
  // InstancedMesh per (geometry, material look, shadow flags) instead. Models keep animating and
  // hiding parts exactly as before; only how they reach the GPU changes.
  // Materials are matched by look, not identity: every soldier owns its flash material, and all the
  // soldiers whose tunic shows the same tint collapse into one batch. Batches draw with their own copy
  // of the material, so a model's material is never shared between instanced and plain drawing.
  const HIDDEN_LAYER = 1;
  const batchRoots = new Set();
  const batches = new Map();          // geometry -> Map(material id * 4 + shadow flags -> batch)
  const batchMats = new Map();        // look signature -> material copy
  const matLooks = new WeakMap();     // model material -> { base, c, e, ei, o, copy }
  let frameNo = 0, batchedFrame = -1;

  // Batched models start on the hidden layer: one left out of the batches (off screen) stays undrawn.
  function addModel(m, batched) {
    scene.add(m);
    if (batched) { batchRoots.add(m); m.traverse(o => { if (o.isMesh) o.layers.set(HIDDEN_LAYER); }); }
  }
  function removeModel(m) { scene.remove(m); batchRoots.delete(m); }

  // The batch material for a model material as it looks right now. Fixed properties are read once;
  // the ones models animate (color, emissive tint, opacity) are checked every frame.
  function lookOf(m) {
    let s = matLooks.get(m);
    if (!s) {
      s = { base: [m.type, m.flatShading, m.roughness, m.metalness, m.side, m.vertexColors, m.alphaTest, m.depthWrite, m.depthTest,
        m.fog, m.toneMapped, m.blending, m.wireframe, m.map && m.map.uuid, m.emissiveMap && m.emissiveMap.uuid].join(), c: -1, e: -1, ei: -1, o: -1, copy: null };
      matLooks.set(m, s);
    }
    const c = m.color ? m.color.getHex() : 0, e = m.emissive ? m.emissive.getHex() : 0, ei = m.emissiveIntensity || 0, o = m.opacity;
    if (c !== s.c || e !== s.e || ei !== s.ei || o !== s.o) {
      s.c = c; s.e = e; s.ei = ei; s.o = o;
      const key = s.base + '|' + c + '|' + e + '|' + ei + '|' + o;
      s.copy = batchMats.get(key);
      if (!s.copy) { s.copy = m.clone(); batchMats.set(key, s.copy); }
    }
    return s.copy;
  }

  // Geometry is matched by content too: model builders make a fresh BoxGeometry for every window and
  // flag, so identical parts of two buildings are different objects. Hashed once per geometry.
  const geoCanon = new WeakMap(), geoByHash = new Map();
  function canonGeo(geo) {
    let c = geoCanon.get(geo);
    if (c) return c;
    let h = 0x811c9dc5;
    const mix = arr => {
      const u = new Uint32Array(arr.buffer, arr.byteOffset, arr.byteLength >> 2);
      for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619);
      h = Math.imul(h ^ u.length, 16777619);
    };
    const parts = [];
    for (const n of ['position', 'normal', 'uv', 'color']) {
      const a = geo.attributes[n];
      if (!a) continue;
      if (a.isInterleavedBufferAttribute) { geoCanon.set(geo, geo); return geo; }
      parts.push(n + a.itemSize);
      mix(a.array);
    }
    if (geo.index) { parts.push('i'); mix(geo.index.array); }
    const key = parts.join() + ':' + (h >>> 0);
    c = geoByHash.get(key);
    if (!c) geoByHash.set(key, c = geo);
    geoCanon.set(geo, c);
    return c;
  }

  function addInstance(o, mat) {
    const geo = canonGeo(o.geometry);
    let byMat = batches.get(geo);
    if (!byMat) batches.set(geo, byMat = new Map());
    const k = mat.id * 4 + (o.castShadow ? 2 : 0) + (o.receiveShadow ? 1 : 0);
    let b = byMat.get(k);
    if (!b) byMat.set(k, b = { geo, mat, cast: o.castShadow, recv: o.receiveShadow, im: null, cap: 0, n: 0, idle: 0 });
    if (b.n === b.cap) {
      const cap = Math.max(16, b.cap * 2);
      const im = new THREE.InstancedMesh(b.geo, b.mat, cap);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;  // its bounds are the geometry's, not the instances'
      im.castShadow = b.cast; im.receiveShadow = b.recv;
      if (b.im) { im.instanceMatrix.array.set(b.im.instanceMatrix.array.subarray(0, b.n * 16)); scene.remove(b.im); b.im.dispose(); }
      scene.add(im);
      b.im = im; b.cap = cap;
    }
    b.im.instanceMatrix.array.set(o.matrixWorld.elements, b.n * 16);
    b.n++;
  }

  // Glow sprites (G.kit.glow) in batched models: one instanced, camera-facing quad each, all in one
  // draw. Same look as a Sprite with an additive SpriteMaterial: texture x color, alpha x opacity, fog.
  let glows = null, glowN = 0, glowCap = 0;
  const GLOW_VERT = `
    attribute vec3 iPos; attribute vec2 iScale; attribute vec4 iColor;
    varying vec2 vUv; varying vec4 vColor;
    #include <fog_pars_vertex>
    void main() {
      vUv = uv; vColor = iColor;
      vec4 mvPosition = viewMatrix * vec4(iPos, 1.0);
      mvPosition.xy += position.xy * iScale;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`;
  const GLOW_FRAG = `
    uniform sampler2D map;
    varying vec2 vUv; varying vec4 vColor;
    #include <fog_pars_fragment>
    void main() {
      vec4 t = texture2D(map, vUv);
      gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
      #include <tonemapping_fragment>
      #include <encodings_fragment>
      #include <fog_fragment>
    }`;
  function growGlows() {
    const cap = Math.max(64, glowCap * 2);
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    const attr = (name, size) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size).setUsage(THREE.DynamicDrawUsage);
      if (glows) a.array.set(glows.geometry.attributes[name].array.subarray(0, glowN * size));
      geo.setAttribute(name, a);
    };
    attr('iPos', 3); attr('iScale', 2); attr('iColor', 4);
    if (!glows) {
      const material = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null } }]),
        vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true
      });
      material.uniforms.map.value = G.kit.glowTex();
      glows = new THREE.Mesh(geo, material);
      glows.frustumCulled = false;
      scene.add(glows);
    } else { glows.geometry.dispose(); glows.geometry = geo; }
    glowCap = cap;
  }
  const isGlow = o => o.material.map === G.kit.glowTex() && o.material.blending === THREE.AdditiveBlending &&
    !o.material.rotation && o.center.x === 0.5 && o.center.y === 0.5;
  function addGlow(o) {
    if (glowN === glowCap) growGlows();
    const a = glows.geometry.attributes, e = o.matrixWorld.elements, m = o.material, c = m.color, i = glowN++;
    a.iPos.array[i * 3] = e[12]; a.iPos.array[i * 3 + 1] = e[13]; a.iPos.array[i * 3 + 2] = e[14];
    a.iScale.array[i * 2] = Math.hypot(e[0], e[1], e[2]); a.iScale.array[i * 2 + 1] = Math.hypot(e[4], e[5], e[6]);
    a.iColor.array[i * 4] = c.r; a.iColor.array[i * 4 + 1] = c.g; a.iColor.array[i * 4 + 2] = c.b; a.iColor.array[i * 4 + 3] = m.opacity;
  }

  function collect(o) {
    if (!o.visible) return;
    if (o.isSprite) {
      if (isGlow(o)) { o.layers.set(HIDDEN_LAYER); addGlow(o); } else o.layers.set(0);
    }
    if (o.isMesh) {
      const m = o.material;
      // Transparent parts need sorting and mirrored ones need flipped faces: those draw as before.
      if (!Array.isArray(m) && !m.transparent && !o.isInstancedMesh && o.matrixWorld.determinant() > 0) {
        o.layers.set(HIDDEN_LAYER);
        addInstance(o, lookOf(m));
      } else o.layers.set(0);
    }
    const ch = o.children;
    for (let i = 0; i < ch.length; i++) collect(ch[i]);
  }

  // Instanced meshes can't be frustum culled as a whole, so models are culled on the way in: only those
  // standing on (or near) ground some view can see. The pad covers tall models whose tops reach into
  // view and casters just off screen whose shadows do (shadows fall away from the moon, ~0.7 x height).
  const CULL_PAD = 500;
  const cullBoxes = [];               // per view: [x0, x1, z0, z1] of visible ground, padded
  function viewGround(cam, pad) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [sx, sy] of [[0, 0], [cam.w, 0], [cam.w, cam.h], [0, cam.h]]) {
      const w = cam.screenToWorld(sx, sy);
      x0 = Math.min(x0, w.x); x1 = Math.max(x1, w.x); z0 = Math.min(z0, w.y); z1 = Math.max(z1, w.y);
    }
    return [x0 - pad, x1 + pad, z0 - pad, z1 + pad];
  }
  function nearView(o) {
    const x = o.position.x, z = o.position.z;
    for (const b of cullBoxes) if (x > b[0] && x < b[1] && z > b[2] && z < b[3]) return true;
    return false;
  }

  function batchModels() {
    for (const byMat of batches.values()) for (const b of byMat.values()) b.n = 0;
    glowN = 0;
    for (const root of batchRoots) if (nearView(root)) collect(root);
    if (glows) {
      glows.geometry.instanceCount = glowN;
      glows.visible = glowN > 0;
      for (const n of ['iPos', 'iScale', 'iColor']) {
        const a = glows.geometry.attributes[n];
        a.updateRange.count = glowN * a.itemSize; a.needsUpdate = true;
      }
    }
    for (const [geo, byMat] of batches) {
      for (const [k, b] of byMat) {
        b.im.count = b.n;
        b.im.visible = b.n > 0;
        if (b.n) {
          b.idle = 0;
          b.im.instanceMatrix.updateRange.count = b.n * 16;
          b.im.instanceMatrix.needsUpdate = true;
        } else if (++b.idle > 120) { scene.remove(b.im); b.im.dispose(); byMat.delete(k); }
      }
      if (!byMat.size) batches.delete(geo);
    }
  }

  // ---------- coins ----------
  // A pile of gold discs; bigger piles get more coins. Geometry and material are shared.
  const coinGeo = new THREE.CylinderGeometry(5, 5, 1.8, 12);
  const coinMat = new THREE.MeshStandardMaterial({ color: 0xffc23a, emissive: 0x6a4300, metalness: 0.8, roughness: 0.35 });
  function makeCoins(c) {
    const g = new THREE.Group();
    const n = Math.min(14, 3 + Math.floor(Math.sqrt(c.amount) * 1.5));
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(coinGeo, coinMat);
      const a = i * 2.4, d = (c.r - 5) * Math.sqrt(i / n);
      m.position.set(Math.cos(a) * d, 1 + (n - i) * 0.9, Math.sin(a) * d);
      m.rotation.set((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5);
      g.add(m);  // 2 units tall: no shadow worth a pass
    }
    g.add(glowSprite(0xffcf4a, c.r * 3.2, 0.35));
    return g;
  }

  function syncCoins() {
    const live = new Set(G.coins);
    for (const [k, m] of meshes) if (k.amount !== undefined && !live.has(k)) { removeModel(m); meshes.delete(k); }
    for (const c of G.coins) {
      let m = meshes.get(c);
      if (!m) { m = makeCoins(c); meshes.set(c, m); addModel(m, true); }
      m.position.set(c.x, Math.max(0, 30 * (1 - c.t * 5)), c.y);  // quick drop onto the ground
      m.rotation.y = time * 0.6;
    }
  }

  // ---------- ability effects ----------
  const fxMeshes = new Map();
  function syncFx(dt) {
    const live = new Set(G.fx);
    for (const [k, m] of fxMeshes) if (!live.has(k)) { scene.remove(m); fxMeshes.delete(k); }
    for (const o of G.fx) {
      const def = R.FX[o.kind];
      if (!def) continue;
      let m = fxMeshes.get(o);
      if (!m) { m = def.make(o); fxMeshes.set(o, m); scene.add(m); }
      def.update(m, o, time, dt);
    }
  }

  // ---------- overlay ----------
  // How high above a unit's feet its health bar sits.
  function barHeight(e) {
    if (e instanceof G.Hero) return (e.def.barH || 150) + e.lift;
    if (e instanceof G.Soldier) return e.kind === 'armored' ? 84 : e.kind === 'colossus' ? 190 : G.SQUAD_KINDS[e.kind].ally ? 93 : 62;
    return 105;
  }
  // Health bars and floating text for one view; the caller has moved the overlay to the view's corner.
  function drawMarks(cam, hero) {
    const c = octx;

    for (const e of G.entities) {
      if (e.dead) continue;
      const isHero = e instanceof G.Hero;
      const isSoldier = e instanceof G.Soldier;
      if (isSoldier && e.hp >= e.maxHp) continue;  // keep squads uncluttered until hurt
      const s = cam.worldToScreen(e.x, e.y, barHeight(e));
      if (s.behind || !cam.isVisible(e.x, e.y, 80)) continue;
      const w = isHero ? 46 : isSoldier ? 22 : 58, x = Math.round(s.x - w / 2), y = Math.round(s.y);
      c.fillStyle = 'rgba(0,0,0,0.75)'; c.fillRect(x - 2, y - 2, w + 4, 8);
      c.fillStyle = isHero ? (e.team === G.TEAM.PLAYER ? '#6f9a3c' : '#d8452e') : e.team === G.TEAM.PLAYER ? '#5a86b8' : '#9b241c';
      c.fillRect(x, y, w * (e.hp / e.maxHp), 4);
      if (e.shieldAmt > 0) { c.fillStyle = 'rgba(230,245,255,0.85)'; c.fillRect(x, y - 3, Math.min(w, w * e.shieldAmt / e.maxHp), 2); }
      c.strokeStyle = '#5a4a32'; c.lineWidth = 1; c.strokeRect(x - 2.5, y - 2.5, w + 5, 9);
    }

    // Damaged buildings show a wide health bar.
    for (const b of G.buildingList()) {
      if (b.hp >= b.maxHp) continue;
      const cc = G.BUILDINGS[b.type].command;  // the Command Center gets a taller, wider bar
      const s = cam.worldToScreen(b.x, b.y, cc ? 520 : 170);
      if (s.behind || !cam.isVisible(b.x, b.y, cc ? 220 : 120)) continue;
      const w = cc ? 200 : 110, x = Math.round(s.x - w / 2), y = Math.round(s.y);
      c.fillStyle = 'rgba(0,0,0,0.75)'; c.fillRect(x - 2, y - 2, w + 4, 9);
      c.fillStyle = b.team === G.TEAM.PLAYER ? '#5a86b8' : '#9b241c';
      c.fillRect(x, y, w * (b.hp / b.maxHp), 5);
    }

    // Bobbing red arrow over the hero's attack target, above its health bar.
    const t = hero.attackTarget;
    if (t && !t.dead) {
      const bd = t.type && G.BUILDINGS[t.type];
      const s = cam.worldToScreen(t.x, t.y, bd ? (bd.command ? 520 : 170) : barHeight(t));
      if (!s.behind && cam.isVisible(t.x, t.y, 120)) {
        const x = s.x, y = s.y - 12 + Math.sin(time * 6) * 3;
        c.beginPath(); c.moveTo(x - 9, y - 12); c.lineTo(x + 9, y - 12); c.lineTo(x, y); c.closePath();
        c.fillStyle = '#ff4a34'; c.fill();
        c.strokeStyle = 'rgba(0,0,0,0.8)'; c.lineWidth = 2; c.stroke();
      }
    }

    c.font = '700 17px Cinzel, Georgia, serif';
    c.textAlign = 'center';
    for (const f of G.floaters) {
      const s = cam.worldToScreen(f.x, f.y, 90);
      if (s.behind) continue;
      c.globalAlpha = 1 - f.t / 0.9;
      c.lineWidth = 4; c.strokeStyle = '#0a0806';
      c.strokeText(f.text, s.x, s.y);
      c.fillStyle = f.color === '#ffffff' ? '#e9dcc2' : f.color;
      c.fillText(f.text, s.x, s.y);
    }
    c.globalAlpha = 1;
  }

  // Snowfall drifts across the whole screen, over every view.
  function drawSnow(dt) {
    const c = octx;
    c.fillStyle = 'rgba(210,215,225,0.55)';
    for (const f of snow) {
      f.y += f.v * dt; f.x += (Math.sin((f.ph += dt)) * 14 - 25) * dt;
      if (f.y > viewH + 4) { f.y = -4; f.x = Math.random() * (viewW + 100); }
      if (f.x < -4) f.x = viewW + 4;
      c.fillRect(f.x, f.y, f.s, f.s);
    }
  }

  // ---- Cast preview (ability confirm before cast) ----
  // Translucent ground shapes from G.castPreview, drawn from a pool of meshes reused every frame.
  // Ground-plane geometry is built in x/z with +x pointing along the shape's angle.
  const castGeo = {
    disc: new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2),
    plane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    shaft: new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0).rotateX(-Math.PI / 2),
    head: new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, -0.5), new THREE.Vector2(1, 0), new THREE.Vector2(0, 0.5)])).rotateX(-Math.PI / 2),
    rings: new Map(), cones: new Map()
  };
  // Outline rings keep a constant thickness, so each radius gets its own geometry.
  function ringGeo(r, thick) {
    const k = r + ':' + thick;
    if (!castGeo.rings.has(k)) castGeo.rings.set(k, new THREE.RingGeometry(Math.max(0, r - thick), r, 96).rotateX(-Math.PI / 2));
    return castGeo.rings.get(k);
  }
  function coneGeo(arc) {
    if (!castGeo.cones.has(arc)) castGeo.cones.set(arc, new THREE.CircleGeometry(1, 40, -arc / 2, arc).rotateX(-Math.PI / 2));
    return castGeo.cones.get(arc);
  }
  const castPool = [];
  let castUsed = 0;
  function castMesh(geo, color, opacity, y) {
    let m = castPool[castUsed];
    if (!m) {
      m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      m.renderOrder = 5;
      castPool.push(m); scene.add(m);
    }
    castUsed++;
    m.geometry = geo; m.visible = true;
    m.material.color.setHex(color); m.material.opacity = opacity;
    m.position.set(0, y, 0); m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1);
    return m;
  }
  function drawCastPreview(cast) {
    castUsed = 0;
    if (cast) {
      const glow = 0.85 + Math.sin(time * 5) * 0.15, c = cast.color;
      for (const s of cast.shapes) {
        if (s.t === 'ring') {
          castMesh(ringGeo(s.r, 4), c, 0.3, 2.2).position.set(s.x, 2.2, s.y);
        } else if (s.t === 'circle') {
          const f = castMesh(castGeo.disc, c, 0.24 * glow, 2.4); f.position.set(s.x, 2.4, s.y); f.scale.set(s.r, 1, s.r);
          castMesh(ringGeo(s.r, Math.min(8, s.r * 0.25)), c, 0.75 * glow, 2.5).position.set(s.x, 2.5, s.y);
        } else if (s.t === 'arrow') {
          const headL = Math.min(s.len * 0.5, Math.max(s.w * 0.7, 44)), headW = Math.max(s.w * 1.4, 56);
          const sh = castMesh(castGeo.shaft, c, 0.4 * glow, 2.6); sh.position.set(s.x, 2.6, s.y); sh.rotation.y = -s.a; sh.scale.set(s.len - headL, 1, s.w);
          const hd = castMesh(castGeo.head, c, 0.6 * glow, 2.7); hd.rotation.y = -s.a; hd.scale.set(headL, 1, headW);
          hd.position.set(s.x + Math.cos(s.a) * (s.len - headL), 2.7, s.y + Math.sin(s.a) * (s.len - headL));
        } else if (s.t === 'rect') {
          const m = castMesh(castGeo.plane, c, 0.45 * glow, 2.6); m.position.set(s.x, 2.6, s.y); m.rotation.y = -s.a; m.scale.set(s.len, 1, s.w);
        } else if (s.t === 'cone') {
          const m = castMesh(coneGeo(s.arc), c, 0.4 * glow, 2.6); m.position.set(s.x, 2.6, s.y); m.rotation.y = -s.a; m.scale.set(s.r, 1, s.r);
        }
      }
    }
    for (let i = castUsed; i < castPool.length; i++) castPool[i].visible = false;
  }

  // Dynamic resolution. When frames run slow but the game's own work per frame is light, the GPU is what
  // can't keep up, and fewer pixels is the one thing that helps: render at a lower pixel ratio, down to
  // 75%. With headroom again, step back up; a step up that doesn't hold doubles the wait before the
  // next try, so the scale settles instead of pulsing. Frames slow from the game's own work (CPU) leave
  // the resolution alone.
  const RES_MIN = 0.75, RES_STEP = 0.9, RES_WINDOW = 1.5;  // seconds per measurement
  let baseRatio = 1, resScale = 1, resN = 0, resT = 0, resCost = 0, resUpAt = 0, resWait = 8, resTrial = false;
  function adaptResolution(dt) {
    resN++; resT += dt; resCost += G.frameCost || 0;
    if (resT < RES_WINDOW) return;
    const frame = resT / resN, gpuBound = resCost / resN / 1000 < frame * 0.6;
    resN = 0; resT = 0; resCost = 0;
    const slow = frame > 1 / 48;
    if (slow && gpuBound && resScale > RES_MIN) {
      if (resTrial) resWait = Math.min(resWait * 2, 120);
      setResolution(Math.max(RES_MIN, resScale * RES_STEP));
      resTrial = false; resUpAt = time + resWait;
    } else if (resTrial && !slow) {
      resTrial = false; resWait = 8;  // the step up held
    } else if (!slow && frame < 1 / 57 && resScale < 1 && time > resUpAt) {
      setResolution(Math.min(1, resScale / RES_STEP));
      resTrial = true; resUpAt = time + resWait;
    }
  }
  function setResolution(s) {
    resScale = s;
    renderer.setPixelRatio(baseRatio * s);
    renderer.setSize(viewW, viewH, false);
  }

  // The moon's shadow box hugs the ground this view can see. Light space is orthographic along the
  // light, so a caster off screen whose shadow lands on screen projects inside the footprint too: the
  // four ground corners bound everything that matters. A fixed box big enough for the widest zoom took
  // in most of the map's armies, and every soldier in it cost a shadow-pass draw call.
  const lightView = new THREE.Matrix4(), lightUp = new THREE.Vector3(0, 1, 0), tmpS = new THREE.Vector3();
  const SHADOW_PAD = 160, SHADOW_SNAP = 64;
  function fitShadow(cam) {
    moon.position.set(cam.fx - 900, 1800, cam.fy - 1300);
    moon.target.position.set(cam.fx, 0, cam.fy);
    // Same view matrix the shadow camera builds for itself (camera lookAt from the light to its target).
    lightView.lookAt(moon.position, moon.target.position, lightUp).setPosition(moon.position).invert();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [sx, sy] of [[0, 0], [cam.w, 0], [cam.w, cam.h], [0, cam.h]]) {
      const w = cam.screenToWorld(sx, sy);
      tmpS.set(w.x, 0, w.y).applyMatrix4(lightView);
      x0 = Math.min(x0, tmpS.x); x1 = Math.max(x1, tmpS.x); y0 = Math.min(y0, tmpS.y); y1 = Math.max(y1, tmpS.y);
    }
    // Snapped outward so zooming doesn't resize the box (and shimmer the shadows) every frame.
    const snap = v => Math.ceil(v / SHADOW_SNAP) * SHADOW_SNAP;
    const sc = moon.shadow.camera;
    sc.left = -snap(SHADOW_PAD - x0); sc.right = snap(x1 + SHADOW_PAD);
    sc.bottom = -snap(SHADOW_PAD - y0); sc.top = snap(y1 + SHADOW_PAD);
    sc.updateProjectionMatrix();
  }

  // views: [{ cam, hero, hover, moveMarker, cast }], one per player. Split screen draws each into its camera's
  // rectangle of the canvas; the world is synced once and each view gets its own lighting, slot highlight
  // and markers (attack / demolish target, move click) for its own hero.
  R.render = function (views) {
    const now = performance.now();
    const dt = Math.min((now - lastT) / 1000, 0.1);
    lastT = now; time += dt;
    frameNo++;
    adaptResolution(dt);

    syncEntities(views[0].hero, dt);
    syncBases();
    syncFx(dt);
    updateDebris(dt);
    syncProjectiles();
    syncShots();
    syncCoins();
    syncParticles();

    cullBoxes.length = 0;
    for (const v of views) cullBoxes.push(viewGround(v.cam, CULL_PAD));

    const split = views.length > 1;
    renderer.setScissorTest(split);
    octx.clearRect(0, 0, viewW, viewH);
    for (const v of views) {
      const cam = v.cam, hero = v.hero;
      cam.apply();

      // Shadow frustum follows the view; fog scales with zoom.
      fitShadow(cam);
      scene.fog.near = cam.dist * 1.05;
      scene.fog.far = cam.dist * 2.3;
      syncLights(cam);
      paintSlots(hero, v.hover);

      const tgt = hero.attackTarget;
      targetRing.visible = !!tgt && !tgt.dead;
      if (targetRing.visible) {
        const pulse = 1 + Math.sin(time * 6) * 0.06;
        targetRing.position.set(tgt.x, 2, tgt.y);
        targetRing.scale.setScalar((tgt.r + 8) * pulse);
      }

      const dem = hero.demolishTarget;
      demolishRing.visible = !!dem && !dem.dead;
      if (demolishRing.visible) {
        demolishRing.position.set(dem.x, 2, dem.y);
        demolishRing.scale.setScalar(dem.r + 12);
      }

      drawCastPreview(v.cast);

      const mm = v.moveMarker;
      moveRing.visible = !!mm;
      if (mm) {
        const k = mm.t / 0.5;
        moveRing.position.set(mm.x, 2, mm.y);
        moveRing.scale.setScalar(1.4 * (1 - k * 0.6));
        moveRing.material.opacity = 1 - k;
      }

      if (split) {
        // WebGL counts rows from the bottom.
        const y = viewH - cam.y - cam.h;
        renderer.setViewport(cam.x, y, cam.w, cam.h);
        renderer.setScissor(cam.x, y, cam.w, cam.h);
      } else renderer.setViewport(0, 0, viewW, viewH);
     
      renderer.render(scene, cam.three);

      octx.save();
      octx.beginPath(); octx.rect(cam.x, cam.y, cam.w, cam.h); octx.clip();
      octx.translate(cam.x, cam.y);
      drawMarks(cam, hero);
      octx.restore();
    }
    drawSnow(dt);
  };
})(window.Game);
