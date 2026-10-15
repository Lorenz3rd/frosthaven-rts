// Model kit: shared helpers for building procedural Three.js models (heroes, race buildings and units,
// effects). Geometry from K.g and materials from K.m are cached and shared, so never mutate them
// (rotate/scale the mesh instead). K.mat makes a fresh material for anything animated per model.
(function (G) {
  const K = {};
  G.kit = K;

  K.TEAM_HEX = { [G.TEAM.PLAYER]: 0x2f5f96, [G.TEAM.ENEMY]: 0x8c1f18 };
  K.NEUTRAL_HEX = 0x4a4741;
  K.teamHex = team => K.TEAM_HEX[team] ?? K.NEUTRAL_HEX;
  // A brighter version of the team color for glowing trims.
  K.teamGlow = team => (team === G.TEAM.ENEMY ? 0xff5a40 : team === G.TEAM.PLAYER ? 0x5fa8ff : 0xb8a888);

  let glowTex = null;
  K.glowTex = function () {
    if (glowTex) return glowTex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    glowTex = new THREE.CanvasTexture(c);
    return glowTex;
  };

  K.mat = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.95, metalness: 0, flatShading: true }, o));
  const matCache = new Map();
  K.m = function (color, o) {
    const key = color + (o ? JSON.stringify(o) : '');
    let m = matCache.get(key);
    if (!m) { m = K.mat(color, o); matCache.set(key, m); }
    return m;
  };
  // Unlit (glowing) material, cached.
  K.lit = (color, o) => {
    const key = 'lit' + color + (o ? JSON.stringify(o) : '');
    let m = matCache.get(key);
    if (!m) { m = new THREE.MeshBasicMaterial(Object.assign({ color }, o)); matCache.set(key, m); }
    return m;
  };
  K.metal = (color, rough = 0.4) => K.m(color, { metalness: 0.65, roughness: rough });

  // Parts this small cast specks of shadow nobody can see; skipping them saves shadow-pass draw calls.
  const MIN_CASTER_R = 4;
  function castsShadow(m) {
    const g = m.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const s = m.scale;
    return g.boundingSphere.radius * Math.max(s.x, s.y, s.z) >= MIN_CASTER_R;
  }
  K.shadowed = obj => { obj.traverse(m => { if (m.isMesh) { m.castShadow = castsShadow(m); m.receiveShadow = true; } }); return obj; };

  // Point lights in the game world are virtual: models place these stand-ins where a light belongs and
  // the renderer lends the ones nearest the view a fixed pool of real PointLights each frame (see
  // syncLights in render3d.js). A fixed light count keeps per-pixel lighting cost flat, and stops
  // Three.js recompiling every material whenever an effect with a light comes or goes.
  // Set .intensity / .color / .distance like a PointLight.
  K.lights = new Set();
  K.light = function (color, intensity = 1, distance = 0, decay = 2) {
    const l = new THREE.Object3D();
    l.color = new THREE.Color(color);
    l.intensity = intensity; l.distance = distance; l.decay = decay;
    l.seen = false; l.idle = 0;
    K.lights.add(l);
    return l;
  };

  K.glow = function (color, size, opacity = 1) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: K.glowTex(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    s.scale.set(size, size, 1);
    return s;
  };

  // Concatenate geometries (position + normal) into one non-indexed geometry.
  K.merge = function (geos) {
    const parts = geos.map(g => (g.index ? g.toNonIndexed() : g));
    const n = parts.reduce((s, g) => s + g.attributes.position.count, 0);
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    let o = 0;
    for (const g of parts) {
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      o += g.attributes.position.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    return out;
  };

  // Collapse a model's static parts into one mesh per material. Every mesh is a draw call (twice, with
  // shadows), so a soldier drawn as 3 meshes instead of 16 is a big saving once armies are out.
  // Only direct child meshes of `root` merge: pivots (limbs, turrets) and anything in `keep` stay as they
  // are, so animate those, never a merged part. opts.cacheKey: models built identically under this key
  // share one merged geometry. opts.pieces: keep the merged-away meshes, detached, in
  // root.userData.pieces (crumble() flings them when a building falls). Merged meshes that own their
  // geometry are flagged userData.ownGeo so whoever removes them can dispose it.
  const mergeCache = new Map();
  function mergeGeos(list, names) {
    const parts = list.map(m => {
      m.updateMatrix();
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      return g.applyMatrix4(m.matrix);
    });
    const out = new THREE.BufferGeometry();
    for (const n of names) {
      const size = parts[0].attributes[n].itemSize;
      const arr = new Float32Array(parts.reduce((s, g) => s + g.attributes[n].array.length, 0));
      let o = 0;
      for (const g of parts) { arr.set(g.attributes[n].array, o); o += g.attributes[n].array.length; }
      out.setAttribute(n, new THREE.BufferAttribute(arr, size));
    }
    parts.forEach(g => g.dispose());
    out.computeBoundingSphere();
    return out;
  }
  K.mergeStatic = function (root, keep, opts = {}) {
    const groups = new Map();
    for (const m of root.children) {
      if (!m.isMesh || m.isInstancedMesh || m.children.length || !m.visible || keep.has(m) || Array.isArray(m.material)) continue;
      const a = m.geometry.attributes;
      if (!a.position || !a.normal || a.position.isInterleavedBufferAttribute) continue;
      m.updateMatrix();
      if (m.matrix.determinant() < 0) continue;  // mirrored: baking it in would flip the faces
      const k = m.material.id + '|' + m.castShadow + '|' + m.receiveShadow;
      let list = groups.get(k);
      if (!list) groups.set(k, list = []);
      list.push(m);
    }
    const cached = opts.cacheKey && mergeCache.get(opts.cacheKey);
    const built = [];
    let gi = 0;
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const mat0 = list[0].material;
      const names = ['position', 'normal', 'uv', 'color'].filter(n => list.every(m => m.geometry.attributes[n] && !m.geometry.attributes[n].isInterleavedBufferAttribute) &&
        list.every(m => m.geometry.attributes[n].itemSize === list[0].geometry.attributes[n].itemSize));
      if ((mat0.map && !names.includes('uv')) || (mat0.vertexColors && !names.includes('color'))) continue;
      let geo = cached && cached[gi];
      if (!geo) geo = mergeGeos(list, names);
      built.push(geo); gi++;
      const merged = new THREE.Mesh(geo, mat0);
      merged.castShadow = list[0].castShadow; merged.receiveShadow = list[0].receiveShadow;
      merged.userData.merged = true;
      if (!opts.cacheKey) merged.userData.ownGeo = true;
      for (const m of list) root.remove(m);
      root.add(merged);
      if (opts.pieces) (root.userData.pieces = root.userData.pieces || []).push(...list);
    }
    if (opts.cacheKey && !cached) mergeCache.set(opts.cacheKey, built);
    return root;
  };

  // Cached geometry constructors.
  const geoCache = new Map();
  const cached = (name, make) => (...args) => {
    const key = name + args.join(',');
    let g = geoCache.get(key);
    if (!g) { g = make(...args); geoCache.set(key, g); }
    return g;
  };
  K.g = {
    box: cached('b', (w, h, d) => new THREE.BoxGeometry(w, h, d)),
    cyl: cached('c', (rt, rb, h, seg = 8, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open)),
    sph: cached('s', (r, ws = 10, hs = 8) => new THREE.SphereGeometry(r, ws, hs)),
    // Partial sphere: phi = horizontal sweep, theta = from the top (half = dome).
    dome: cached('d', (r, ws = 12, hs = 6, theta = Math.PI / 2) => new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, theta)),
    cone: cached('k', (r, h, seg = 8) => new THREE.ConeGeometry(r, h, seg)),
    ico: cached('i', (r, d = 0) => new THREE.IcosahedronGeometry(r, d)),
    oct: cached('o', (r) => new THREE.OctahedronGeometry(r, 0)),
    dodec: cached('x', (r) => new THREE.DodecahedronGeometry(r, 0)),
    tet: cached('t', (r) => new THREE.TetrahedronGeometry(r, 0)),
    torus: cached('r', (r, tube, rs = 6, ts = 14, arc = Math.PI * 2) => new THREE.TorusGeometry(r, tube, rs, ts, arc)),
    plane: cached('p', (w, h, sw = 1, sh = 1) => new THREE.PlaneGeometry(w, h, sw, sh)),
    ring: cached('g', (r0, r1, seg = 48) => new THREE.RingGeometry(r0, r1, seg).rotateX(-Math.PI / 2)),
    disc: cached('q', (r, seg = 48) => new THREE.CircleGeometry(r, seg).rotateX(-Math.PI / 2))
  };

  // Add a mesh to `parent`. o: { rx, ry, rz, sx, sy, sz, s (uniform), shadow (default true) }.
  K.add = function (parent, geo, material, x = 0, y = 0, z = 0, o) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    if (o) {
      if (o.rx) m.rotation.x = o.rx;
      if (o.ry) m.rotation.y = o.ry;
      if (o.rz) m.rotation.z = o.rz;
      if (o.s) m.scale.setScalar(o.s);
      if (o.sx || o.sy || o.sz) m.scale.set(o.sx || 1, o.sy || 1, o.sz || 1);
    }
    if (!o || o.shadow !== false) { m.castShadow = castsShadow(m); m.receiveShadow = true; }
    parent.add(m);
    return m;
  };
  // A pivot group (for arms, turrets...).
  K.pivot = function (parent, x = 0, y = 0, z = 0) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    if (parent) parent.add(g);
    return g;
  };
  // A glow sprite placed in `parent`.
  K.addGlow = function (parent, color, size, x, y, z, opacity = 1) {
    const s = K.glow(color, size, opacity);
    s.position.set(x, y, z);
    parent.add(s);
    return s;
  };
  // A segmented limb from (0,0,0) down to (0,-len,0): returns the group.
  K.limb = function (parent, x, y, z, len, r0, r1, material) {
    const g = K.pivot(parent, x, y, z);
    K.add(g, K.g.cyl(r1, r0, len, 6), material, 0, -len / 2, 0);
    return g;
  };

  // Small team flag on a pole at (x, y, z): a common tag on every building.
  K.teamFlag = function (team, x, y, z) {
    const flag = new THREE.Mesh(K.g.plane(34, 22), K.m(K.teamHex(team), { side: THREE.DoubleSide }));
    flag.position.set(x, y + 5, z + 18);
    const fpole = new THREE.Mesh(K.g.cyl(1.5, 1.5, 50, 4), K.m(0x16100b)); fpole.position.set(x, y, z);
    return [flag, fpole];
  };

  // Buildings face the base center.
  K.placeInSlot = function (g, slot, base) {
    g.position.set(slot.x, 0, slot.y);
    g.rotation.y = -Math.atan2(base.y - slot.y, base.x - slot.x);
    g.scale.setScalar(0.95);
    return g;
  };

  // Officer aura: a glowing ground ring of world radius G.OFFICER_AURA under a model scaled by `scale`.
  K.aura = function (scale, color = 0xffd27a) {
    const R = G.OFFICER_AURA / scale;
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(K.g.ring(R - 4, R, 64), ringMat); ring.position.y = 1.5;
    const fillMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide });
    const fill = new THREE.Mesh(K.g.disc(R, 64), fillMat); fill.position.y = 1;
    const glow = K.glow(color, 70, 0.7); glow.position.y = 30;
    const aura = new THREE.Group(); aura.add(ring, fill, glow); aura.visible = false;
    aura.userData = { ringMat, fillMat };
    return aura;
  };

  // A ripple-able cloth plane (banners, capes). Returns { mesh, wave(time, amp) }.
  K.cloth = function (w, h, material, sw = 5, sh = 5) {
    const geo = new THREE.PlaneGeometry(w, h, sw, sh);
    const base = geo.attributes.position.array.slice();
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    return {
      mesh,
      wave(time, amp = 0.12, phase = 0) {
        const p = geo.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const x = base[i * 3] + w / 2;
          p.setZ(i, Math.sin(time * 3 + x * 0.12 + phase) * x * amp);
        }
        p.needsUpdate = true;
        geo.computeVertexNormals();
      }
    };
  };

  // Ease helpers for animation curves.
  K.ease = {
    // Wind up over the first `w` of the swing (k runs 1 -> 0), then strike: returns -1..1 style phase.
    // -1 at full wind-up, +1 at the moment of the strike, easing back to 0.
    windStrike(k, w = 0.35) {
      if (k <= 0) return 0;
      const u = 1 - k;
      if (u < w) return -u / w;
      const v = (u - w) / (1 - w);
      return v < 0.25 ? -1 + v / 0.25 * 2 : 1 - (v - 0.25) / 0.75;
    },
    // 0 -> 1 -> 0 bump over a swing
    bump: k => (k <= 0 ? 0 : Math.sin((1 - k) * Math.PI))
  };
})(window.Game);
