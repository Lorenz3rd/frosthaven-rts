// Hero models: nine procedurally built, animated mercenaries, plus the Boneshaper's summons.
// Each model faces +x with +y up (so +z is the hero's right side) and returns a Group whose
// userData.animate(u, e, time, dt) poses it every frame from the hero's state:
//   e.moving, e.swing (1 -> 0 basic attack), e.swingAlt, e.castAnim (1 -> 0) + e.castSlot (0-3),
//   e.form, e.state, e.lift, e.buffs. userData.flashMats tint red when hit.
// Limb pivots swing with rotation.z (positive = forward). Held tools hang along -y from the wrist and
// are pitched with aim(): 0 = pointing down, PI/2 = forward, PI = straight up.
(function (G) {
  const R = G.render3d, K = G.kit, g = K.g, add = K.add, pivot = K.pivot;
  const PI = Math.PI;
  const ease = K.ease;
  const lerp = G.lerp;
  const smoothTo = (u, key, target, rate = 0.25) => (u[key] = lerp(u[key] || 0, target, rate));

  // A jointed humanoid: legs with knees, a torso, a head pivot, arms with elbows and hand pivots.
  function humanoid(root, o) {
    const u = { legs: [], hipY: o.legLen };
    u.hips = pivot(root, 0, o.legLen, 0);
    for (const s of [-1, 1]) {
      const hip = pivot(root, 0, o.legLen, s * o.hipW);
      const upper = o.legLen * 0.52, lower = o.legLen * 0.48;
      add(hip, g.cyl(o.legR, o.legR * 0.85, upper, 7), o.legMat, 0, -upper / 2, 0);
      const knee = pivot(hip, 0, -upper, 0);
      add(knee, g.cyl(o.legR * 0.85, o.legR * 0.7, lower, 7), o.shinMat || o.legMat, 0, -lower / 2, 0);
      if (o.bootMat) add(knee, g.box(o.legR * 3.2, o.legR * 1.6, o.legR * 2.1), o.bootMat, o.legR * 0.7, -lower + o.legR * 0.7, 0);
      u.legs.push({ hip, knee });
    }
    u.torso = pivot(u.hips, 0, 0, 0);
    if (o.bodyMat) add(u.torso, g.cyl(o.chestR, o.waistR, o.torsoH, 10), o.bodyMat, 0, o.torsoH / 2, 0, { sx: o.depth || 0.75 });
    u.neck = pivot(u.torso, 0, o.torsoH + (o.neck || 3), 0);
    u.head = pivot(u.neck, 0, 0, 0);
    for (const s of [-1, 1]) {
      const sh = pivot(u.torso, 0, o.torsoH - o.armR * 1.3, s * o.shoulderW);
      const up = o.armLen * 0.5, lo = o.armLen * 0.5;
      add(sh, g.cyl(o.armR, o.armR * 0.9, up, 7), o.armMat, 0, -up / 2, 0);
      const elbow = pivot(sh, 0, -up, 0);
      add(elbow, g.cyl(o.armR * 0.9, o.armR * 0.75, lo, 7), o.foreMat || o.armMat, 0, -lo / 2, 0);
      const hand = pivot(elbow, 0, -lo, 0);
      if (o.handMat) add(hand, g.sph(o.armR * 1.05, 7, 6), o.handMat, 0, -o.armR * 0.5, 0);
      if (s < 0) { u.armL = sh; u.elbowL = elbow; u.handL = hand; } else { u.armR = sh; u.elbowR = elbow; u.handR = hand; }
    }
    return u;
  }

  // Legs stride while moving; returns the arm counter-swing (-1..1 scaled by stride).
  function walk(u, e, time, rate = 11, amp = 0.6) {
    const a = smoothTo(u, 'walkAmp', e.moving ? 1 : 0, 0.2);
    const ph = time * rate, s = Math.sin(ph);
    if (u.legs) u.legs.forEach((l, i) => {
      const v = i ? -s : s;
      l.hip.rotation.z = v * amp * a;
      l.knee.rotation.z = -Math.max(0, -v) * 1.0 * a;
    });
    u.hips.position.y = u.hipY + Math.abs(Math.cos(ph)) * 2.2 * a + Math.sin(time * 2) * 0.5 * (1 - a);
    return s * a;
  }
  // Pose an arm: shoulder swing (z), splay (x, outward positive for either side), elbow bend.
  function pose(arm, elbow, z, splay, bend, side) {
    arm.rotation.z = z; arm.rotation.x = splay * (side < 0 ? 1 : -1); elbow.rotation.z = bend;
  }
  // Pitch a held tool to a world angle (see header), compensating for the arm and elbow.
  function aim(tool, arm, elbow, worldPitch) { tool.rotation.z = worldPitch - arm.rotation.z - elbow.rotation.z; }
  // Blend helper for attack poses: 1 while a swing/cast plays, easing out after.
  const active = k => (k > 0 ? Math.min(1, k * 5) : 0);

  function finish(root, scale, animate, flashMats, extra) {
    root.scale.setScalar(scale);
    root.userData = Object.assign(root.userData || {}, { animate, flashMats }, extra);
    K.shadowed(root);
    return root;
  }

  // =============================================================================================
  // 1. BANNERSPEAR — plate-armored Human woman, bareheaded with a long braid, spear, kite shield and a
  //    war banner on the back
  // =============================================================================================
  R.HERO_MODELS.bannerspear = function (team) {
    const root = new THREE.Group();
    const plate = K.mat(0xa8b0ba, { metalness: 0.7, roughness: 0.32 });
    const gold = K.metal(0xd9a530, 0.3), leather = K.m(0x3a2a1e), dark = K.m(0x1a1512);
    const teamM = K.mat(K.teamHex(team), { side: THREE.DoubleSide });
    const skin = K.m(0xe2b294), hair = K.mat(0x7a3418, { flatShading: false, roughness: 0.75 });
    const u = humanoid(root, {
      legLen: 26, hipW: 4.6, legR: 3.2, legMat: plate, shinMat: plate, bootMat: dark,
      torsoH: 22, chestR: 10.5, waistR: 7, depth: 0.72, bodyMat: plate,
      shoulderW: 12, armLen: 22, armR: 2.9, armMat: leather, foreMat: plate, handMat: K.m(0x4a3a2a)
    });
    const T = u.torso;
    // Shaped breastplate with a gold ridge and trim, a cinched belt, a flared plate skirt and the team
    // tabard front and back.
    add(T, g.box(1.6, 9, 2.4), gold, 7, 9, 0);
    add(T, g.sph(5.4, 12, 8), plate, 4, 14.5, 0, { sx: 0.7, sy: 0.85, sz: 1.35 });
    add(T, g.torus(8.8, 1, 4, 16), gold, 0, 21, 0, { rx: PI / 2, sx: 0.75 });
    add(T, g.cyl(7.6, 7.6, 3, 10), leather, 0, 1.5, 0, { sx: 0.8 });
    add(T, g.box(3, 3, 4), gold, 6.4, 1.5, 0);
    add(T, g.cyl(7.6, 11.5, 11, 12, true), plate, 0, -4.5, 0, { sx: 0.8 });
    add(T, g.torus(11.3, 0.8, 4, 16), gold, 0, -10, 0, { rx: PI / 2, sx: 0.8 });
    add(T, g.box(0.8, 22, 10), teamM, 9.6, -6, 0);
    add(T, g.box(0.8, 22, 10), teamM, -9.4, -6, 0);
    add(T, g.box(0.9, 3, 10.4), gold, 9.8, -16, 0);
    add(T, g.cone(2.4, 6, 4), K.lit(0xffd060), 10.1, -4, 0, { rz: PI });   // spear emblem
    // Layered pauldrons with gold rims.
    for (const s of [-1, 1]) {
      add(T, g.dome(6.4, 10, 5), plate, 0, 19, s * 12.4, { rx: s * 0.4 });
      add(T, g.torus(6, 0.8, 4, 12), gold, 0, 19.3, s * 13, { rx: PI / 2 + s * 0.4 });
      add(T, g.dome(5, 10, 5), plate, 0, 16, s * 14.2, { rx: s * 0.7 });
    }
    add(T, g.cyl(4.6, 5.8, 3, 10), plate, 0, 22.5, 0);     // low gorget
    // Bare head: an oval face and auburn hair swept back into a long braid down her back.
    const H = u.head;
    add(H, g.cyl(2.2, 2.6, 4, 8), skin, 0, 1, 0);                                     // neck
    add(H, g.sph(4.6, 12, 10), skin, 0.5, 6.4, 0, { sx: 0.95, sy: 1.15, sz: 0.85 });  // face
    add(H, g.cone(0.8, 2, 4), skin, 4.8, 6.2, 0, { rz: -PI / 2 });                     // nose
    for (const z of [-1.6, 1.6]) {
      add(H, g.sph(0.65, 6, 5), K.m(0x2a1a14), 4.1, 7.3, z, { shadow: false });                // eyes
      add(H, g.box(0.5, 0.4, 1.7), hair, 4.2, 8.5, z * 1.05, { rx: z * 0.15, shadow: false });  // brows
    }
    add(H, g.box(0.6, 0.6, 1.8), K.m(0xb04a48), 4.55, 4.3, 0, { shadow: false });         // lips
    add(H, g.dome(5.1, 14, 8, PI * 0.5), hair, -0.6, 8.4, 0, { rz: 0.3, sx: 1.05, sz: 0.92, shadow: false });   // hair, swept back
    add(H, g.sph(4.8, 10, 8), hair, -1.8, 5.6, 0, { sx: 0.8, sy: 1.15, sz: 0.95 });      // back of the hair
    for (const z of [-1, 1]) add(H, g.box(3, 9.5, 1.2), hair, 0.8, 3.8, z * 4.1, { rz: -0.12 });  // long locks framing the face
    const braid = pivot(H, -4.6, 4.5, 1.2);
    for (let i = 0; i < 7; i++) add(braid, g.sph(1.9 - i * 0.12, 7, 6), hair, -i * 0.55, -i * 2.9, i * 0.25, { sy: 1.3 });
    add(braid, g.cyl(1.1, 1.1, 1.4, 8), gold, -4, -20, 1.8);
    add(braid, g.cone(1.2, 3.5, 6), hair, -4.1, -22.4, 1.8, { rz: PI });
    // Spear: ash shaft, gold collar, leaf blade, red tassel. Hangs along -y from the right hand.
    const spear = pivot(u.handR, 0, -2, 0);
    add(spear, g.cyl(1.1, 1.1, 96, 6), K.m(0x6b4a2a), 0, -22, 0);
    add(spear, g.cyl(1.8, 1.6, 4, 8), gold, 0, -70, 0);
    add(spear, g.oct(4.5), K.metal(0xd8dce2, 0.2), 0, -79, 0, { sy: 2.6, sz: 0.4 });
    add(spear, g.cone(1.2, 8, 4), K.m(0xc8302a), 0, -66, 1.6, { rz: PI });
    add(spear, g.sph(1.8, 6, 5), gold, 0, 26, 0);
    const tip = K.addGlow(spear, 0xffe08a, 22, 0, -82, 0, 0);
    // Kite shield on the left forearm: team field, gold rim and a spear sigil.
    const shield = pivot(u.elbowL, 1, -12, -3.5);
    add(shield, g.box(2, 20, 15), teamM, 0, 2, 0);
    add(shield, g.cone(7.5, 12, 4), teamM, 0, -12, 0, { rx: 0, ry: PI / 4, sx: 0.19, sz: 1.4, rz: PI });
    add(shield, g.box(2.4, 21, 1.2), gold, 0.2, 2, 7.6);
    add(shield, g.box(2.4, 21, 1.2), gold, 0.2, 2, -7.6);
    add(shield, g.box(2.4, 1.2, 15), gold, 0.2, 12.4, 0);
    add(shield, g.box(1, 14, 2), K.lit(0xffd060), 1.4, 1, 0);
    add(shield, g.box(1, 2, 8), K.lit(0xffd060), 1.4, 4, 0);
    // Back banner on a short pole.
    const back = pivot(T, -8, 8, 0);
    add(back, g.cyl(0.9, 0.9, 52, 6), K.m(0x4a3320), 0, 20, 0);
    add(back, g.cyl(0.7, 0.7, 20, 6), gold, 0, 44, 8, { rx: PI / 2 });
    add(back, g.cone(2, 5, 6), gold, 0, 47, 0);
    const flag = K.cloth(18, 24, teamM, 4, 4);
    flag.mesh.rotation.y = PI / 2; flag.mesh.position.set(0, 32, 9);
    back.add(flag.mesh);

    function animate(u, e, time) {
      const sw = walk(u, e, time);
      flag.wave(time, 0.18);
      const k = e.swing, c = e.castAnim, slot = e.castSlot;
      const atk = smoothTo(u, 'atk', k > 0 ? 1 : 0, 0.3);
      let armZ = lerp(0.35 - sw * 0.25, 0.9, atk), bend = lerp(0.55, 0.15, atk);
      let pitch = lerp(PI - 0.15, PI / 2 + 0.05, atk);
      let shZ = 0.45 + sw * 0.2, shBend = 0.95, lean = 0, lunge = 0;
      const ws = ease.windStrike(k);
      armZ += ws * 0.7; lean -= ws * 0.12; lunge += ws * 4;
      if (c > 0) {
        if (slot === 2) {
          // Unbreakable Wall: a shove behind the shield.
          const w = ease.windStrike(c, 0.3); shZ = 1.45; shBend = 0.25; lean = -0.3 * w; lunge = w * 10; armZ = 0.1;
        } else {
          // Banners (Q, W, R): raise the spear high, then drive it down to plant. The ultimate goes bigger.
          const b = ease.bump(c);
          armZ = lerp(0.35, 2.7, b); bend = 0.2; pitch = lerp(PI, 0.15, c < 0.5 ? (0.5 - c) * 2 : 0);
          lean = -0.15 * b * (slot === 3 ? 1.5 : 1);
          if (slot === 3) shZ = 0.45 + b * 0.6;
        }
      }
      pose(u.armR, u.elbowR, armZ, 0.15, bend, 1);
      pose(u.armL, u.elbowL, shZ, 0.25, shBend, -1);
      aim(spear, u.armR, u.elbowR, pitch);
      shield.rotation.z = -shZ - shBend + 1.5;
      u.torso.rotation.z = lean;
      u.hips.position.x = lunge;
      tip.material.opacity = Math.max(atk * 0.8, c > 0 ? 1 : 0);
      u.head.rotation.z = Math.sin(time * 1.3) * 0.03;
      // The braid hangs straight down whatever her lean, swinging with each stride.
      braid.rotation.z = -lean - u.head.rotation.z + (e.moving ? Math.sin(time * 11) * 0.12 : Math.sin(time * 1.7) * 0.03);
      braid.rotation.x = sw * 0.12;
    }
    return finish(root, 1.18, (_, e, t) => animate(u, e, t), [plate], { u });
  };

  // =============================================================================================
  // 2. BONESHAPER — robed Aesther necromancer: skull mask, bone crown, ribcage mantle, skull staff
  // =============================================================================================
  R.HERO_MODELS.boneshaper = function (team) {
    const root = new THREE.Group();
    const robe = K.mat(0x1c2620), bone = K.mat(0xe0dac4), dark = K.m(0x0c100e);
    const green = 0x9ff0b8, teamM = K.m(K.teamHex(team));
    const u = humanoid(root, {
      legLen: 30, hipW: 3.5, legR: 2.6, legMat: dark,
      torsoH: 24, chestR: 8, waistR: 6.5, depth: 0.7, bodyMat: robe,
      shoulderW: 10, armLen: 25, armR: 2.2, armMat: robe, foreMat: bone, handMat: bone
    });
    // Long robe skirt hiding the legs, with tattered strips that sway.
    const skirt = pivot(root, 0, 31, 0);
    add(skirt, g.cyl(7, 15, 31, 12, true), robe, 0, -15.5, 0);
    const strips = [];
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * PI * 2;
      const s = pivot(skirt, Math.cos(a) * 14, -29, Math.sin(a) * 14);
      add(s, g.box(1, 9, 4), i % 3 ? robe : teamM, 0, -4, 0, { ry: -a });
      strips.push(s);
    }
    const T = u.torso;
    // Ribcage mantle: bone arcs wrapping the chest, a spine down the back.
    for (let i = 0; i < 4; i++) add(T, g.torus(8.5 - i * 0.6, 0.9, 4, 12, PI * 1.3), bone, 1, 18 - i * 3.6, 0, { rx: PI / 2, rz: -PI * 0.65 });
    add(T, g.box(2, 3, 2), bone, 8, 18, 0);
    for (let i = 0; i < 7; i++) add(T, g.cyl(1.6, 1.6, 2.2, 6), bone, -7, 4 + i * 3, 0);
    // Skull pauldrons with spikes.
    for (const s of [-1, 1]) {
      add(T, g.sph(4.6, 8, 6), bone, 0, 22, s * 10.5);
      add(T, g.sph(1, 4, 3), dark, 3.6, 22.6, s * 10.5 + 1.6);
      add(T, g.sph(1, 4, 3), dark, 3.6, 22.6, s * 10.5 - 1.6);
      for (let k = 0; k < 3; k++) add(T, g.cone(1, 7, 4), bone, -2 + k * 2, 26, s * (12 + k), { rx: s * 0.6 });
    }
    // Team sash across the chest.
    add(T, g.box(1, 26, 3), teamM, 6.2, 12, 0, { rx: 0.7 });
    // Head: deep hood, skull mask with burning eyes, a crown of bone horns.
    const H = u.head;
    add(H, g.cone(9, 18, 10), robe, -1.5, 9, 0);
    add(H, g.sph(5.4, 10, 8), bone, 1.6, 5.5, 0, { sy: 1.15 });
    add(H, g.box(3, 3, 6), bone, 3.6, 1.2, 0);
    for (const z of [-2, 2]) {
      add(H, g.sph(1.5, 6, 5), dark, 5.6, 6.5, z, { shadow: false });
      add(H, g.sph(0.9, 6, 5), K.lit(green), 6.4, 6.5, z, { shadow: false });
    }
    const eyes = K.addGlow(H, green, 22, 7, 6.5, 0, 0.9);
    for (let i = 0; i < 7; i++) {
      const a = (i / 6 - 0.5) * 2.2;
      add(H, g.cone(1.1, 8 + (i % 2) * 5, 4), bone, -1 + Math.cos(a) * 1.5, 13, Math.sin(a) * 6.5, { rx: Math.sin(a) * 0.5, rz: 0.25 });
    }
    // Staff: black wood, ram skull head, hanging bone charms, a cold green flame.
    const staff = pivot(u.handR, 0, -2, 0);
    add(staff, g.cyl(1.4, 1.2, 110, 6), K.m(0x241a14), 0, -20, 0);
    const head = pivot(staff, 0, -78, 0);
    head.rotation.z = PI;   // skull upright when the staff points up
    add(head, g.sph(5, 8, 6), bone, 0, 0, 0, { sy: 0.9 });
    add(head, g.box(6, 4, 5), bone, 4, -2, 0);
    for (const z of [-1, 1]) add(head, g.torus(4.5, 1.3, 4, 10, PI * 1.4), bone, -1, 1, z * 5, { rx: 0, rz: -0.6 });
    for (const z of [-1.6, 1.6]) add(head, g.sph(1, 5, 4), K.lit(green), 4.6, 1, z, { shadow: false });
    const flame = K.addGlow(head, green, 40, 0, 7, 0, 0.95);
    const flame2 = K.addGlow(head, 0xffffff, 14, 0, 6, 0, 0.9);
    for (let i = 0; i < 3; i++) { const ch = pivot(staff, 0, -70, (i - 1) * 3); ch.rotation.z = PI; add(ch, g.cyl(0.3, 0.3, 8, 4), dark, 0, -4, 0); add(ch, g.sph(1.4, 5, 4), bone, 0, -8.5, 0); }
    // Left hand: necrotic glow for casting.
    const handGlow = K.addGlow(u.handL, green, 26, 0, -3, 0, 0.5);
    // Orbiting bone shards (always a few; a full ring while Back Again holds).
    const orbit = pivot(root, 0, 32, 0);
    const shards = [];
    for (let i = 0; i < 8; i++) {
      const s = pivot(orbit, 0, 0, 0);
      add(s, g.cone(1.8, 10, 4), bone, 0, 0, 0, { rz: PI / 2 });
      s.add(K.glow(green, 14, 0.6));
      shards.push(s);
    }

    function animate(u, e, time) {
      const sw = walk(u, e, time, 7, 0.35);
      strips.forEach((s, i) => { s.rotation.x = Math.sin(time * 3 + i) * 0.25 + (e.moving ? 0.3 : 0); });
      skirt.position.y = u.hips.position.y + 1;
      skirt.rotation.z = -sw * 0.05;
      const k = e.swing, c = e.castAnim, slot = e.castSlot;
      const ws = ease.windStrike(k);
      let rz = 0.25 + Math.max(0, ws) * 0.9, rb = 0.6 - Math.max(0, ws) * 0.4, pitch = PI - 0.1 - Math.max(0, ws) * 0.9;
      let lz = 0.2 - sw * 0.2, lb = 0.4, lean = -ws * 0.06;
      if (c > 0) {
        const b = ease.bump(c);
        if (slot === 0) { lz = 0.4 + b * 1.1; lb = 0.1; lean = -b * 0.15; }
        if (slot === 1) { lz = 0.3 + b * 1.6; rz = 0.3 + b * 1.6; rb = 0.2; lb = 0.2; pitch = PI; lean = 0.15 * b; }
        if (slot === 2) { lz = 1.0 * b; lb = 1.8 * b; rb = 1.2; }
        if (slot === 3) { lz = 0.4 + b * 2.4; rz = 0.4 + b * 2.4; rb = 0.1; lb = 0.1; pitch = PI; lean = 0.2 * b; }
      }
      pose(u.armR, u.elbowR, rz, 0.15, rb, 1);
      pose(u.armL, u.elbowL, lz, 0.2, lb, -1);
      aim(staff, u.armR, u.elbowR, pitch);
      u.torso.rotation.z = lean;
      head.rotation.y = time * 0.5;
      const f = 0.85 + Math.sin(time * 9) * 0.15;
      flame.scale.set(40 * f, 52 * f, 1); flame2.material.opacity = 0.6 + (k > 0 ? 0.4 : 0);
      handGlow.material.opacity = c > 0 ? 0.95 : 0.4 + Math.sin(time * 3) * 0.1;
      eyes.material.opacity = 0.7 + Math.sin(time * 5) * 0.2;
      // Bone orbit: lazy and sparse normally, a tight fast ring during Back Again.
      const armored = e.state.backAgain > 0;
      shards.forEach((s, i) => {
        const vis = armored || i < 3;
        s.visible = vis;
        const r = armored ? 20 : 15 + i * 2, a = time * (armored ? 4 : 1.2) + i / (armored ? 8 : 3) * PI * 2;
        s.position.set(Math.cos(a) * r, Math.sin(time * 2 + i) * 4, Math.sin(a) * r);
        s.rotation.y = -a;
      });
    }
    return finish(root, 1.25, (_, e, t) => animate(u, e, t), [robe, bone], { u });
  };

  // =============================================================================================
  // 3. DEATHWALKER — horned Valrath reaper: tattered cloak, tail, great scythe, soul lantern
  // =============================================================================================
  R.HERO_MODELS.deathwalker = function (team) {
    const root = new THREE.Group();
    const cloak = K.mat(0x14101c, { side: THREE.DoubleSide }), skin = K.mat(0x5a1414, { roughness: 0.7 }), horn = K.m(0x2a2220);
    const armor = K.metal(0x2a2a34, 0.45), violet = 0xb28cff, teamM = K.m(K.teamHex(team));
    const u = humanoid(root, {
      legLen: 28, hipW: 4.5, legR: 3, legMat: K.m(0x1a1418), bootMat: armor,
      torsoH: 23, chestR: 9.5, waistR: 7, depth: 0.72, bodyMat: armor,
      shoulderW: 11.5, armLen: 24, armR: 2.6, armMat: cloak, foreMat: skin, handMat: skin
    });
    const T = u.torso;
    // Cloak: a long open cone from the shoulders to the ankles, with a ragged hem.
    const cape = pivot(T, -2, 22, 0);
    add(cape, g.cyl(8, 17, 46, 12, true), cloak, -1, -23, 0, { sx: 0.9 });
    const hem = [];
    for (let i = 0; i < 12; i++) {
      const a = PI * 0.15 + i / 11 * PI * 1.7;
      const s = pivot(cape, Math.cos(a) * 16.5 - 1, -46, Math.sin(a) * 16.5);
      add(s, g.cone(2.2, 8, 3), cloak, 0, -3, 0, { rz: PI });
      hem.push(s);
    }
    // Violet rune trim and spiked pauldrons.
    add(T, g.torus(9.6, 0.6, 4, 16), K.lit(violet), 0, 6, 0, { rx: PI / 2, sx: 0.75 });
    add(T, g.box(1, 18, 2.2), K.lit(violet), 7.3, 12, 0);
    for (const s of [-1, 1]) {
      add(T, g.dome(6, 10, 5), armor, 0, 20, s * 12, { rx: s * 0.4 });
      for (let k = 0; k < 3; k++) add(T, g.cone(1.3, 7, 4), armor, -2 + k * 2.5, 24, s * 13.5, { rx: s * 0.5 });
    }
    add(T, g.box(1, 3, 10), teamM, 7.6, 2, 0);
    // Tail with a spade tip, swaying.
    const tail = pivot(u.hips, -6, 2, 0);
    let seg = tail;
    const tailSegs = [];
    for (let i = 0; i < 6; i++) {
      const s = pivot(seg, i ? -5 : 0, 0, 0);
      add(s, g.cyl(1.6 - i * 0.18, 1.8 - i * 0.18, 5.5, 6), skin, -2.5, 0, 0, { rz: PI / 2 });
      tailSegs.push(s); seg = s;
    }
    add(seg, g.oct(3), skin, -7, 0, 0, { sx: 1.4, sz: 0.4 });
    // Head: red face, glowing eyes, great curled horns, hood behind them.
    const H = u.head;
    add(H, g.sph(5.6, 10, 8), skin, 1, 5.5, 0, { sy: 1.1 });
    add(H, g.box(4, 2.5, 5), skin, 4.4, 2.6, 0);
    for (const z of [-2.1, 2.1]) add(H, g.sph(0.9, 6, 5), K.lit(violet), 5.8, 6.4, z, { shadow: false });
    const eyeGlow = K.addGlow(H, violet, 20, 6.5, 6.4, 0, 0.8);
    for (const s of [-1, 1]) {
      add(H, g.torus(5, 1.4, 5, 10, PI * 1.25), horn, -1, 11, s * 4.5, { ry: s * 0.4, rz: 0.6 });
      add(H, g.cone(1.3, 7, 5), horn, 4.5, 15.5, s * 5.5, { rz: -0.8 });
    }
    add(H, g.cone(8.5, 14, 10, true), cloak, -3, 7, 0, { rz: 0.5 });
    // Scythe: long black haft, curved blade with a glowing violet edge.
    const scythe = pivot(u.handR, 0, -2, 0);
    add(scythe, g.cyl(1.1, 1.3, 100, 6), K.m(0x1a1418), 0, -18, 0);
    const blade = pivot(scythe, 0, -66, 0);
    add(blade, g.torus(18, 1.8, 4, 16, PI * 0.75), armor, -2, 18, 0, { rz: PI * 1.15 });
    add(blade, g.torus(18, 0.7, 3, 16, PI * 0.75), K.lit(violet), -2, 18, 1.2, { rz: PI * 1.15, shadow: false });
    add(blade, g.cyl(2.4, 2.4, 5, 8), armor, 0, 0, 0);
    const edge = K.addGlow(blade, violet, 50, 10, 14, 0, 0);
    add(scythe, g.cone(1.5, 6, 4), armor, 0, 34, 0);
    // Soul lantern hanging from the left hand on a chain.
    const lantern = pivot(u.handL, 0, -2, 0);
    add(lantern, g.cyl(0.3, 0.3, 8, 4), armor, 0, -4, 0);
    const cage = pivot(lantern, 0, -11, 0);
    add(cage, g.cyl(3.5, 3.5, 7, 6, true), new THREE.MeshBasicMaterial({ color: 0x3a3048, wireframe: true }), 0, 0, 0, { shadow: false });
    add(cage, g.cone(4, 3, 6), armor, 0, 5, 0);
    add(cage, g.cyl(3.6, 3.6, 1, 6), armor, 0, -4, 0);
    const soul = K.addGlow(cage, violet, 26, 0, 0, 0, 1);
    K.addGlow(cage, 0xffffff, 8, 0, 0, 0, 1);
    // Shadows pooling around the feet.
    const shade = [];
    for (let i = 0; i < 5; i++) { const s = K.glow(0x4a2a8a, 30, 0.5); root.add(s); shade.push(s); }

    function animate(u, e, time) {
      const sw = walk(u, e, time, 10, 0.5);
      const k = e.swing, c = e.castAnim, slot = e.castSlot;
      const ws = ease.windStrike(k);
      // Basic: a one-handed backhand sweep of the scythe (torso twists through it).
      let rz = 0.35 + Math.abs(ws) * 0.9, rb = 0.5, pitch = PI - 0.25, twist = ws * 0.7, lean = 0;
      let lz = 0.35 - sw * 0.2, lb = 0.8;
      if (k > 0) pitch = PI / 2 + 0.3;
      if (c > 0) {
        const b = ease.bump(c), w = ease.windStrike(c, 0.3);
        if (slot === 0) { rz = 1.3; rb = 0.1; pitch = PI / 2 + 0.2; twist = w * 1.4; lean = -0.15 * b; }
        if (slot === 1) { lean = -0.4 * b; lz = -0.4 * b; rz = -0.3 * b; }
        if (slot === 2) { lz = 1.4 * b; lb = 0.1; }
        if (slot === 3) { rz = 0.3 + b * 2.6; rb = 0.1; pitch = PI * 0.9; lz = 0.3 + b * 1.5; lean = 0.2 * b; }
      }
      pose(u.armR, u.elbowR, rz, 0.15, rb, 1);
      pose(u.armL, u.elbowL, lz, 0.25, lb, -1);
      aim(scythe, u.armR, u.elbowR, pitch);
      lantern.rotation.z = -(u.armL.rotation.z + u.elbowL.rotation.z) + Math.sin(time * 2.4) * 0.25;
      u.torso.rotation.y = twist; u.torso.rotation.z = lean;
      cape.rotation.z = (e.moving ? 0.25 : 0.05) + Math.sin(time * 2) * 0.04;
      hem.forEach((s, i) => { s.rotation.x = Math.sin(time * 4 + i * 1.3) * 0.3; });
      tailSegs.forEach((s, i) => { s.rotation.y = Math.sin(time * 2 + i * 0.6) * 0.25; s.rotation.z = i ? -0.12 : -0.5; });
      edge.material.opacity = k > 0 || c > 0 ? 0.9 : 0.15;
      soul.material.opacity = 0.7 + Math.sin(time * 6) * 0.3;
      eyeGlow.material.opacity = 0.6 + Math.sin(time * 3) * 0.2;
      shade.forEach((s, i) => {
        const a = time * 0.8 + i * 1.26, f = (time * 0.6 + i * 0.2) % 1;
        s.position.set(Math.cos(a) * 14, 2 + f * 12, Math.sin(a) * 14);
        s.material.opacity = (1 - f) * 0.5;
      });
    }
    return finish(root, 1.25, (_, e, t) => animate(u, e, t), [skin, armor], { u });
  };

  // =============================================================================================
  // 4. GEMINATE — Harrower: a hooded, tattered violet robe over a body of crawling insects. Ranged form
  //    holds swarm-orbs and spreads its wing-cases; melee form closes the carapace, bares forearm claws
  //    and a stinger tail
  // =============================================================================================
  R.HERO_MODELS.geminate = function (team) {
    const root = new THREE.Group();
    const PINK = 0xff6fd0, VIOLET = 0xa46cff;
    const robe = K.mat(0x3a1a4e, { side: THREE.DoubleSide }), robeDk = K.mat(0x22102e, { side: THREE.DoubleSide });
    const chitin = K.mat(0x2a1438, { metalness: 0.5, roughness: 0.35 }), chitinHi = K.metal(0x5a2a6e, 0.3);
    const pinkM = K.lit(PINK), violetM = K.lit(VIOLET), teamM = K.m(K.teamHex(team));
    const u = humanoid(root, {
      legLen: 27, hipW: 4, legR: 2.4, legMat: chitin, shinMat: chitinHi,
      torsoH: 21, chestR: 8.5, waistR: 5.5, depth: 0.8, bodyMat: chitin,
      shoulderW: 10.5, armLen: 25, armR: 2.1, armMat: robe, foreMat: chitinHi
    });
    // Robe skirt to the ankles, its ragged hem in strips that sway.
    const skirt = pivot(root, 0, 28, 0);
    add(skirt, g.cyl(7, 14, 27, 12, true), robe, 0, -13.5, 0);
    const strips = [];
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * PI * 2;
      const s = pivot(skirt, Math.cos(a) * 13.5, -26, Math.sin(a) * 13.5);
      add(s, g.cone(2.4, 7, 3), i % 4 === 1 ? teamM : robeDk, 0, -3, 0, { rz: PI });
      strips.push(s);
    }
    const T = u.torso;
    // Segmented carapace chest with glowing pink seams, a team sash and an open robe over the shoulders.
    for (let i = 0; i < 4; i++) add(T, g.cyl(8.6 - i * 0.8, 8.8 - i * 0.8, 1.6, 10), chitinHi, 0, 5 + i * 4, 0, { sx: 0.82 });
    for (let i = 0; i < 3; i++) add(T, g.box(0.8, 1, 7 - i), pinkM, 7.1, 7 + i * 4, 0, { shadow: false });
    add(T, g.box(1, 26, 3), teamM, 6.4, 11, 0, { rx: 0.7 });
    const mantle = pivot(T, -1, 21, 0);
    add(mantle, g.cyl(9, 13, 18, 12, true), robe, -1, -8, 0, { sx: 0.85 });
    for (const s of [-1, 1]) add(T, g.dome(6, 10, 5), chitinHi, 0, 18, s * 11, { rx: s * 0.5, sx: 1.2 });
    // Wing-cases (elytra) on the back: spread in ranged form, folded shut over the back in melee form.
    const elytra = [];
    for (const s of [-1, 1]) {
      const e = pivot(T, -6, 20, s * 3);
      add(e, g.sph(7, 10, 8), chitin, -2, -9, 0, { sx: 0.5, sy: 1.6, sz: 0.9 });
      add(e, g.box(0.6, 18, 0.6), pinkM, -5.6, -9, 0, { shadow: false });
      elytra.push({ e, s });
    }
    // Stinger tail curling from under the robe (melee form only).
    const tail = pivot(u.hips, -6, -2, 0);
    let seg = tail;
    const tailSegs = [];
    for (let i = 0; i < 6; i++) {
      const s = pivot(seg, i ? -4.5 : 0, 0, 0);
      add(s, g.sph(3.2 - i * 0.3, 7, 6), i % 2 ? chitinHi : chitin, -2.2, 0, 0, { sx: 1.3 });
      tailSegs.push(s); seg = s;
    }
    add(seg, g.cone(1.6, 7, 5), pinkM, -7, 0, 0, { rz: PI / 2, shadow: false });
    // Head: a deep hood over an insect face — two huge glowing pink eyes, clicking mandibles, antennae.
    const H = u.head;
    add(H, g.sph(5.2, 12, 10), chitin, 1, 5, 0, { sx: 1.2, sy: 1.05 });
    add(H, g.cone(9, 17, 10, true), robe, -1.5, 8.5, 0, { rz: 0.35 });
    add(H, g.sph(8.4, 12, 8), robe, -2.5, 6, 0, { sx: 0.9, sy: 1.05 });
    for (const z of [-2.6, 2.6]) add(H, g.sph(2, 10, 8), K.lit(0xd0309a), 4.4, 6.2, z, { sx: 0.7, sy: 0.8, shadow: false });
    const eyes = K.addGlow(H, PINK, 16, 5, 6, 0, 0.7);
    const mands = [];
    for (const s of [-1, 1]) { const m = pivot(H, 5, 1.5, s * 1.8); add(m, g.cone(1, 6, 4), chitinHi, 2.5, 0, 0, { rz: -PI / 2 }); mands.push({ m, s }); }
    const ants = [];
    for (const s of [-1, 1]) {
      const a = pivot(H, 4, 9, s * 2.4);
      add(a, g.cyl(0.35, 0.35, 14, 4), chitinHi, 0, 7, 0);
      add(a, g.sph(0.9, 5, 4), violetM, 0, 14, 0, { shadow: false });
      ants.push({ a, s });
    }
    // Hands: swarm-orbs (ranged form) and hooked chitin claws (melee form).
    const orbs = [], claws = [];
    for (const [hand, col] of [[u.handL, VIOLET], [u.handR, PINK]]) {
      const orb = pivot(hand, 2, -6, 0);
      add(orb, g.ico(3, 1), K.lit(0xffffff), 0, 0, 0, { shadow: false });
      orb.add(K.glow(col, 34, 0.95));
      orbs.push(orb);
      const claw = pivot(hand, 0, -1, 0);
      add(claw, g.cone(2.4, 24, 4), chitinHi, 0, -12, 0, { rx: PI, sz: 0.35 });
      add(claw, g.box(0.6, 20, 0.6), pinkM, 1.5, -11, 0, { shadow: false });
      add(claw, g.cone(1.4, 9, 4), chitinHi, 3, -22, 0, { rz: 2.2 });
      claws.push(claw);
    }
    // The swarm: dark beetles crawling around the body and pink/violet motes, wider in ranged form.
    const beetleMat = new THREE.SpriteMaterial({ map: K.glowTex(), color: 0x1a0a22, transparent: true, opacity: 0.95, depthWrite: false });
    const bugs = [];
    for (let i = 0; i < 18; i++) {
      const s = i % 3 ? new THREE.Sprite(beetleMat) : K.glow(i % 2 ? PINK : VIOLET, 8, 0.9);
      if (i % 3) s.scale.setScalar(3 + (i % 4));
      root.add(s); bugs.push(s);
    }
    const shellGlow = K.addGlow(T, PINK, 70, 0, 12, 0, 0);

    function animate(u, e, time) {
      const sw = walk(u, e, time, 10, 0.45);
      const melee = e.form === 'melee';
      const k = e.swing, c = e.castAnim, slot = e.castSlot;
      const ws = ease.windStrike(k);
      let lz = 0.4 - sw * 0.3, rz = 0.4 + sw * 0.3, lb = 0.8, rb = 0.8, twist = 0, lean = 0;
      if (melee) {
        // Claws cocked out, a crossing double rake.
        lz = 0.8; rz = 0.8; lb = 1.1; rb = 1.1; lean = -0.12;
        if (k > 0) { lz = 1.1 + ws * 0.8; rz = 1.1 + ws * 0.8; lb = 0.4 - ws * 0.3; rb = 0.4 - ws * 0.3; twist = (e.swingAlt ? 1 : -1) * ws * 0.6; lean = -ws * 0.1 - 0.12; }
      } else if (k > 0) {
        // Alternate hands thrust forward to loose the swarm.
        const lift = 1.1 + ws * 0.5;
        if (e.swingAlt) { lz = lift; lb = 0.1; } else { rz = lift; rb = 0.1; }
      }
      let spin = 0;
      if (c > 0) {
        const b = ease.bump(c);
        if (slot === 0) {
          if (melee) spin = (1 - c) * PI * 2;   // Tailspin: one full turn
          else { rz = 0.6 + b * 1.4; rb = 0.1; twist = lerp(-1, 1.1, 1 - c); }   // Drag Down: a wide raking sweep
        }
        if (slot === 1) {
          if (melee) { lean = -0.45 * b; lz = rz = 1.3 * b; lb = rb = 1.8 * b; }   // Tough Carapace: hunker behind the shell
          else { lz = rz = 0.5 + b * 1.4; lb = rb = 0.1; lean = -0.15 * b; }        // Swarm: fling both hands forward
        }
        if (slot === 2) { lz = rz = 0.3 + b * 2.4; lb = rb = 0.1; }
        if (slot === 3) { lean = -0.6 * b; lz = rz = -0.6 * b; lb = rb = 0.3; }
      }
      pose(u.armL, u.elbowL, lz, 0.35, lb, -1);
      pose(u.armR, u.elbowR, rz, 0.35, rb, 1);
      u.torso.rotation.y = twist; u.torso.rotation.z = lean;
      u.hips.rotation.y = spin;
      skirt.position.y = u.hips.position.y + 1;
      skirt.rotation.z = -sw * 0.05;
      skirt.rotation.y = spin;
      strips.forEach((s, i) => { s.rotation.x = Math.sin(time * 3 + i) * 0.25 + (e.moving || spin ? 0.3 : 0); });
      mantle.rotation.z = (e.moving ? 0.15 : 0.03) + Math.sin(time * 2) * 0.03;
      orbs.forEach((o, i) => { o.visible = !melee; o.position.y = -6 + Math.sin(time * 4 + i * 3) * 1.2; o.rotation.y = time * 3; });
      claws.forEach(cl => { cl.visible = melee; cl.rotation.z = 0.3; });
      // Wing-cases: spread and buzzing in ranged form, folded down over the back in melee form.
      const open = smoothTo(u, 'open', melee ? 0 : 1, 0.15);
      elytra.forEach(({ e: el, s }) => {
        const buzz = open * Math.sin(time * (e.moving || c > 0 ? 38 : 5)) * 0.06;
        el.rotation.x = s * (0.15 + open * 0.55 + buzz); el.rotation.z = -0.1 - open * 0.25;
      });
      tail.visible = melee;
      tailSegs.forEach((s, i) => { s.rotation.y = Math.sin(time * 2.5 + i * 0.6) * 0.2 + (spin ? 0.25 : 0); s.rotation.z = i ? 0.32 : -0.3; });
      mands.forEach(({ m, s }) => { m.rotation.y = s * (0.3 + Math.abs(Math.sin(time * 5)) * 0.3); });
      ants.forEach(({ a, s }) => { a.rotation.x = s * (0.4 + Math.sin(time * 3 + s) * 0.15); a.rotation.z = -0.5; });
      eyes.material.opacity = 0.7 + Math.sin(time * 4) * 0.2;
      shellGlow.material.opacity = e.state && e.state.carapace > 0 ? 0.35 + Math.sin(time * 8) * 0.15 : 0;
      // Swarm: a loose cloud in ranged form, crawling close over the body in melee form; bursts out on a swap.
      const burst = c > 0 && slot === 2 ? ease.bump(c) : 0;
      bugs.forEach((s, i) => {
        const a = time * (1.4 + (i % 5) * 0.15) * (i % 2 ? 1 : -1) + i * 0.7;
        const r = (melee ? 11 : 18 + (i % 3) * 6) + burst * 30;
        s.position.set(Math.cos(a) * r, 12 + ((i * 7) % 40) + Math.sin(time * 3 + i) * 6, Math.sin(a) * r);
      });
    }
    return finish(root, 1.24, (_, e, t) => animate(u, e, t), [chitin, robe], { u });
  };

  // =============================================================================================
  // 5. BLINKBLADE — tiny Quatryl duelist: goggles, chrono-engine backpack, glowing saber, scarf
  // =============================================================================================
  R.HERO_MODELS.blinkblade = function (team) {
    const root = new THREE.Group();
    const BLUE = 0x8fdcff;
    const coat = K.mat(0x5a3a22), skin = K.m(0xc8a080), brass = K.metal(0xc89a40, 0.3), steel = K.metal(0x8a9098, 0.35);
    const teamM = K.mat(K.teamHex(team), { side: THREE.DoubleSide });
    const u = humanoid(root, {
      legLen: 18, hipW: 3.6, legR: 2.4, legMat: K.m(0x2a2a30), bootMat: K.m(0x3a2418),
      torsoH: 16, chestR: 7, waistR: 6.5, depth: 0.8, bodyMat: coat,
      shoulderW: 8, armLen: 17, armR: 2, armMat: coat, handMat: K.m(0x3a2418)
    });
    const T = u.torso;
    // Coat details: brass buttons, belt with pouches, a team sash.
    for (let i = 0; i < 3; i++) add(T, g.sph(0.8, 5, 4), brass, 5.4, 5 + i * 3.5, 0);
    add(T, g.cyl(6.8, 6.8, 2, 10), K.m(0x2a1a10), 0, 1, 0, { sx: 0.85 });
    for (const z of [-4, 4]) add(T, g.box(2.5, 3, 2.5), K.m(0x4a2e18), 3, 0, z);
    add(T, g.box(1, 18, 2.4), teamM, 5.8, 8, 0, { rx: -0.6 });
    // Chrono-engine backpack: brass drum, glowing core, spinning gear rings, exhaust pipes.
    const pack = pivot(T, -8, 10, 0);
    add(pack, g.cyl(5, 5, 13, 12), brass, 0, 0, 0);
    add(pack, g.cyl(3, 3, 13.4, 12), K.lit(BLUE), 0, 0, 0, { shadow: false });
    const core = K.addGlow(pack, BLUE, 36, -2, 0, 0, 0.8);
    const gears = [];
    for (const [y, r, s] of [[4, 7, 1], [-3, 6, -1]]) {
      const gr = pivot(pack, 0, y, 0);
      add(gr, g.torus(r, 0.9, 4, 18), brass, 0, 0, 0, { rx: PI / 2 });
      for (let i = 0; i < 10; i++) { const a = i / 10 * PI * 2; add(gr, g.box(1.6, 1.4, 1.6), brass, Math.cos(a) * (r + 1), 0, Math.sin(a) * (r + 1)); }
      gears.push({ gr, s });
    }
    for (const z of [-3, 3]) { add(pack, g.cyl(1, 1.2, 10, 6), steel, -3, 9, z); add(pack, g.cyl(1.5, 1, 2, 6), steel, -3, 14, z); }
    const pend = pivot(pack, -5.5, -5, 0);
    add(pend, g.cyl(0.3, 0.3, 6, 4), brass, 0, -3, 0); add(pend, g.sph(1.4, 6, 5), K.lit(BLUE), 0, -6.5, 0, { shadow: false });
    // Big head: fluffy hair, long ears, brass goggles with glowing lenses.
    const H = u.head;
    add(H, g.sph(6.5, 12, 10), skin, 1, 5, 0);
    add(H, g.sph(1.6, 6, 5), skin, 7.2, 4, 0);
    for (const s of [-1, 1]) add(H, g.cone(1.8, 9, 5), skin, -1, 7, s * 7, { rx: s * -1.2, rz: 0.4 });
    // Black hood with a blue lining and trim, tilted forward so its brim hangs just over the goggles.
    const HOOD_R = 7.8, HOOD_T = PI * 0.72;
    const hood = pivot(H, 1, 5.2, 0); hood.rotation.z = 1.1;
    add(hood, g.dome(HOOD_R, 14, 9, HOOD_T), K.m(0x16161c), 0, 0, 0);
    add(hood, g.dome(HOOD_R - 0.4, 14, 9, HOOD_T), K.m(0x1e3f9a, { side: THREE.BackSide }), 0, 0, 0, { shadow: false });
    add(hood, g.torus(HOOD_R * Math.sin(HOOD_T), 0.7, 4, 18), K.m(0x2a5ad0), 0, HOOD_R * Math.cos(HOOD_T), 0, { rx: PI / 2 });
    add(hood, g.torus(HOOD_R + 0.1, 0.45, 4, 18, PI * 0.7), K.m(0x2a5ad0), 0, 0, 0, { rz: PI * 0.15 });
    add(hood, g.cone(2.6, 6, 6), K.m(0x16161c), -1.5, HOOD_R + 1, 0, { rz: 0.5 });
    for (const z of [-2.6, 2.6]) {
      add(H, g.cyl(2.2, 2.2, 2.4, 10), brass, 6.6, 6.8, z, { rz: PI / 2 });
      add(H, g.cyl(1.7, 1.7, 2.6, 10), K.lit(BLUE), 6.8, 6.8, z, { rz: PI / 2, shadow: false });
    }
    const lens = K.addGlow(H, BLUE, 20, 8.4, 6.8, 0, 0.7);
    // Saber in the right hand (blue edge), time gauntlet with a clock dial on the left.
    const saber = pivot(u.handR, 0, -1, 0);
    add(saber, g.box(1.6, 3, 4), brass, 0, 0, 0);
    add(saber, g.torus(2.2, 0.5, 4, 10, PI), brass, 0, -1, 2, { rx: PI / 2 });
    add(saber, g.box(0.8, 26, 2.2), steel, 0, -15, 0, { rz: 0.06 });
    add(saber, g.box(0.5, 24, 0.6), K.lit(BLUE), 0.6, -15, 1.2, { shadow: false });
    const saberGlow = K.addGlow(saber, BLUE, 30, 0, -16, 0, 0.3);
    add(u.elbowL, g.cyl(3, 2.6, 8, 10), brass, 0, -6, 0);
    add(u.elbowL, g.cyl(2.2, 2.2, 1, 12), K.lit(0xf4f0e0), 0, -6, 2.8, { rx: PI / 2, shadow: false });
    const hand = pivot(u.elbowL, 0, -6, 3.4); add(hand, g.box(0.3, 1.8, 0.3), K.m(0x1a1a1a), 0, 0.9, 0, { shadow: false });
    // Long scarf trailing from the neck.
    const scarf = K.cloth(22, 4, teamM, 6, 1);
    scarf.mesh.position.set(-11, 17, 0);
    T.add(scarf.mesh);
    add(T, g.torus(4, 1.4, 4, 12), teamM, 0, 16.5, 0, { rx: PI / 2 });

    function animate(u, e, time) {
      const fast = e.buffs.goFast || e.buffs.speedUp ? 1 : 0;
      const sw = walk(u, e, time, 15 + fast * 6, 0.7);
      const k = e.swing, c = e.castAnim, slot = e.castSlot;
      const ws = ease.windStrike(k, 0.25);
      const dir = e.swingAlt ? 1 : -1;
      let rz = 0.6 - sw * 0.4, rb = 0.6, pitch = PI / 2 + 0.6, lz = 0.4 + sw * 0.4, lb = 0.7, twist = 0, lean = -0.1;
      if (k > 0) { rz = 1.2 + ws * 0.5; rb = 0.2; pitch = PI / 2 - dir * ws * 0.9; twist = dir * ws * 0.6; lean = -0.2; }
      if (c > 0) {
        const b = ease.bump(c);
        if (slot === 0) { rz = 1.4; rb = 0; pitch = PI / 2 - 0.3; lean = -0.4 * b; }
        if (slot === 1) { lz = 0.4 + b * 1.4; lb = 1.6 * b; }
        if (slot === 2) { lz = 1.2 * b; lb = 0.3; u.torso.rotation.y = -c * PI * 2; }
        if (slot === 3) { rz = 1.4; pitch = PI / 2 + Math.sin(time * 40) * 0.8; lean = -0.3; }
      }
      pose(u.armR, u.elbowR, rz, 0.2, rb, 1);
      pose(u.armL, u.elbowL, lz, 0.2, lb, -1);
      aim(saber, u.armR, u.elbowR, pitch);
      if (!(c > 0 && slot === 2)) u.torso.rotation.y = twist;
      u.torso.rotation.z = lean;
      gears.forEach(({ gr, s }) => { gr.rotation.y += s * (0.05 + fast * 0.25 + (c > 0 ? 0.2 : 0)); });
      pend.rotation.x = Math.sin(time * 4) * 0.5;
      core.material.opacity = 0.6 + fast * 0.4 + Math.sin(time * 8) * 0.1;
      saberGlow.material.opacity = k > 0 || c > 0 ? 0.9 : 0.3;
      lens.material.opacity = 0.6 + fast * 0.4;
      scarf.wave(time * (e.moving ? 3 : 1), e.moving ? 0.25 : 0.1);
      scarf.mesh.rotation.z = e.moving ? 0.6 : 1.2;
      hand.rotation.z = -time * 2;
    }
    return finish(root, 1.42, (_, e, t) => animate(u, e, t), [coat], { u });
  };

  // =============================================================================================
  // 6. CRUSHING TIDE — Lurker crab-knight: coral-crusted carapace, crusher claw, six scuttling legs
  // =============================================================================================
  R.HERO_MODELS.crushingtide = function (team) {
    const root = new THREE.Group();
    const AQUA = 0x5fe0e8;
    const shell = K.mat(0x2a5a6a, { metalness: 0.35, roughness: 0.4 }), shellHi = K.m(0x4a8a96, { metalness: 0.3, roughness: 0.4 });
    const under = K.m(0xc8b090), coral = K.m(0xff8a7a), coral2 = K.m(0xffb060), teamM = K.m(K.teamHex(team));
    const body = pivot(root, 0, 27, 0);
    // Carapace: a broad domed shell with ridge spikes, team-colored bands and coral growths.
    add(body, g.sph(18, 14, 10), shell, 0, 4, 0, { sx: 1.1, sy: 0.75, sz: 1.25 });
    add(body, g.sph(15, 12, 8), under, 2, -3, 0, { sx: 1.1, sy: 0.5, sz: 1.15 });
    for (let i = 0; i < 5; i++) add(body, g.cone(2.4, 9 - Math.abs(i - 2), 5), shellHi, -10 + i * 5, 16 - Math.abs(i - 2) * 1.5, 0, { rz: 0.2 });
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) add(body, g.cone(1.8, 7, 4), shellHi, -8 + i * 8, 8, s * 19, { rx: s * 1.3 });
      add(body, g.torus(15, 1.2, 4, 18, PI * 0.8), teamM, 0, 6, s * 4, { rx: PI / 2 + s * 0.35, rz: PI * 0.1 });
    }
    for (let i = 0; i < 6; i++) {
      const c = pivot(body, -12 + (i % 3) * 4, 14, (i < 3 ? -1 : 1) * (6 + (i % 2) * 5));
      add(c, g.cyl(0.8, 1.2, 7, 5), i % 2 ? coral : coral2, 0, 3.5, 0, { rz: 0.3 });
      add(c, g.cyl(0.6, 0.8, 5, 5), i % 2 ? coral : coral2, 1.5, 7, 1.5, { rx: 0.6 });
      add(c, g.sph(1.2, 5, 4), i % 2 ? coral2 : coral, 1, 10, 0);
    }
    for (let i = 0; i < 8; i++) add(body, g.cyl(1.4, 1.8, 1.6, 6), K.m(0xd8d0c0), -14 + Math.random() * 20, 12 + Math.random() * 3, (Math.random() - 0.5) * 24);
    // Head: eye stalks and twitching mouthparts at the front.
    const head = pivot(body, 18, 2, 0);
    add(head, g.sph(5, 8, 6), shell, 0, 0, 0, { sx: 0.8 });
    const stalks = [];
    for (const s of [-1, 1]) {
      const st = pivot(head, 1, 3, s * 3);
      add(st, g.cyl(0.8, 1, 8, 5), shellHi, 0, 4, 0);
      add(st, g.sph(1.8, 7, 6), K.lit(AQUA), 0, 8.5, 0, { shadow: false });
      st.add(K.glow(AQUA, 16, 0.8)); st.children[2].position.y = 8.5;
      stalks.push({ st, s });
    }
    const mouth = [];
    for (const s of [-1, 1]) { const m = pivot(head, 4, -2, s * 1.5); add(m, g.box(4, 1, 1), under, 2, 0, 0); mouth.push({ m, s }); }
    // Six walking legs.
    const legs = [];
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
      const hip = pivot(body, 8 - i * 9, -2, s * 15);
      hip.rotation.y = (i - 1) * 0.45 * s;
      add(hip, g.cyl(1.8, 2.4, 18, 6), shell, 0, 4.5, s * 7.5, { rx: s * (PI / 2 - 0.55) });
      const knee = pivot(hip, 0, 9, s * 15);
      add(knee, g.sph(2.4, 7, 6), shellHi, 0, 0, 0);
      add(knee, g.cyl(1.1, 1.9, 30, 6), shellHi, 0, -14, s * 6, { rx: -s * 0.42 });
      add(knee, g.cone(1.1, 6, 5), K.m(0x1a3a44), 0, -30, s * 12.5, { rx: PI - s * 0.42 });
      for (let k = 0; k < 3; k++) add(knee, g.cone(0.7, 3, 4), shellHi, -1, -5 - k * 7, s * (3 + k * 2.6), { rz: 1.2 });
      legs.push({ hip, knee, s, i });
    }
    // Crusher claw (right, huge) and pincer (left, small). Arm pivots swing on z.
    function claw(side, size) {
      const sh = pivot(body, 12, 4, side * 16);
      add(sh, g.cyl(3 * size, 3.6 * size, 14 * size, 7), shell, 4 * size, -2, 0, { rz: -1.2 });
      const elbow = pivot(sh, 11 * size, -6 * size, 0);
      add(elbow, g.cyl(3 * size, 3.4 * size, 12 * size, 7), shellHi, 4 * size, 0, 0, { rz: -PI / 2 });
      const palm = pivot(elbow, 11 * size, 0, 0);
      add(palm, g.sph(5.5 * size, 10, 8), shell, 4 * size, 0, 0, { sx: 1.4, sz: 0.9 });
      add(palm, g.cone(3.6 * size, 14 * size, 6), shellHi, 13 * size, 2 * size, 0, { rz: -PI / 2 - 0.15 });
      for (let i = 0; i < 4; i++) add(palm, g.cone(0.9 * size, 2.6 * size, 4), under, 8 * size + i * 2.5 * size, 0.6 * size, 0, { rz: PI });
      const finger = pivot(palm, 6 * size, -2.5 * size, 0);
      add(finger, g.cone(2.8 * size, 13 * size, 6), shellHi, 6 * size, 0, 0, { rz: -PI / 2 + 0.2 });
      if (size > 1) add(palm, g.torus(5.5 * size, 0.8, 4, 12), teamM, 2 * size, 0, 0, { ry: PI / 2 });
      return { sh, elbow, palm, finger };
    }
    const big = claw(1, 1.35), small = claw(-1, 0.85);
    const drips = [];
    for (let i = 0; i < 4; i++) { const s = K.glow(AQUA, 8, 0.8); root.add(s); drips.push(s); }

    function animate(u, e, time) {
      const a = smoothTo(u, 'walkAmp', e.moving ? 1 : 0, 0.2);
      legs.forEach(l => {
        const ph = time * 14 + l.i * 2.1 + (l.s > 0 ? PI : 0);
        l.hip.rotation.y = (l.i - 1) * 0.45 * l.s + Math.sin(ph) * 0.35 * a;
        l.knee.rotation.x = l.s * (Math.max(0, Math.cos(ph)) * 0.35 * a);
      });
      body.position.y = 27 + Math.abs(Math.sin(time * 14)) * 1.5 * a + Math.sin(time * 1.8) * 0.8;
      const k = e.swing, c = e.castAnim, slot = e.castSlot;
      const ws = ease.windStrike(k, 0.4);
      // Crusher: raise high on the wind-up, slam down on the strike.
      let bz = 0.1 - ws * 0.9, bOpen = k > 0 ? (ws < 0 ? 0.6 : 0.05) : 0.15 + Math.sin(time * 2) * 0.05;
      let sz = 0.1 + Math.sin(time * 1.5) * 0.1, sOpen = 0.3 + Math.sin(time * 3) * 0.2, twist = 0, lean = ws * 0.08;
      if (c > 0) {
        const b = ease.bump(c), w = ease.windStrike(c, 0.3);
        if (slot === 0) { bz = 0.3; twist = w * 0.9; bOpen = 0.5; }
        if (slot === 1) { lean = -0.15 * b; bz = 0.6 * b; sz = 0.6 * b; }
        if (slot === 2) { bz = -0.5 * b; sz = -0.5 * b; bOpen = sOpen = 0.6 * b; }
        if (slot === 3) { bz = 1.2 * b; sz = 1.2 * b; lean = 0.2 * b; bOpen = sOpen = 0.6; }
      }
      big.sh.rotation.z = bz; small.sh.rotation.z = sz;
      big.elbow.rotation.z = bz * 0.4;
      big.finger.rotation.z = -bOpen; small.finger.rotation.z = -sOpen;
      body.rotation.y = twist; body.rotation.z = lean;
      stalks.forEach(({ st, s }) => { st.rotation.x = s * (0.25 + Math.sin(time * 2.5 + s) * 0.15); });
      mouth.forEach(({ m, s }) => { m.rotation.y = s * Math.abs(Math.sin(time * 6)) * 0.4; });
      drips.forEach((s, i) => {
        const f = (time * 0.8 + i * 0.25) % 1;
        s.position.set(-10 + i * 7, 40 - f * 36, (i % 2 ? 1 : -1) * 18);
        s.material.opacity = (1 - f) * 0.7;
      });
    }
    const st = {};
    return finish(root, 1.60, (_, e, t) => animate(st, e, t), [shell, shellHi], {});
  };

  // =============================================================================================
  // 7. TRAPPER — Vermling rat-folk hunter: hooded, whiskered, repeating crossbow, traps on the back
  // =============================================================================================
  R.HERO_MODELS.trapper = function (team) {
    const root = new THREE.Group();
    const fur = K.mat(0x6a5a4a), furDark = K.m(0x4a3e34), leather = K.m(0x4a3220), pink = K.m(0xd89090);
    const steel = K.metal(0x7a7e84, 0.45), teamM = K.mat(K.teamHex(team), { side: THREE.DoubleSide });
    const u = humanoid(root, {
      legLen: 19, hipW: 3.6, legR: 2.6, legMat: fur, shinMat: furDark, bootMat: leather,
      torsoH: 16, chestR: 7, waistR: 6, depth: 0.85, bodyMat: leather,
      shoulderW: 8, armLen: 18, armR: 1.9, armMat: fur, handMat: pink
    });
    const T = u.torso;
    // Hooded short cloak in the team color, a bandolier of bolts, belts and a coil of chain.
    add(T, g.cyl(7, 11, 14, 10, true), teamM, -1, 9, 0, { sx: 0.85 });
    add(T, g.box(1, 20, 2), K.m(0x2a1a10), 5.3, 8, 0, { rx: 0.65 });
    for (let i = 0; i < 6; i++) add(T, g.cyl(0.4, 0.4, 3.4, 4), K.m(0xc8402a), 5.8, 3 + i * 2.4, -3 + i * 1.2, { rz: 0.4 });
    add(T, g.torus(3.2, 0.7, 4, 12), steel, 4, 1, 5, { ry: PI / 2 });
    add(T, g.torus(2.6, 0.7, 4, 12), steel, 4.5, 1, 5.6, { ry: PI / 2, rx: 0.5 });
    // Back rack: two bear traps and a bundle of stakes.
    const rack = pivot(T, -7, 9, 0);
    for (const y of [-2, 6]) {
      add(rack, g.torus(5, 0.8, 4, 14), steel, 0, y, 0, { ry: PI / 2 });
      for (let i = 0; i < 6; i++) { const a = i / 6 * PI * 2; add(rack, g.cone(0.7, 2.6, 4), steel, -0.5, y + Math.sin(a) * 5, Math.cos(a) * 5, { rx: a }); }
    }
    for (let i = 0; i < 3; i++) add(rack, g.cyl(0.6, 0.6, 18, 4), K.m(0x6b4a2a), -2, 4, -3 + i * 3, { rx: 0.2 * (i - 1) });
    // Tail: long, pink, segmented and swishing.
    const tail = pivot(u.hips, -5, 0, 0);
    let seg = tail; const tailSegs = [];
    for (let i = 0; i < 8; i++) {
      const s = pivot(seg, i ? -4 : 0, 0, 0);
      add(s, g.cyl(Math.max(0.3, 1.2 - i * 0.12), Math.max(0.4, 1.35 - i * 0.12), 4.5, 5), pink, -2.2, 0, 0, { rz: PI / 2 });
      tailSegs.push(s); seg = s;
    }
    // Rat head: long snout, whiskers, big round ears, red eyes, hood.
    const H = u.head;
    add(H, g.sph(5, 10, 8), fur, 0, 4, 0);
    add(H, g.cone(3.6, 10, 8), fur, 6, 3, 0, { rz: -PI / 2 });
    add(H, g.sph(1.2, 6, 5), K.m(0x1a1010), 11, 3, 0);
    for (const s of [-1, 1]) {
      add(H, g.sph(0.9, 6, 5), K.lit(0xff3a2a), 3.8, 5.6, s * 2.8, { shadow: false });
      add(H, g.cyl(3.8, 3.8, 0.8, 12), fur, -0.5, 10, s * 4.2, { rx: PI / 2 + s * 0.5 });
      add(H, g.cyl(2.8, 2.8, 0.9, 12), pink, -0.3, 10, s * 4.5, { rx: PI / 2 + s * 0.5 });
      for (let i = 0; i < 3; i++) add(H, g.cyl(0.12, 0.12, 9, 3), K.m(0xe8e0d0), 9, 3 + i * 0.6, s * 3.5, { rx: s * (1.3 + i * 0.15), shadow: false });
    }
    add(H, g.cone(6.2, 9, 10, true), teamM, -1.5, 6, 0, { rz: 0.45 });
    const eyes = K.addGlow(H, 0xff3a2a, 12, 4.5, 5.6, 0, 0.6);
    // Repeating crossbow: stock, steel prod, bolt magazine, string. Held in both hands.
    const bow = pivot(u.handR, 0, -1, 0);
    add(bow, g.box(2.4, 26, 2.6), K.m(0x5a3a22), 0, -9, 0);
    add(bow, g.torus(10, 0.9, 4, 14, PI), steel, 0, -19, 0, { rx: PI / 2, rz: PI });
    add(bow, g.box(3, 9, 3.6), K.m(0x3a2614), -2.4, -10, 0);
    add(bow, g.box(0.3, 0.3, 20), K.m(0xe8e0c0), 0, -14, 0, { shadow: false });
    add(bow, g.cone(1, 4, 4), steel, 0, -23, 0, { rx: PI });
    add(bow, g.box(1.2, 4, 1.2), steel, 1.6, 2, 0);
    const muzzle = K.addGlow(bow, 0xffe0a0, 22, 0, -24, 0, 0);

    function animate(u, e, time) {
      const sw = walk(u, e, time, 14, 0.6);
      const k = e.swing, c = e.castAnim, slot = e.castSlot;
      const firing = smoothTo(u, 'aimB', k > 0 || (c > 0 && slot === 0) ? 1 : 0, 0.3);
      // Crossbow carried low; shouldered and leveled when shooting, kicking back on release.
      const recoil = k > 0 ? Math.max(0, k - 0.6) * 2.5 : 0;
      let rz = lerp(0.5 - sw * 0.2, 1.35 - recoil * 0.4, firing), rb = lerp(0.9, 0.15, firing);
      let pitch = lerp(PI / 2 + 0.6, PI / 2 + recoil * 0.3, firing);
      let lz = lerp(0.6 + sw * 0.2, 1.2, firing), lb = lerp(0.8, 0.4, firing), lean = -0.15 + recoil * 0.1;
      if (c > 0) {
        const b = ease.bump(c);
        if (slot === 0) { lean = 0.25 * b; pitch = PI / 2 + 0.25 * b; }
        if (slot === 1 || slot === 2) { lz = 0.3 + b * 2.4; lb = 0.4; lean = -0.2 * b; }
        if (slot === 3) { lz = 2.4 * b; rz = 0.6; lb = 0.2; lean = 0.2 * b; }
      }
      pose(u.armR, u.elbowR, rz, 0.1, rb, 1);
      pose(u.armL, u.elbowL, lz, 0.05, lb, -1);
      aim(bow, u.armR, u.elbowR, pitch);
      bow.rotation.x = -0.2;
      u.torso.rotation.z = lean;
      u.head.rotation.y = Math.sin(time * 2.2) * 0.15 * (1 - firing);
      muzzle.material.opacity = k > 0.7 || (c > 0.7 && slot === 0) ? 0.9 : 0;
      tailSegs.forEach((s, i) => { s.rotation.y = Math.sin(time * 3 + i * 0.7) * 0.3; s.rotation.z = i ? 0.08 : -0.3; });
      eyes.material.opacity = 0.4 + Math.sin(time * 4) * 0.2;
    }
    return finish(root, 1.46, (_, e, t) => animate(u, e, t), [fur], { u });
  };

  // =============================================================================================
  // 8. PYROCLAST — Savvas magma elemental: obsidian plates over a furnace core, floating stones
  // =============================================================================================
  R.HERO_MODELS.pyroclast = function (team) {
    const root = new THREE.Group();
    const ORANGE = 0xff6a14, RED = 0xe0280a;
    // Glossy black obsidian, scorched red-black stone, and molten magma that glows (emissive, pulsed below).
    const rock = K.mat(0x0c0909, { roughness: 0.45, metalness: 0.2 }), rockHi = K.mat(0x2a0c08, { roughness: 0.8 });
    const lava = K.lit(0xff5a10), lavaHi = K.lit(0xffa030);
    const magma = K.mat(0x401004, { emissive: RED, emissiveIntensity: 1, roughness: 0.7 });
    const magmaHot = K.mat(0x602008, { emissive: ORANGE, emissiveIntensity: 1, roughness: 0.6 });
    const molten = [];   // [mesh, phase] — read mesh.material each frame (ghosting clones materials)
    const melt = (parent, geo, mat, x, y, z, o, ph = 0) => { const m = add(parent, geo, mat, x, y, z, Object.assign({ shadow: false }, o)); molten.push([m, ph]); return m; };
    const u = humanoid(root, {
      legLen: 26, hipW: 5.5, legR: 4, legMat: rock, shinMat: rockHi,
      torsoH: 24, chestR: 11.5, waistR: 7.5, depth: 0.8,
      shoulderW: 13.5, armLen: 25, armR: 3.4, armMat: rock, foreMat: rockHi
    });
    const T = u.torso;
    // Glowing furnace core: a molten body showing through the seams between angular obsidian plates.
    melt(T, g.cyl(7.5, 5.5, 22, 9), magma, 0, 12, 0, { sx: 0.8 }, 0);
    add(T, g.ico(8.5, 1), lava, 0, 13, 0, { sx: 0.8, shadow: false });
    const coreGlow = K.addGlow(T, ORANGE, 40, 5, 13, 0, 0.5);
    const plates = [[6, 18, -5, 0.3], [6, 18, 5, -0.3], [6, 9, -6, 0.5], [6, 9, 6, -0.5], [-6, 15, 0, 0], [0, 22, -9, 0.9], [0, 22, 9, -0.9], [3, 3, 0, 0]];
    plates.forEach(([x, y, z, r], i) => add(T, g.dodec(6), i % 3 === 2 ? rockHi : rock, x, y, z, { rx: r, sx: 0.55, sy: 1.1 }));
    for (let i = 0; i < 5; i++) melt(T, g.box(0.7, 5 + i, 0.7), magmaHot, 7.4, 6 + i * 3.2, -4 + i * 2, { rz: 0.5 - i * 0.2 }, i * 0.8);
    for (let i = 0; i < 3; i++) melt(T, g.box(0.6, 6, 0.6), magma, -6.6, 9 + i * 4, -3 + i * 3, { rz: -0.4 + i * 0.3 }, 2 + i);
    // Team rune band around the waist (glowing).
    add(T, g.torus(7.8, 0.8, 4, 16), K.lit(K.teamGlow(team)), 0, 2, 0, { rx: PI / 2, sx: 0.85, shadow: false });
    // Limbs: obsidian and scorched stone split by glowing magma fissures.
    for (const l of u.legs) {
      add(l.knee, g.dodec(4), rockHi, 1, -2, 0);
      melt(l.knee, g.box(0.7, 6, 0.7), magmaHot, 3.8, -6, 0, {}, 1);
      melt(l.hip, g.box(0.6, 8, 0.6), magma, 3.6, -7, 0.8, { rx: 0.15 }, 3);
      melt(l.knee, g.torus(3.3, 0.45, 4, 9), magma, 0, -9, 0, { rx: PI / 2 }, 4);
    }
    for (const [sh, el] of [[u.armL, u.elbowL], [u.armR, u.elbowR]]) {
      melt(sh, g.box(0.6, 8, 0.6), magma, 3.1, -6, 0, { rz: 0.1 }, 2);
      melt(el, g.box(0.6, 7, 0.6), magmaHot, 2.7, -6, 0.6, { rz: -0.12 }, 5);
      melt(el, g.torus(2.9, 0.45, 4, 9), magma, 0, -1, 0, { rx: PI / 2 }, 1.5);
    }
    // Head: faceted obsidian skull, slit eyes, a molten jaw crack, a crown of fire and orbiting shards.
    const H = u.head;
    add(H, g.oct(6.5), rock, 0.5, 6, 0, { sy: 1.3 });
    add(H, g.box(1, 1.2, 6), lavaHi, 5, 6.5, 0, { shadow: false });
    melt(H, g.box(0.8, 0.6, 4.5), magma, 4.4, 3, 0, {}, 0.5);
    melt(H, g.box(0.5, 4, 0.5), magmaHot, 3.6, 9.5, 1.4, { rx: 0.4 }, 2.5);
    const eyes = K.addGlow(H, 0xffd080, 12, 6, 6.5, 0, 0.7);
    const crown = [];
    for (let i = 0; i < 5; i++) { const s = K.glow(i % 2 ? 0xffa040 : 0xff5a10, 14, 0.55); H.add(s); crown.push(s); }
    const halo = pivot(H, 0, 9, 0), haloStones = [];
    for (let i = 0; i < 4; i++) { const s = add(halo, g.tet(2), rockHi, 0, 0, 0); s.add(K.glow(ORANGE, 8, 0.8)); haloStones.push(s); }
    // Floating shoulder boulders, each with a molten underside.
    const boulders = [];
    for (const s of [-1, 1]) {
      const b = pivot(T, -1, 30, s * 15);
      add(b, g.dodec(7), rock, 0, 0, 0, { sy: 0.8 });
      add(b, g.ico(4, 0), lava, 0, -3.5, 0, { shadow: false });
      melt(b, g.box(0.7, 0.7, 9), magmaHot, 0, 1.5, 0, { ry: 0.6 * s }, s + 2);
      b.add(K.glow(RED, 28, 0.6));
      boulders.push({ b, s });
    }
    // Molten fists.
    const fists = [];
    for (const hand of [u.handL, u.handR]) {
      add(hand, g.dodec(4.2), rockHi, 0, -2, 0);
      add(hand, g.ico(3, 0), lava, 1.5, -3, 0, { shadow: false });
      melt(hand, g.box(0.6, 0.6, 5), magmaHot, 2.6, -1.2, 0, {}, 3.5);
      const f = K.addGlow(hand, ORANGE, 30, 2, -4, 0, 0.8);
      fists.push(f);
    }
    const embers = [];
    for (let i = 0; i < 8; i++) { const s = K.glow(i % 3 === 0 ? RED : i % 2 ? 0xffa040 : ORANGE, 8, 0.9); root.add(s); embers.push(s); }

    function animate(u, e, time) {
      const sw = walk(u, e, time, 9, 0.5);
      const k = e.swing, c = e.castAnim, slot = e.castSlot;
      const ws = ease.windStrike(k, 0.4);
      // Basic: a sidearm hurl from the right fist.
      let rz = 0.3 + sw * 0.25 + (k > 0 ? 0.6 + ws * 1.2 : 0), rb = k > 0 ? 0.6 - ws * 0.5 : 0.5, rx = k > 0 && ws < 0 ? 0.6 : 0.15;
      let lz = 0.3 - sw * 0.25, lb = 0.5, lean = -ws * 0.1, twist = -ws * 0.3, flare = k > 0 ? 1 : 0;
      if (c > 0) {
        const b = ease.bump(c), w = ease.windStrike(c, 0.35);
        flare = 1;
        if (slot === 0) { rz = 0.9 + w * 1.1; rb = 0.3 - w * 0.3; twist = -w * 0.4; }
        if (slot === 1) { lz = rz = 0.2 + b * 1.2; lb = rb = 0.2; rx = 0.7 * b; }
        if (slot === 2) { lz = rz = 1.3 * b + 0.2; lb = rb = 0.05; lean = -0.15 * b; }
        if (slot === 3) { lz = rz = 0.3 + b * 2.6; lb = rb = 0.1; lean = 0.2 * b; }
      }
      u.armR.rotation.z = rz; u.armR.rotation.x = -rx; u.elbowR.rotation.z = rb;
      pose(u.armL, u.elbowL, lz, slot === 1 && c > 0 ? 0.7 * ease.bump(c) : 0.15, lb, -1);
      u.torso.rotation.z = lean; u.torso.rotation.y = twist;
      const f = 0.85 + Math.sin(time * 10) * 0.15;
      coreGlow.material.opacity = 0.35 + flare * 0.3 + Math.sin(time * 4) * 0.08;
      // Magma seams throb slowly, flaring brighter while attacking or casting.
      for (const [m, ph] of molten) m.material.emissiveIntensity = 0.75 + Math.sin(time * 2.4 + ph) * 0.3 + flare * 0.6;
      eyes.material.opacity = 0.5 + Math.sin(time * 7) * 0.2;
      const big = (c > 0 && slot === 3) ? 1.8 : 1;
      crown.forEach((s, i) => {
        const a = i / 5 * PI * 2 + time;
        s.position.set(Math.cos(a) * 3, 13 + Math.sin(time * 9 + i) * 2 * big, Math.sin(a) * 3);
        s.scale.set(11 * f * big, 20 * f * big, 1);
      });
      halo.rotation.y = time * 1.5;
      haloStones.forEach((s, i) => { const a = i / 4 * PI * 2; s.position.set(Math.cos(a) * 9, Math.sin(time * 2 + i) * 1.5, Math.sin(a) * 9); s.rotation.x = time * 2; });
      boulders.forEach(({ b, s }, i) => { b.position.y = 30 + Math.sin(time * 2 + i * 2) * 2; b.rotation.y = time * 0.5 * s; });
      fists.forEach(fl => { fl.material.opacity = 0.45 + flare * 0.4; fl.scale.setScalar(20 * f * (1 + flare * 0.5)); });
      embers.forEach((s, i) => {
        const p = (time * 0.7 + i / 8) % 1, a = i * 2.4;
        s.position.set(Math.cos(a) * 12, 20 + p * 60, Math.sin(a) * 12);
        s.material.opacity = (1 - p) * 0.9;
      });
    }
    return finish(root, 1.31, (_, e, t) => animate(u, e, t), [rock, rockHi], { u });
  };

  // =============================================================================================
  // 9. DRIFTER — a grizzled old Inox: great swept horns, grey mane and braided beard, a hooded traveling
  //    cloak and team scarf over hide and fur, and a two-handed stone-and-iron maul
  // =============================================================================================
  R.HERO_MODELS.drifter = function (team) {
    const root = new THREE.Group();
    const skin = K.mat(0x8a6650), skinDark = K.m(0x5e4434), hide = K.mat(0x6a4c34), leather = K.m(0x3e2c1e);
    const fur = K.m(0x5a4632), furPale = K.m(0x9a8a76), grey = K.mat(0xc8c2b6, { roughness: 0.9 }), greyDark = K.m(0x8e887e);
    const horn = K.mat(0xd8caa8, { roughness: 0.6 }), hornTip = K.m(0x4a4034);
    const cloakM = K.mat(0x4e4a40, { side: THREE.DoubleSide }), teamM = K.mat(K.teamHex(team), { side: THREE.DoubleSide });
    const iron = K.metal(0x6e7076, 0.45), bronze = K.metal(0xa87a40, 0.4), wood = K.m(0x4a3220), stone = K.mat(0x7a7a74, { roughness: 0.95 });
    const u = humanoid(root, {
      legLen: 26, hipW: 6.2, legR: 4.8, legMat: leather, shinMat: hide, bootMat: fur,
      torsoH: 25, chestR: 13.5, waistR: 10.5, depth: 0.8, bodyMat: hide,
      shoulderW: 15, armLen: 26, armR: 4.1, armMat: skin, foreMat: leather, handMat: skinDark
    });
    for (const l of u.legs) {
      add(l.knee, g.cyl(5.2, 4.4, 5, 8), fur, 0, -10, 0);                             // fur boot tops
      for (const y of [-3, -6]) add(l.knee, g.torus(4.1, 0.5, 4, 10), leather, 0, y, 0, { rx: PI / 2 });   // leg wraps
    }
    const T = u.torso;
    // Hide jerkin with crossed straps, a riveted iron plate, a broad belt and a hide-and-fur kilt.
    add(T, g.box(1.6, 30, 3.2), leather, 8.6, 12, 0, { rx: 0.62 });
    add(T, g.box(1.6, 30, 3.2), leather, -8.6, 12, 0, { rx: -0.62 });
    add(T, g.box(2.2, 8, 9), iron, 9.2, 14, 0, { rz: -0.1 });
    for (const z of [-3, 3]) add(T, g.sph(0.8, 5, 4), bronze, 10.4, 17, z, { shadow: false });
    add(T, g.cyl(11, 11, 4, 12), leather, 0, 2, 0, { sx: 0.82 });
    add(T, g.box(2.4, 5, 6), bronze, 9.1, 2, 0);
    add(T, g.cyl(10.8, 13.5, 12, 12, true), hide, 0, -5, 0, { sx: 0.85 });
    for (let i = 0; i < 8; i++) { const a = i / 8 * PI * 2; add(T, g.box(2, 5, 4), fur, Math.cos(a) * 11.2, -11, Math.sin(a) * 13.2, { ry: -a }); }
    for (const z of [-5, 5]) add(T, g.box(3.4, 4.5, 3.6), leather, 7.8, -1, z);    // pouches
    // Heavy fur mantle over the shoulders and an iron pauldron on the leading (left) shoulder.
    add(T, g.cyl(12.5, 16, 8, 14), fur, 0, 21, 0, { sx: 0.82 });
    for (let i = 0; i < 14; i++) { const a = i / 14 * PI * 2; add(T, g.cone(2.6, 6, 4), i % 2 ? fur : furPale, Math.cos(a) * 13, 16.5, Math.sin(a) * 15.5, { rz: Math.cos(a) * 0.5 + PI, rx: -Math.sin(a) * 0.5 }); }
    add(T, g.dome(6.5, 10, 5), iron, 0, 22, -15.5, { rx: -0.5 });
    add(T, g.dome(5.2, 10, 5), iron, 0, 19, -17.5, { rx: -0.8 });
    add(T, g.torus(6.3, 0.7, 4, 12), bronze, 0, 22.2, -16.2, { rx: PI / 2 - 0.5 });
    // Team scarf wound round the neck, its tails trailing down the chest.
    add(T, g.torus(8.6, 2.4, 6, 14), teamM, 0, 26.5, 0, { rx: PI / 2, sx: 0.85 });
    const tails = [];
    for (const z of [-3, 2]) {
      const t = pivot(T, 8.5, 25, z);
      add(t, g.box(1.2, 14, 4.4), teamM, 0, -7, 0);
      add(t, g.box(1.4, 1.6, 4.6), K.m(0x2a2018), 0, -13, 0);
      tails.push(t);
    }
    // Hooded traveling cloak: the hood thrown back, the cloak in three hinged panels that stream behind.
    const hood = pivot(T, -7, 26, 0);
    add(hood, g.dome(9, 12, 6, PI * 0.62), cloakM, -2, 0, 0, { rz: 0.9, sx: 1.1 });
    const cloak = [];
    for (const z of [-9, 0, 9]) {
      const c = pivot(T, -10.5, 24, z);
      add(c, g.box(1.2, 44, 10.5), cloakM, 0, -22, 0);
      add(c, g.box(1.4, 2, 10.8), teamM, 0, -43.5, 0);
      cloak.push(c);
    }
    // Head: a broad weathered Inox face under a heavy brow, wide flat nose, short tusks, a grey mane and
    // a long braided beard.
    const H = u.head;
    add(H, g.cyl(4, 5, 5, 8), skin, 0, 0.5, 0);
    add(H, g.sph(6.8, 12, 10), skin, 1, 6.5, 0, { sx: 1.05, sy: 1.1, sz: 0.95 });
    add(H, g.box(3, 2.2, 10), skinDark, 6.2, 9, 0);                                     // heavy brow
    add(H, g.sph(3, 10, 8), skin, 7.2, 5.2, 0, { sx: 0.8, sy: 0.9, sz: 1.25 });          // broad flat nose
    for (const z of [-1.3, 1.3]) add(H, g.sph(0.8, 6, 5), K.m(0x1a120c), 9.4, 4.4, z, { shadow: false });
    const eyes = [];
    for (const z of [-2.8, 2.8]) {
      eyes.push(add(H, g.sph(0.9, 6, 5), K.lit(0xffd890), 6.6, 7.6, z, { shadow: false }));
      add(H, g.box(1.2, 1.4, 3.2), grey, 7.4, 9.6, z * 1.1, { rz: -0.3, shadow: false });   // bushy grey brows
      add(H, g.cone(0.9, 3.6, 5), horn, 7.8, 1.4, z * 0.9, { rz: -0.25 });              // lower tusks
    }
    add(H, g.sph(7, 10, 8), grey, -2.6, 8, 0, { sx: 0.95, sy: 1.15 });                  // mane
    for (let i = 0; i < 7; i++) add(H, g.cone(2.2, 11, 4), i % 2 ? grey : greyDark, -5.5, 6 - i * 0.6, -6 + i * 2, { rz: 0.5 + (i % 3) * 0.1 });
    add(H, g.sph(5.4, 10, 8), grey, 5, 1.6, 0, { sx: 0.8, sy: 0.9, sz: 1.2 });        // moustache and beard mass
    const beard = pivot(H, 5.5, -1.5, 0);
    for (let i = 0; i < 5; i++) add(beard, g.sph(2.6 - i * 0.32, 7, 6), i % 2 ? greyDark : grey, i * 0.3, -i * 2.8, 0, { sy: 1.3 });
    add(beard, g.cyl(1.3, 1.3, 1.4, 8), bronze, 1.2, -9.5, 0);
    for (const z of [-3.6, 3.6]) add(H, g.cone(1.8, 10, 5), grey, 5, -1, z, { rz: PI - 0.15 });   // side whiskers
    for (const s of [-1, 1]) add(H, g.cone(1.6, 4.5, 5), skin, -0.5, 9, s * 6.6, { rx: s * 1.7 });  // ears
    // Great horns: out from the temples, sweeping up and forward, built from tapering hinged segments.
    for (const s of [-1, 1]) {
      let p = pivot(H, 0.5, 11, s * 5);
      p.rotation.x = s * 1.45;
      const n = 7, len = 4.6;
      for (let i = 0; i < n; i++) {
        const r0 = 2.9 * (1 - i / n) + 0.35, r1 = 2.9 * (1 - (i + 1) / n) + 0.35;
        add(p, g.cyl(r1, r0, len + 0.4, 8), i === n - 1 ? hornTip : horn, 0, len / 2, 0);
        if (i === 1) add(p, g.torus(r0 * 0.95, 0.5, 4, 10), bronze, 0, len * 0.4, 0, { rx: PI / 2 });   // a bronze horn ring
        p = pivot(p, 0, len, 0);
        p.rotation.x = -s * 0.3; p.rotation.z = -0.24;
      }
    }
    // The maul: a long haft with grip wraps and iron fittings, and a great banded stone head with spikes.
    // Hangs along -y from the right hand; the left arm follows it for two-handed blows.
    const maul = pivot(u.handR, 0, -2, 0);
    add(maul, g.cyl(1.7, 1.9, 72, 7), wood, 0, -18, 0);
    for (let i = 0; i < 4; i++) add(maul, g.cyl(2.2, 2.2, 2, 7), leather, 0, 10 - i * 6, 0);
    add(maul, g.cyl(2.3, 2.3, 4, 8), iron, 0, 16, 0);
    add(maul, g.cyl(2.4, 2.4, 3, 8), iron, 0, -50, 0);
    const head = pivot(maul, 0, -59, 0);
    add(head, g.box(13, 15, 13), stone, 0, 0, 0);
    for (const y of [-5.5, 5.5]) add(head, g.box(13.6, 2, 13.6), iron, 0, y, 0);
    for (const x of [-6.8, 6.8]) add(head, g.box(1.4, 13, 11), iron, x, 0, 0);
    add(head, g.cone(3, 9, 6), iron, 0, 0, 10.5, { rx: PI / 2 });                        // back spike
    add(head, g.cone(2.6, 5, 6), iron, 0, -10, 0, { rz: PI });                          // top spike
    const heat = K.addGlow(head, 0xffa040, 44, 0, 0, 0, 0);
    const dust = K.addGlow(head, 0xe8dcc0, 54, 0, 0, 0, 0);

    function animate(u, e, time) {
      const sw = walk(u, e, time, 8, 0.45);
      const k = e.swing, c = e.castAnim, slot = e.castSlot;
      const ws = ease.windStrike(k, 0.45);
      // Idle / walking: the maul rests on the right shoulder, the left hand swinging free.
      let rz = 0.55 + sw * 0.15, rb = 1.9, pitch = PI + 0.9, lz = 0.25 - sw * 0.35, lb = 0.35, lean = 0, lunge = 0;
      // Basic: heave the maul overhead with both hands and bring it crashing down.
      if (k > 0) {
        rz = ws < 0 ? 0.55 - ws * 2.2 : 2.75 - ws * 1.75; rb = 0.25;
        pitch = ws < 0 ? PI + 0.2 : PI - ws * (PI / 2 + 0.35);
        lz = rz * 0.95; lb = 0.35; lean = -ws * 0.25; lunge = Math.max(0, ws) * 4;
      }
      if (c > 0) {
        const b = ease.bump(c), w = ease.windStrike(c, 0.4);
        if (slot === 0) {
          // Destructive Fury: a huge two-handed overhead blow that splits the ground in front.
          rz = w < 0 ? 0.6 - w * 2.4 : 3.0 - w * 2.1; rb = 0.15; lz = rz; lb = 0.25;
          pitch = w < 0 ? PI + 0.3 : PI - w * (PI / 2 + 0.5); lean = -w * 0.4; lunge = Math.max(0, w) * 7;
        } else if (slot === 1) {
          // Crushing Weight: plant the maul and roar, head thrown back.
          rz = 0.9; rb = 0.3; pitch = 0.15; lz = 0.3 + b * 1.6; lb = 0.4; lean = 0.25 * b;
        } else if (slot === 2) {
          // Shockwave: stamp the iron butt of the haft into the ground.
          rz = 1.0 - w * 0.4; rb = 0.6; pitch = PI - 0.1; lz = 1.0; lb = 0.5; lean = -w * 0.2;
        } else if (slot === 3 && !e.dash) {
          lean = -0.3 * b;   // Against All Odds: crouch to spring
        }
      }
      // Mid-leap: the maul raised high overhead in both hands; a crushing slam as he lands.
      if (e.dash && e.lift > 0) { rz = lz = 2.9; rb = lb = 0.15; pitch = PI + 0.4; lean = 0.15; u.slam = 1; }
      else if (u.slam > 0) {
        u.slam = Math.max(0, u.slam - 0.06);
        const s = Math.sin(u.slam * PI * 0.5);
        rz = lz = 1.2 + s * 1.4; rb = lb = 0.2; pitch = PI / 2 - 0.4 + s * 0.6; lean = -0.45 * (1 - u.slam * 0.5); lunge = 5;
      }
      pose(u.armR, u.elbowR, rz, 0.18, rb, 1);
      pose(u.armL, u.elbowL, lz, 0.35, lb, -1);
      aim(maul, u.armR, u.elbowR, pitch);
      u.torso.rotation.z = lean;
      u.hips.position.x = lunge;
      u.head.rotation.z = slot === 1 && c > 0 ? 0.35 * ease.bump(c) : Math.sin(time * 1.1) * 0.03;
      u.head.rotation.y = Math.sin(time * 0.7) * 0.08;
      // Beard, scarf tails and cloak hang down whatever the lean, trailing back as he moves or leaps.
      const trail = smoothTo(u, 'trail', e.moving ? (e.lift > 0 ? 0.9 : 0.4) : 0, 0.12);
      beard.rotation.z = -lean - u.head.rotation.z + Math.sin(time * 2) * 0.04;
      tails.forEach((t, i) => { t.rotation.z = -lean + trail * 0.6 + Math.sin(time * 6 + i) * 0.08 * (0.3 + trail); });
      cloak.forEach((p, i) => {
        p.rotation.z = -lean - trail * 0.7 - Math.sin(time * 5 + i * 1.3) * 0.06 * (0.4 + trail);
        p.rotation.x = (i - 1) * 0.12;
      });
      // Crushing Weight: the maul head smoulders. Shockwave: dust swirls about it. Stack Up: the eyes burn brighter.
      heat.material.opacity = e.state.crush > 0 ? 0.6 + Math.sin(time * 9) * 0.2 : 0;
      dust.material.opacity = e.state.shock > 0 ? 0.35 + Math.sin(time * 6) * 0.12 : 0;
      const st = (e.state.stacks || 0) / 8;
      for (const m of eyes) m.scale.setScalar(1 + st * 0.8);
    }
    return finish(root, 1.30, (_, e, t) => animate(u, e, t), [skin, hide], { u });
  };

  // =============================================================================================
  // Summons: Skeleton warrior and Bone Ball (soldier contract: tunic, arm, l1, l2)
  // =============================================================================================
  R.SUMMON_MODELS.skeleton = function (team) {
    const g0 = new THREE.Group();
    const bone = K.mat(0xd8d2bc), dark = K.m(0x1a1a18), rust = K.metal(0x6a4a3a, 0.6);
    const l1 = pivot(g0, 0, 13, 4), l2 = pivot(g0, 0, 13, -4);
    for (const l of [l1, l2]) { add(l, g.cyl(1.2, 1.2, 13, 5), bone, 0, -6.5, 0); add(l, g.box(4, 1.5, 2.5), bone, 1, -13, 0); }
    add(g0, g.box(4, 3, 9), bone, 0, 14, 0);
    add(g0, g.cyl(1.3, 1.3, 16, 5), bone, -1.5, 23, 0);
    for (let i = 0; i < 4; i++) add(g0, g.torus(5 - i * 0.5, 0.8, 4, 10, PI * 1.3), bone, 0.5, 20 + i * 3, 0, { rx: PI / 2, rz: -PI * 0.65 });
    add(g0, g.sph(5.2, 8, 6), bone, 1, 37, 0);
    add(g0, g.box(4, 3, 5), bone, 3.5, 33.5, 0);
    for (const z of [-1.8, 1.8]) { add(g0, g.sph(1.3, 5, 4), dark, 5, 38, z); add(g0, g.sph(0.7, 5, 4), K.lit(0x9ff0b8), 5.6, 38, z, { shadow: false }); }
    add(g0, g.cyl(5.6, 5.8, 3, 8), rust, 0, 40, 0);   // dented helm
    add(g0, g.cone(1, 6, 4), rust, -1, 44, 0);
    // Shield: a cracked round board on the left.
    add(g0, g.cyl(7, 7, 1.6, 9), K.m(0x4a3a2a), 4, 22, -9, { rx: PI / 2 });
    add(g0, g.torus(7, 0.6, 4, 12), rust, 4, 22, -9.8, {});
    const arm = pivot(g0, 0, 30, 8);
    add(arm, g.cyl(1.1, 1.1, 10, 5), bone, 0, 3, 0);
    add(arm, g.box(1.6, 22, 0.8), rust, 0, 16, 0);
    add(arm, g.box(1.8, 1.6, 6), rust, 0, 5, 0);
    g0.add(K.glow(0x9ff0b8, 30, 0.35)); g0.children[g0.children.length - 1].position.y = 37;
    g0.userData = { tunic: bone, arm, l1, l2, ranged: false, aura: null, phase: Math.random() * 10 };
    g0.scale.setScalar(1.15);
    return K.shadowed(g0);
  };
  R.SUMMON_MODELS.skeletonSolo = R.SUMMON_MODELS.skeleton;

  // Charlie, the Bannerspear's squire: a stocky lad in a team-colored jerkin and kettle hat, hauling a
  // tower shield nearly as tall as he is.
  R.SUMMON_MODELS.charlie = function (team) {
    const g0 = new THREE.Group();
    const jerkin = K.mat(K.teamHex(team)), leather = K.m(0x5a3e26), dark = K.m(0x2a2018);
    const skin = K.m(0xe0b090), iron = K.metal(0x8a929c, 0.4), gold = K.metal(0xd9a530, 0.3);
    const l1 = pivot(g0, 0, 14, 3.6), l2 = pivot(g0, 0, 14, -3.6);
    for (const l of [l1, l2]) { add(l, g.cyl(2.2, 1.9, 13, 6), leather, 0, -6.5, 0); add(l, g.box(5.5, 2.4, 3.6), dark, 1, -13, 0); }
    add(g0, g.cyl(7, 6.2, 15, 9), jerkin, 0, 21, 0, { sx: 0.8 });
    add(g0, g.cyl(6.4, 6.4, 2.4, 9), leather, 0, 15, 0, { sx: 0.82 });
    add(g0, g.box(2, 2, 2.6), gold, 5.2, 15, 0);
    add(g0, g.sph(4.6, 10, 8), skin, 0.5, 33, 0);
    for (const z of [-1.5, 1.5]) add(g0, g.sph(0.6, 5, 4), K.m(0x2a1a14), 4.4, 33.6, z, { shadow: false });
    add(g0, g.sph(4.7, 8, 6), K.m(0x6a4424), -1, 34.5, 0, { sx: 0.9 });  // mop of hair
    add(g0, g.cone(5.2, 4, 10), iron, 0, 38.5, 0);                        // kettle hat
    add(g0, g.cyl(7.5, 7.5, 0.8, 12), iron, 0, 36.6, 0);
    // Tower shield carried on the left, out in front.
    add(g0, g.box(2, 30, 18), jerkin, 7, 20, -6);
    add(g0, g.box(2.4, 31, 1.4), iron, 7.2, 20, 3);
    add(g0, g.box(2.4, 31, 1.4), iron, 7.2, 20, -15);
    add(g0, g.box(2.4, 1.4, 18), iron, 7.2, 35, -6);
    add(g0, g.box(2.4, 1.4, 18), iron, 7.2, 5, -6);
    add(g0, g.cyl(3, 3, 1, 8), gold, 8.4, 21, -6, { rz: PI / 2 });
    // Right arm: a short pennant pole over the shoulder.
    const arm = pivot(g0, 0, 27, 7);
    add(arm, g.cyl(1.8, 1.6, 10, 6), jerkin, 0, -4, 0);
    add(arm, g.sph(1.9, 6, 5), skin, 0, -9.5, 0);
    add(arm, g.cyl(0.6, 0.6, 30, 5), K.m(0x4a3320), 0, 2, 0);
    add(arm, g.box(0.4, 7, 9), jerkin, -0.5, 13, 4.5);
    g0.userData = { tunic: jerkin, arm, l1, l2, ranged: false, aura: null, phase: Math.random() * 10 };
    g0.scale.setScalar(1.25);
    return K.shadowed(g0);
  };

  // Bone Ball: the dead packed into a great sphere of bones and skulls around a soul-fire core. It rolls
  // as it moves and swells as it absorbs skeletons. No legs or weapon arm: those pivots stay empty.
  R.SUMMON_MODELS.boneBall = function (team) {
    const g0 = new THREE.Group();
    const bone = K.mat(0xd8d0b8), boneDark = K.m(0xa89e84), green = 0x9ff0b8, R0 = 22;
    const ball = pivot(g0, 0, R0 + 4, 0);
    add(ball, g.ico(R0 - 2, 1), K.m(0x2e3428), 0, 0, 0);
    const up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), t = new THREE.Vector3(), q = new THREE.Vector3();
    const onSphere = () => v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
    // Long bones lying across the surface, knobbed at both ends.
    for (let i = 0; i < 34; i++) {
      onSphere();
      t.crossVectors(v, q.set(Math.random(), Math.random(), Math.random())).normalize();
      const b = pivot(ball, v.x * R0, v.y * R0, v.z * R0);
      b.quaternion.setFromUnitVectors(up, t);
      const len = 12 + Math.random() * 8, mat = i % 3 ? bone : boneDark;
      add(b, g.cyl(1.4, 1.4, len, 5), mat, 0, 0, 0);
      add(b, g.sph(2.2, 6, 5), mat, 0, len / 2, 0); add(b, g.sph(2.2, 6, 5), mat, 0, -len / 2, 0);
    }
    // Skulls staring outward, eyes lit with soul-fire.
    for (let i = 0; i < 8; i++) {
      onSphere();
      const s = pivot(ball, v.x * (R0 + 1), v.y * (R0 + 1), v.z * (R0 + 1));
      s.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), v);
      add(s, g.sph(5, 8, 6), bone, 0, 0, 0, { sy: 1.1 });
      add(s, g.box(3, 3, 5), bone, 3, -3.5, 0);
      for (const z of [-1.8, 1.8]) add(s, g.sph(1.2, 5, 4), K.lit(green), 4.2, 0.8, z, { shadow: false });
    }
    for (let i = 0; i < 10; i++) { onSphere(); add(ball, g.oct(2), K.lit(green), v.x * (R0 - 1), v.y * (R0 - 1), v.z * (R0 - 1), { shadow: false }); }
    const glow = K.addGlow(g0, green, 110, 0, R0 + 4, 0, 0.35);
    const arm = pivot(g0, 0, R0, 0), l1 = pivot(g0, 0, 0, 4), l2 = pivot(g0, 0, 0, -4);
    g0.userData = {
      tunic: bone, arm, l1, l2, ball, ranged: false, aura: null, phase: Math.random() * 10,
      tick(u, e, time) {
        // Roll forward (+x) by the distance covered since last frame.
        const d = u.lx === undefined ? 0 : Math.hypot(e.x - u.lx, e.y - u.ly);
        u.lx = e.x; u.ly = e.y;
        if (d < 60) ball.rotation.z -= d / (R0 + 4);
        // Swells with every skeleton absorbed (400 max health to start).
        const s = Math.min(1.7, Math.cbrt(e.maxHp / 400));
        ball.scale.setScalar(s); ball.position.y = (R0 + 4) * s;
        glow.material.opacity = 0.3 + Math.sin(time * 4) * 0.1;
      }
    };
    g0.scale.setScalar(1.25);
    return K.shadowed(g0);
  };
})(window.Game);
