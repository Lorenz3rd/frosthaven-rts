// Ability effect visuals (R.FX: one entry per G.fx kind) and projectile styles (R.PROJ).
// World (x, y) is Three.js (x, height, y). A mesh with rotation.y = -angle points its local +x along angle.
(function (G) {
  const R = G.render3d, K = G.kit;
  const FX = R.FX, PROJ = R.PROJ;
  const add = K.add, g = K.g;

  // Additive glowing material (each effect gets its own so it can fade independently).
  const glowMat = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const fadeMat = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
  // 0 -> 1 over `inT`, 1 until `outT` before the end, then -> 0.
  const env = (o, inT = 0.1, outT = 0.3) => Math.min(1, o.t / inT, (o.dur - o.t) / outT);
  const at = (m, x, y, h = 0) => { m.position.set(x, h, y); return m; };
  // Point a unit-length (along z) mesh from a to b.
  const tmpV = new THREE.Vector3();
  function span(mesh, ax, ah, ay, bx, bh, by, w) {
    const len = Math.hypot(bx - ax, bh - ah, by - ay) || 0.001;
    mesh.position.set((ax + bx) / 2, (ah + bh) / 2, (ay + by) / 2);
    mesh.lookAt(tmpV.set(bx, bh, by));
    mesh.scale.set(w, w, len);
  }
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 6).rotateX(Math.PI / 2);   // along z

  // Material opacity helper for a group: every child material scaled from its base opacity.
  function remember(group) {
    group.traverse(m => { if (m.material && m.material.transparent) m.userData.baseOpacity = m.material.opacity; });
    return group;
  }
  function setFade(group, k) {
    group.traverse(m => {
      if (m.material && m.userData.baseOpacity !== undefined) m.material.opacity = m.userData.baseOpacity * k;
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Generic shapes
  // ---------------------------------------------------------------------------------------------
  FX.ring = {
    make(o) {
      const grp = new THREE.Group();
      grp.add(new THREE.Mesh(g.ring(0.86, 1, 72), glowMat(o.color, 0.9)));
      grp.add(new THREE.Mesh(g.ring(0.6, 0.86, 72), glowMat(o.color, 0.25)));
      return at(grp, o.x, o.y, 3);
    },
    update(m, o) {
      const k = o.t / o.dur, e = 1 - Math.pow(1 - k, 3);
      m.scale.setScalar(Math.max(1, o.r0 + (o.r1 - o.r0) * e));
      m.children[0].material.opacity = 0.9 * (1 - k);
      m.children[1].material.opacity = 0.25 * (1 - k);
    }
  };

  FX.pillar = {
    make(o) {
      const grp = new THREE.Group();
      const beam = new THREE.Mesh(g.cyl(1, 1, 1, 24, true), glowMat(o.color, 0.6));
      beam.scale.set(o.r, 700, o.r); beam.position.y = 350;
      const core = new THREE.Mesh(g.cyl(1, 1, 1, 16, true), glowMat(0xffffff, 0.7));
      core.scale.set(o.r * 0.35, 700, o.r * 0.35); core.position.y = 350;
      grp.add(beam, core, K.glow(o.color, o.r * 6, 0.9));
      grp.children[2].position.y = 40;
      return at(grp, o.x, o.y);
    },
    update(m, o) {
      const k = env(o, 0.08, 0.5);
      m.children[0].material.opacity = 0.55 * k;
      m.children[1].material.opacity = 0.7 * k;
      m.children[2].material.opacity = k;
      const w = 0.6 + 0.4 * k;
      m.children[0].scale.x = m.children[0].scale.z = o.r * w;
      m.rotation.y += 0.05;
    }
  };

  // Swept arc around (x, y): a blade trail. arc = angular width; spin = direction of the sweep.
  FX.slash = {
    make(o) {
      const grp = new THREE.Group();
      const arc = Math.min(o.arc, Math.PI * 2);
      const outer = new THREE.Mesh(new THREE.RingGeometry(o.r * 0.72, o.r, 40, 1, -arc / 2, arc).rotateX(-Math.PI / 2), glowMat(o.color, 0.85));
      const inner = new THREE.Mesh(new THREE.RingGeometry(o.r * 0.35, o.r * 0.72, 40, 1, -arc / 2, arc).rotateX(-Math.PI / 2), glowMat(o.color, 0.25));
      grp.add(outer, inner);
      grp.rotation.y = -o.angle;
      return at(grp, o.x, o.y, 28);
    },
    update(m, o) {
      const k = o.t / o.dur;
      m.children[0].material.opacity = 0.85 * (1 - k);
      m.children[1].material.opacity = 0.25 * (1 - k);
      m.rotation.y = -o.angle - (o.spin || 1) * (k - 0.5) * (o.arc >= 6 ? 3 : 1.2);
      m.scale.setScalar(0.85 + k * 0.25);
    }
  };

  // Fan on the ground (claw sweeps, breath of fire).
  FX.cone = {
    make(o) {
      const grp = new THREE.Group();
      grp.add(new THREE.Mesh(new THREE.RingGeometry(8, o.r, 36, 1, -o.arc / 2, o.arc).rotateX(-Math.PI / 2), glowMat(o.color, 0.55)));
      grp.add(new THREE.Mesh(new THREE.RingGeometry(o.r * 0.9, o.r, 36, 1, -o.arc / 2, o.arc).rotateX(-Math.PI / 2), glowMat(0xffffff, 0.6)));
      if (o.fire) {
        o.flames = [];
        for (let i = 0; i < 22; i++) {
          const s = K.glow(i % 3 ? 0xff7a2a : 0xffd080, 40 + Math.random() * 40, 0.9);
          s.userData = { a: (Math.random() - 0.5) * o.arc * 0.9, v: 0.6 + Math.random() * 0.6, d: Math.random() * 0.3 };
          grp.add(s); o.flames.push(s);
        }
      }
      grp.rotation.y = -o.angle;
      return at(grp, o.x, o.y, 4);
    },
    update(m, o) {
      const k = o.t / o.dur;
      m.children[0].material.opacity = 0.55 * (1 - k);
      m.children[1].material.opacity = 0.6 * (1 - k);
      m.scale.setScalar(0.5 + Math.min(1, k * 4) * 0.5);
      if (o.flames) for (const s of o.flames) {
        const u = s.userData, f = Math.min(1, (k + u.d) * u.v * 1.6);
        s.position.set(Math.cos(u.a) * o.r * f, 20 + f * 30, -Math.sin(u.a) * o.r * f);
        s.material.opacity = 0.9 * (1 - k);
      }
    }
  };

  // Straight thrust streak.
  FX.thrust = {
    make(o) {
      const grp = new THREE.Group();
      const len = G.dist(o.x, o.y, o.x2, o.y2);
      const ground = add(grp, g.plane(1, 1), glowMat(o.color, 0.45), len / 2, -26, 0, { rx: -Math.PI / 2, shadow: false });
      ground.scale.set(len, o.w, 1);
      const streak = add(grp, unitBox, glowMat(0xffffff, 0.9), len / 2, 0, 0, { shadow: false });
      streak.scale.set(len, 5, 5);
      const halo = add(grp, unitBox, glowMat(o.color, 0.4), len / 2, 0, 0, { shadow: false });
      halo.scale.set(len, 18, 18);
      const tip = K.glow(o.color, 90, 1); tip.position.x = len; grp.add(tip);
      grp.rotation.y = -Math.atan2(o.y2 - o.y, o.x2 - o.x);
      return remember(at(grp, o.x, o.y, 30));
    },
    update(m, o) {
      const k = o.t / o.dur;
      setFade(m, 1 - k);
      m.scale.set(Math.min(1, 0.3 + k * 5), 1, 1);
    }
  };

  // Teleport streak with a ghost at each end.
  FX.blink = {
    make(o) {
      const grp = new THREE.Group();
      const beam = new THREE.Mesh(unitBox, glowMat(o.color, 0.8));
      const core = new THREE.Mesh(unitBox, glowMat(0xffffff, 0.9));
      span(beam, o.x, 40, o.y, o.x2, 40, o.y2, 14);
      span(core, o.x, 40, o.y, o.x2, 40, o.y2, 4);
      const a = K.glow(o.color, 110, 0.9); a.position.set(o.x, 40, o.y);
      const b = K.glow(0xffffff, 80, 0.9); b.position.set(o.x2, 40, o.y2);
      grp.add(beam, core, a, b);
      return remember(grp);
    },
    update(m, o) { setFade(m, 1 - o.t / o.dur); }
  };

  // Lightning arc between two points.
  FX.arc = {
    make(o) {
      const grp = new THREE.Group();
      for (let i = 0; i < 6; i++) grp.add(new THREE.Mesh(unitBox, glowMat(i % 2 ? 0xffffff : o.color, 0.9)));
      return grp;
    },
    update(m, o) {
      const n = m.children.length;
      let px = o.x, py = o.y, ph = 40;
      for (let i = 0; i < n; i++) {
        const k = (i + 1) / n, j = i === n - 1 ? 0 : 1;
        const nx = G.lerp(o.x, o.x2, k) + (Math.random() - 0.5) * 30 * j, ny = G.lerp(o.y, o.y2, k) + (Math.random() - 0.5) * 30 * j;
        const nh = 40 + (Math.random() - 0.5) * 24 * j;
        span(m.children[i], px, ph, py, nx, nh, ny, 3);
        m.children[i].material.opacity = 0.9 * (1 - o.t / o.dur);
        px = nx; py = ny; ph = nh;
      }
    }
  };

  // Life drain beam between two entities, with motes flowing back to the caster.
  FX.tether = {
    make(o) {
      const grp = new THREE.Group();
      grp.add(new THREE.Mesh(unitCyl, glowMat(o.color, 0.55)), new THREE.Mesh(unitCyl, glowMat(0xffffff, 0.7)));
      o.motes = [0, 1, 2, 3].map(i => { const s = K.glow(o.color, 26, 1); grp.add(s); return { s, ph: i / 4 }; });
      return grp;
    },
    update(m, o, time) {
      const a = o.a, b = o.b;
      if (!a || !b) return;
      const ah = 55 + (a.lift || 0), bh = 40;
      const w = 7 + Math.sin(time * 20) * 2;
      span(m.children[0], a.x, ah, a.y, b.x, bh, b.y, w);
      span(m.children[1], a.x, ah, a.y, b.x, bh, b.y, 2.2);
      for (const mt of o.motes) {
        const k = (time * 1.6 + mt.ph) % 1;
        mt.s.position.set(G.lerp(b.x, a.x, k), G.lerp(bh, ah, k) + Math.sin(k * Math.PI) * 18, G.lerp(b.y, a.y, k));
      }
    }
  };

  // A soul wisp flying from where a foe fell to a hero.
  FX.soul = {
    make(o) {
      const grp = new THREE.Group();
      grp.add(K.glow(o.color, 40, 1), K.glow(0xffffff, 16, 1));
      return grp;
    },
    update(m, o) {
      const k = o.t / o.dur, to = o.to;
      const e = k * k * (3 - 2 * k);
      m.position.set(G.lerp(o.x, to.x, e), 40 + Math.sin(k * Math.PI) * 90, G.lerp(o.y, to.y, e));
      m.children[0].material.opacity = 1 - k * 0.5;
    }
  };

  // ---------------------------------------------------------------------------------------------
  // Bannerspear: rallying banner / great standard
  // ---------------------------------------------------------------------------------------------
  FX.banner = {
    make(o) {
      const grp = new THREE.Group();
      const S = o.big ? 1.5 : 1;
      const teamC = K.teamHex(o.team), gold = K.metal(0xd9a530, 0.35), wood = K.m(0x4a3320);
      const pole = new THREE.Group(); grp.add(pole);
      add(pole, g.cyl(3 * S, 4 * S, 190 * S, 8), wood, 0, 95 * S, 0);
      add(pole, g.cone(6 * S, 26 * S, 6), gold, 0, 200 * S, 0);
      add(pole, g.cyl(1.8 * S, 1.8 * S, 80 * S, 6), gold, 32 * S, 178 * S, 0, { rz: Math.PI / 2 });
      for (const x of [-6, 72]) add(pole, g.sph(4 * S, 8, 6), gold, x * S, 178 * S, 0);
      const clothMat = K.mat(teamC, { side: THREE.DoubleSide, flatShading: false });
      const cloth = K.cloth(70 * S, 100 * S, clothMat, 6, 8);
      cloth.mesh.position.set(34 * S, 126 * S, 0);
      pole.add(cloth.mesh);
      // Emblem: a golden spearhead on the cloth.
      add(pole, g.cone(9 * S, 34 * S, 4), K.lit(0xffd060), 34 * S, 130 * S, 2, { rz: Math.PI, shadow: false });
      add(pole, g.cone(9 * S, 34 * S, 4), K.lit(0xffd060), 34 * S, 130 * S, -2, { rz: Math.PI, shadow: false });
      // Tassels
      for (const x of [4, 34, 64]) add(pole, g.cone(3 * S, 14 * S, 4), gold, x * S, 72 * S, 0, { rx: Math.PI });
      const fin = K.glow(0xffe08a, 70 * S, 0.9); fin.position.y = 205 * S; pole.add(fin);
      // Ground: base stones and aura ring.
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; add(grp, g.dodec(8 * S), K.m(0x55555c), Math.cos(a) * 14 * S, 4, Math.sin(a) * 14 * S); }
      const ringMat = glowMat(o.big ? 0xffd060 : 0xe8c060, 0.55);
      const ring = new THREE.Mesh(g.ring(o.r - 6, o.r, 72), ringMat); ring.position.y = 2;
      const fill = new THREE.Mesh(g.disc(o.r, 72), fadeMat(o.big ? 0xffd060 : teamC, 0.08)); fill.position.y = 1.5;
      const ticks = new THREE.Group(); ticks.position.y = 2.2;
      for (let i = 0; i < 16; i++) {
        const t = new THREE.Mesh(new THREE.RingGeometry(o.r - 18, o.r - 10, 6, 1, i / 16 * Math.PI * 2, 0.18).rotateX(-Math.PI / 2), glowMat(0xffe08a, 0.6));
        ticks.add(t);
      }
      grp.add(ring, fill, ticks);
      grp.userData = { pole, cloth, ring, ringMat, fill, ticks, S };
      return at(grp, o.x, o.y);
    },
    update(m, o, time) {
      const u = m.userData;
      const drop = Math.max(0, 1 - o.t / 0.22);
      u.pole.position.y = drop * drop * 500;
      u.cloth.wave(time, 0.14);
      u.ticks.rotation.y = time * 0.4;
      const k = env(o, 0.25, 0.4);
      u.ringMat.opacity = (0.4 + Math.sin(time * 4) * 0.15) * k;
      u.fill.material.opacity = 0.08 * k;
      u.pole.scale.setScalar(Math.max(0.01, Math.min(1, (o.dur - o.t) / 0.3)));
    }
  };

  // ---------------------------------------------------------------------------------------------
  // Boneshaper: graves, bones
  // ---------------------------------------------------------------------------------------------
  FX.grave = {
    make(o) {
      const grp = new THREE.Group();
      const crack = new THREE.Mesh(g.disc(o.r, 32), fadeMat(0x0c1410, 0.75)); crack.position.y = 1.2; grp.add(crack);
      const rim = new THREE.Mesh(g.ring(o.r * 0.85, o.r, 48), glowMat(0x9ff0b8, 0.7)); rim.position.y = 1.6; grp.add(rim);
      const bone = K.m(0xd8d2bc);
      o.bones = [];
      const n = o.big ? 22 : 12;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * o.r * 0.85;
        const b = new THREE.Group();
        if (i % 4 === 0) { add(b, g.sph(7, 8, 6), bone, 0, 0, 0); add(b, g.box(8, 4, 6), bone, 2, -6, 0); }
        else { add(b, g.cyl(2.2, 2.2, 26, 5), bone, 0, 0, 0); add(b, g.sph(3.5, 6, 5), bone, 0, 13, 0); add(b, g.sph(3.5, 6, 5), bone, 0, -13, 0); }
        b.position.set(Math.cos(a) * d, -20, Math.sin(a) * d);
        b.rotation.set(Math.random() * 2, Math.random() * 6, Math.random() * 2);
        b.userData = { v: 120 + Math.random() * 160, spin: (Math.random() - 0.5) * 8, delay: Math.random() * 0.25 };
        grp.add(b); o.bones.push(b);
      }
      grp.add(K.glow(0x9ff0b8, o.r * 3, 0.6));
      return at(grp, o.x, o.y);
    },
    update(m, o) {
      const k = o.t / o.dur;
      m.children[0].material.opacity = 0.75 * (1 - k);
      m.children[1].material.opacity = 0.7 * (1 - k);
      m.children[m.children.length - 1].material.opacity = 0.6 * (1 - k);
      for (const b of o.bones) {
        const u = b.userData, t = Math.max(0, o.t - u.delay);
        b.position.y = -20 + u.v * t - 260 * t * t;
        b.rotation.x += u.spin * 0.016; b.rotation.z += u.spin * 0.01;
        b.visible = b.position.y > -18;
      }
    }
  };

  // ---------------------------------------------------------------------------------------------
  // Deathwalker: shadow pools, night field
  // ---------------------------------------------------------------------------------------------
  FX.shadowPool = {
    make(o) {
      const grp = new THREE.Group();
      const pool = new THREE.Mesh(g.disc(o.r, 40), fadeMat(0x0a0612, 0.7)); pool.position.y = 1.3;
      const rim = new THREE.Mesh(g.ring(o.r * 0.8, o.r, 48), glowMat(0x9a6cff, 0.6)); rim.position.y = 1.7;
      grp.add(pool, rim);
      o.wisps = [];
      for (let i = 0; i < 7; i++) {
        const s = K.glow(0x9a6cff, 30, 0.8);
        s.userData = { a: Math.random() * 6.28, d: Math.random() * o.r * 0.8, ph: Math.random() };
        grp.add(s); o.wisps.push(s);
      }
      return remember(at(grp, o.x, o.y));
    },
    update(m, o, time) {
      setFade(m, env(o, 0.15, 0.5));
      for (const s of o.wisps) {
        const u = s.userData, k = (time * 0.7 + u.ph) % 1;
        s.position.set(Math.cos(u.a + time) * u.d, k * 80, Math.sin(u.a + time) * u.d);
        s.material.opacity = (1 - k) * 0.8 * env(o, 0.15, 0.5);
      }
    }
  };

  FX.night = {
    make(o) {
      const grp = new THREE.Group();
      const dome = new THREE.Mesh(g.dome(o.r, 32, 12), fadeMat(0x07040e, 0.45)); dome.scale.y = 0.6;
      const floor = new THREE.Mesh(g.disc(o.r, 64), fadeMat(0x05030a, 0.6)); floor.position.y = 1.4;
      const rim = new THREE.Mesh(g.ring(o.r - 8, o.r, 96), glowMat(0x9a6cff, 0.8)); rim.position.y = 2;
      const runes = new THREE.Group(); runes.position.y = 2.4;
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2;
        const r = new THREE.Mesh(g.ring(10, 16, 4), glowMat(0xb28cff, 0.8));
        r.position.set(Math.cos(a) * (o.r - 34), 0, Math.sin(a) * (o.r - 34));
        runes.add(r);
      }
      // A spectral scythe circling the field.
      const scythe = new THREE.Group();
      const handle = add(scythe, g.cyl(2, 2, 160, 6), glowMat(0xb28cff, 0.6), 0, 80, 0, { shadow: false });
      const blade = new THREE.Mesh(new THREE.TorusGeometry(60, 5, 4, 20, Math.PI * 0.8), glowMat(0xe0d0ff, 0.8));
      blade.position.set(0, 160, 0); blade.rotation.set(0, 0, Math.PI * 0.6); scythe.add(blade);
      scythe.position.x = o.r * 0.7; scythe.rotation.z = 0.5;
      const pivot = new THREE.Group(); pivot.add(scythe);
      o.wisps = [];
      for (let i = 0; i < 14; i++) {
        const s = K.glow(0x9a6cff, 50, 0.7);
        s.userData = { a: Math.random() * 6.28, d: Math.random() * o.r, ph: Math.random() };
        grp.add(s); o.wisps.push(s);
      }
      grp.add(dome, floor, rim, runes, pivot, K.glow(0x6a3cff, o.r * 2.2, 0.35));
      grp.userData = { runes, pivot, handle };
      return remember(at(grp, o.x, o.y));
    },
    update(m, o, time) {
      const k = env(o, 0.3, 0.3);
      setFade(m, k);
      m.scale.set(1, 0.2 + 0.8 * Math.min(1, o.t / 0.3), 1);
      m.userData.runes.rotation.y = -time * 0.5;
      m.userData.pivot.rotation.y = time * 2.2;
      for (const s of o.wisps) {
        const u = s.userData, f = (time * 0.5 + u.ph) % 1;
        s.position.set(Math.cos(u.a - time * 0.6) * u.d, 10 + f * 120, Math.sin(u.a - time * 0.6) * u.d);
        s.material.opacity = (1 - f) * 0.7 * k;
      }
    }
  };

  // ---------------------------------------------------------------------------------------------
  // Geminate: spiraling shards
  // ---------------------------------------------------------------------------------------------
  FX.shards = {
    make(o) {
      const grp = new THREE.Group();
      for (const s of o.shards) {
        const p = new THREE.Group();
        add(p, g.oct(7), K.lit(s.color), 0, 0, 0, { sy: 2.2, shadow: false });
        p.add(K.glow(s.color, 46, 0.9));
        grp.add(p); s.mesh = p;
      }
      return grp;
    },
    update(m, o, time) {
      for (const s of o.shards) {
        s.mesh.visible = !s.done;
        s.mesh.position.set(s.x, s.h, s.y);
        s.mesh.rotation.set(time * 8, time * 5, 0);
      }
    }
  };

  // ---------------------------------------------------------------------------------------------
  // Crushing Tide: whirlpool, tsunami
  // ---------------------------------------------------------------------------------------------
  FX.whirlpool = {
    make(o) {
      const grp = new THREE.Group();
      const deep = new THREE.Mesh(g.disc(o.r, 48), fadeMat(0x0a2a3a, 0.75)); deep.position.y = 1.2; grp.add(deep);
      o.arms = [];
      for (let i = 0; i < 4; i++) {
        const r0 = o.r * (0.25 + i * 0.18);
        const arm = new THREE.Mesh(new THREE.RingGeometry(r0, r0 + o.r * 0.12, 32, 1, 0, Math.PI * 1.2).rotateX(-Math.PI / 2), glowMat(i % 2 ? 0x5fe0e8 : 0xdffcff, 0.6));
        arm.position.y = 1.6 + i * 0.2; grp.add(arm); o.arms.push(arm);
      }
      grp.add(K.glow(0x5fe0e8, o.r * 2.4, 0.4));
      for (let i = 0; i < 10; i++) {
        const s = K.glow(0xdffcff, 26, 0.9);
        s.userData = { a: i / 10 * 6.28, d: o.r * (0.4 + Math.random() * 0.6) };
        grp.add(s);
      }
      return remember(at(grp, o.x, o.y));
    },
    update(m, o, time) {
      setFade(m, env(o, 0.15, 0.4));
      o.arms.forEach((a, i) => { a.rotation.y = time * (4 - i * 0.6); });
      const shrink = Math.max(0.2, 1 - o.t / o.dur * 0.6);
      for (const c of m.children) if (c.isSprite && c.userData.d) {
        const u = c.userData, a = u.a + time * 5;
        c.position.set(Math.cos(a) * u.d * shrink, 6, Math.sin(a) * u.d * shrink);
      }
    }
  };

  // A wall of water rolling along `angle` from (x0, y0).
  FX.wave = {
    make(o) {
      const grp = new THREE.Group();
      const wall = new THREE.Group(); grp.add(wall);
      // Curling crest: a half-cylinder lying across the path, plus a lower body.
      const water = K.mat(0x2a8aa8, { transparent: true, opacity: 0.78, metalness: 0.3, roughness: 0.2, flatShading: false, side: THREE.DoubleSide });
      const crest = add(wall, new THREE.CylinderGeometry(55, 55, o.width, 20, 1, true, 0, Math.PI), water, 0, 70, 0, { rx: Math.PI / 2, shadow: false });
      crest.rotation.y = Math.PI / 2;
      const body = add(wall, g.box(70, 80, o.width), water, -30, 40, 0, { shadow: false });
      const foamMat = K.lit(0xeaffff, { transparent: true, opacity: 0.9 });
      for (let i = 0; i < 14; i++) add(wall, g.sph(10 + Math.random() * 8, 6, 5), foamMat, 20 + Math.random() * 20, 110 + Math.random() * 18, (i / 13 - 0.5) * o.width, { shadow: false });
      o.spray = [];
      for (let i = 0; i < 18; i++) {
        const s = K.glow(0xdffcff, 40 + Math.random() * 40, 0.8);
        s.userData = { z: (Math.random() - 0.5) * o.width, ph: Math.random() };
        wall.add(s); o.spray.push(s);
      }
      // Wet trail left behind.
      const trailMat = fadeMat(0x1a5a70, 0.4);
      const trail = add(grp, g.plane(1, 1), trailMat, 0, 1.5, 0, { rx: -Math.PI / 2, shadow: false });
      grp.userData = { wall, trail, trailMat, body, water };
      grp.rotation.y = -o.angle;
      return at(grp, o.x0, o.y0);
    },
    update(m, o, time) {
      const u = m.userData, front = Math.min(o.len, o.t * o.speed);
      const k = env(o, 0.15, 0.35);
      u.wall.position.x = front;
      u.wall.scale.set(1, 0.4 + 0.6 * k, 1);
      u.water.opacity = 0.78 * k;
      u.trail.scale.set(Math.max(1, front), o.width * 0.9, 1);
      u.trail.position.x = front / 2;
      u.trailMat.opacity = 0.35 * k;
      for (const s of o.spray) {
        const f = (time * 1.5 + s.userData.ph) % 1;
        s.position.set(30 + f * 40, 100 + f * 60, s.userData.z);
        s.material.opacity = (1 - f) * 0.8 * k;
      }
    }
  };

  // ---------------------------------------------------------------------------------------------
  // Trapper: chain, bear traps, nets, spikes
  // ---------------------------------------------------------------------------------------------
  FX.chain = {
    make() {
      const grp = new THREE.Group();
      grp.add(new THREE.Mesh(unitCyl, K.metal(0x8a8f96, 0.5)));
      return grp;
    },
    update(m, o) {
      const a = o.a, b = o.b;
      m.visible = !!(a && b && !a.dead);
      if (!m.visible) return;
      span(m.children[0], a.x, 36 + (a.lift || 0), a.y, b.x, b.h || 36, b.y, 2.5);
    }
  };

  function trapModel() {
    const grp = new THREE.Group();
    const steel = K.metal(0x6a6e74, 0.5), dark = K.m(0x2a2620);
    add(grp, g.cyl(14, 16, 3, 12), dark, 0, 1.5, 0);
    add(grp, g.torus(26, 2, 4, 16), steel, 0, 3, 0, { rx: Math.PI / 2 });
    const jaws = [];
    for (const side of [-1, 1]) {
      const jaw = new THREE.Group(); jaw.position.set(0, 3, 0);
      const half = new THREE.Mesh(new THREE.TorusGeometry(24, 2.2, 4, 10, Math.PI), steel);
      half.rotation.x = Math.PI / 2; half.rotation.z = side > 0 ? 0 : Math.PI;
      jaw.add(half);
      for (let i = 0; i < 6; i++) {
        const a = (i + 0.5) / 6 * Math.PI * (side > 0 ? 1 : -1);
        add(jaw, g.cone(2.6, 9, 4), steel, Math.cos(a) * 24, 4, Math.sin(a) * 24 * 1, { shadow: false });
      }
      grp.add(jaw); jaws.push({ jaw, side });
    }
    add(grp, g.cyl(5, 5, 3, 8), K.m(0xb08a4e, { metalness: 0.6 }), 0, 4, 0);
    grp.userData.jaws = jaws;
    return grp;
  }
  FX.trap = {
    make(o) {
      const grp = trapModel();
      grp.rotation.y = Math.random() * 6.28;
      const ring = new THREE.Mesh(g.ring(o.r - 3, o.r, 32), glowMat(0xd8b060, 0.35)); ring.position.y = 1.4;
      grp.add(ring); grp.userData.ring = ring;
      return at(grp, o.x, o.y);
    },
    update(m, o, time) {
      const u = m.userData;
      const armed = o.t >= o.armT;
      // Jaws: open flat while set, snap shut (upright) when sprung.
      const close = o.sprung ? Math.min(1, o.sprung / 0.08) : 0;
      for (const j of u.jaws) j.jaw.rotation.x = j.side * close * 1.45;
      u.ring.material.opacity = armed && !o.sprung ? 0.2 + Math.sin(time * 3) * 0.1 : 0;
      m.position.y = armed ? 0 : -2;
      const fadeOut = o.sprung ? Math.max(0, 1 - Math.max(0, o.sprung - 0.6) / 0.4) : Math.min(1, (o.dur - o.t) / 0.3);
      m.scale.setScalar(Math.max(0.01, fadeOut));
    }
  };

  // A thrown object along an arc (the net, before it opens).
  FX.lob = {
    make() {
      const grp = new THREE.Group();
      add(grp, g.ico(12, 1), new THREE.MeshBasicMaterial({ color: 0xb8a070, wireframe: true }), 0, 0, 0, { shadow: false });
      for (let i = 0; i < 4; i++) add(grp, g.sph(3, 6, 5), K.metal(0x55595f), Math.cos(i * 1.57) * 12, 0, Math.sin(i * 1.57) * 12);
      return grp;
    },
    update(m, o, time) {
      const k = o.t / o.dur, d = G.dist(o.x0, o.y0, o.x, o.y);
      m.position.set(G.lerp(o.x0, o.x, k), 40 + d * 0.5 * k * (1 - k), G.lerp(o.y0, o.y, k));
      m.rotation.set(time * 9, time * 6, 0);
    }
  };

  FX.net = {
    make(o) {
      const grp = new THREE.Group();
      const ropes = new THREE.Mesh(new THREE.CircleGeometry(o.r, 16, 0, Math.PI * 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xc8b080, wireframe: true, transparent: true, opacity: 0.9 }));
      ropes.position.y = 6;
      const ropes2 = ropes.clone(); ropes2.rotation.y = 0.2; ropes2.scale.setScalar(0.7);
      grp.add(ropes, ropes2);
      for (let i = 0; i < 10; i++) { const a = i / 10 * 6.28; add(grp, g.sph(5, 6, 5), K.metal(0x55595f), Math.cos(a) * o.r, 5, Math.sin(a) * o.r); }
      return remember(at(grp, o.x, o.y));
    },
    update(m, o) {
      const k = o.t / o.dur;
      m.scale.setScalar(Math.min(1, 0.3 + o.t * 8));
      setFade(m, Math.min(1, (o.dur - o.t) / 0.4));
      m.position.y = -k * 3;
    }
  };

  FX.spikes = {
    make(o) {
      const grp = new THREE.Group();
      const steel = K.metal(0x8a8f96, 0.4);
      o.spikes = [];
      for (let i = 0; i < 30; i++) {
        const a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * o.r;
        const s = add(grp, g.cone(6, 46, 4), steel, Math.cos(a) * d, -40, Math.sin(a) * d, { rz: (Math.random() - 0.5) * 0.5 });
        s.userData.delay = d / o.r * 0.2;
        o.spikes.push(s);
      }
      return at(grp, o.x, o.y);
    },
    update(m, o) {
      for (const s of o.spikes) {
        const t = o.t - s.userData.delay;
        const up = t < 0 ? 0 : t < 0.1 ? t / 0.1 : t < o.dur - 0.35 ? 1 : Math.max(0, (o.dur - t) / 0.35 - 0.0);
        s.position.y = -24 + up * 44;
      }
    }
  };

  // ---------------------------------------------------------------------------------------------
  // Pyroclast: fire wall, magma field, meteors
  // ---------------------------------------------------------------------------------------------
  FX.firewall = {
    make(o) {
      const grp = new THREE.Group();
      const len = G.dist(o.x1, o.y1, o.x2, o.y2);
      const scorch = add(grp, g.plane(1, 1), fadeMat(0x1a0a04, 0.75), 0, 1.4, 0, { rx: -Math.PI / 2, shadow: false });
      scorch.scale.set(len + 30, o.w, 1);
      const glowLine = add(grp, g.plane(1, 1), glowMat(0xff5a10, 0.5), 0, 1.8, 0, { rx: -Math.PI / 2, shadow: false });
      glowLine.scale.set(len, o.w * 0.5, 1);
      o.flames = [];
      const n = Math.round(len / 22);
      for (let i = 0; i <= n; i++) {
        const x = (i / n - 0.5) * len;
        for (let j = 0; j < 2; j++) {
          const s = K.glow(j ? 0xffc060 : 0xff5a10, 60, 0.9);
          s.userData = { x: x + (Math.random() - 0.5) * 10, z: (Math.random() - 0.5) * o.w * 0.5, ph: Math.random() * 6, j };
          grp.add(s); o.flames.push(s);
        }
      }
      const light = G.kit.light(0xff7a30, 2.5, 520, 2); light.position.y = 60; grp.add(light);
      grp.userData = { light, glowLine };
      grp.rotation.y = -Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
      return remember(at(grp, o.x, o.y));
    },
    update(m, o, time) {
      const k = env(o, 0.3, 0.6);
      setFade(m, k);
      m.userData.light.intensity = 2.5 * k * (0.85 + Math.random() * 0.3);
      for (const s of o.flames) {
        const u = s.userData, fl = 0.75 + 0.35 * Math.sin(time * 14 + u.ph);
        s.position.set(u.x, (u.j ? 26 : 40) * fl * k, u.z);
        s.scale.set((u.j ? 34 : 56) * fl, (u.j ? 60 : 110) * fl * k, 1);
      }
    }
  };

  // Crack texture for the magma field.
  let crackTex = null;
  function cracks() {
    if (crackTex) return crackTex;
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d');
    const grd = x.createRadialGradient(128, 128, 10, 128, 128, 128);
    grd.addColorStop(0, '#ffd070'); grd.addColorStop(0.5, '#ff6a10'); grd.addColorStop(1, 'rgba(120,20,0,0)');
    x.fillStyle = grd; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = '#1a0804'; x.lineCap = 'round';
    for (let i = 0; i < 40; i++) {
      x.lineWidth = 3 + Math.random() * 8;
      let px = Math.random() * 256, py = Math.random() * 256;
      x.beginPath(); x.moveTo(px, py);
      for (let k = 0; k < 5; k++) { px += (Math.random() - 0.5) * 70; py += (Math.random() - 0.5) * 70; x.lineTo(px, py); }
      x.stroke();
    }
    crackTex = new THREE.CanvasTexture(c);
    return crackTex;
  }
  FX.magma = {
    make(o) {
      const grp = new THREE.Group();
      const lava = new THREE.Mesh(g.disc(o.r, 48), new THREE.MeshBasicMaterial({ map: cracks(), transparent: true, opacity: 0.95, depthWrite: false }));
      lava.position.y = 1.5;
      grp.add(lava, K.glow(0xff5a10, o.r * 2.6, 0.5));
      const light = G.kit.light(0xff6a20, 3, o.r * 3, 2); light.position.y = 80; grp.add(light);
      o.bubbles = [];
      for (let i = 0; i < 16; i++) {
        const s = K.glow(0xffb050, 30, 0.9);
        s.userData = { a: Math.random() * 6.28, d: Math.random() * o.r * 0.9, ph: Math.random() };
        grp.add(s); o.bubbles.push(s);
      }
      grp.userData = { lava, light };
      return remember(at(grp, o.x, o.y));
    },
    update(m, o, time) {
      const k = env(o, 0.3, 0.8);
      setFade(m, k);
      m.userData.lava.rotation.y = time * 0.05;
      m.userData.light.intensity = 3 * k * (0.9 + Math.sin(time * 9) * 0.1);
      for (const s of o.bubbles) {
        const u = s.userData, f = (time * 0.8 + u.ph) % 1;
        s.position.set(Math.cos(u.a) * u.d, 4 + f * 30, Math.sin(u.a) * u.d);
        s.material.opacity = (1 - f) * 0.9 * k;
      }
    }
  };

  FX.meteor = {
    make(o) {
      const grp = new THREE.Group();
      const rock = new THREE.Group();
      add(rock, g.dodec(22), K.m(0x2a1a14, { emissive: 0x401000 }), 0, 0, 0);
      add(rock, g.ico(15, 0), K.lit(0xff7a20), 4, 4, 4, { shadow: false });
      rock.add(K.glow(0xff7a20, 140, 0.95), K.glow(0xffe0a0, 60, 0.9));
      const trail = new THREE.Group();
      for (let i = 1; i <= 6; i++) { const s = K.glow(i < 3 ? 0xffb050 : 0x6a4030, 90 - i * 8, 0.8 - i * 0.1); s.position.set(-i * 26, i * 40, -i * 18); trail.add(s); }
      rock.add(trail);
      const marker = new THREE.Mesh(g.ring(70, 80, 40), glowMat(0xff5a20, 0.6)); marker.position.set(o.x, 2, o.y);
      grp.add(rock, marker);
      grp.userData = { rock, marker };
      return grp;
    },
    update(m, o, time) {
      const k = o.t / o.dur, u = m.userData;
      u.rock.position.set(o.x + 200 * (1 - k), 750 * (1 - k), o.y + 140 * (1 - k));
      u.rock.rotation.set(time * 4, time * 3, 0);
      u.marker.scale.setScalar(1 - k * 0.7);
      u.marker.material.opacity = 0.3 + k * 0.5;
    }
  };

  // ---------------------------------------------------------------------------------------------
  // Drifter: campfire, spectral stampede
  // ---------------------------------------------------------------------------------------------
  FX.camp = {
    make(o) {
      const grp = new THREE.Group();
      const stone = K.m(0x55555c), wood = K.m(0x4a3320), cloth = K.m(0x8a6a4a), dark = K.m(0x2a1e14);
      for (let i = 0; i < 9; i++) { const a = i / 9 * 6.28; add(grp, g.dodec(7), stone, Math.cos(a) * 20, 4, Math.sin(a) * 20); }
      for (let i = 0; i < 4; i++) add(grp, g.cyl(3, 3, 34, 6), wood, 0, 9, 0, { rz: Math.PI / 2 - 0.35, ry: i * Math.PI / 4 });
      // A lean-to tent, a bedroll and a hanging pot.
      add(grp, g.cone(36, 50, 4), cloth, -60, 25, -30, { ry: Math.PI / 4 });
      add(grp, g.cyl(7, 7, 40, 8), K.m(0x6a4a8a), -40, 7, 30, { rz: Math.PI / 2 });
      for (const x of [-16, 16]) add(grp, g.cyl(1.5, 1.5, 44, 4), dark, x, 22, 0, { rz: x > 0 ? -0.35 : 0.35 });
      add(grp, g.cyl(1, 1, 36, 4), dark, 0, 42, 0, { rz: Math.PI / 2 });
      add(grp, g.sph(7, 8, 6), K.metal(0x3a3a3e), 0, 30, 0);
      const flames = [];
      for (let i = 0; i < 5; i++) { const s = K.glow(i % 2 ? 0xffc060 : 0xff6a20, 44, 0.95); grp.add(s); flames.push(s); }
      const light = G.kit.light(0xffa040, 2.6, 600, 2); light.position.y = 50; grp.add(light);
      const ring = new THREE.Mesh(g.ring(o.r - 5, o.r, 64), glowMat(0xf0c070, 0.4)); ring.position.y = 1.6;
      const fill = new THREE.Mesh(g.disc(o.r, 64), fadeMat(0xf0c070, 0.06)); fill.position.y = 1.2;
      grp.add(ring, fill);
      o.motes = [];
      for (let i = 0; i < 12; i++) {
        const s = K.glow(0x9fe3a0, 18, 0.9);
        s.userData = { a: Math.random() * 6.28, d: 30 + Math.random() * (o.r - 40), ph: Math.random() };
        grp.add(s); o.motes.push(s);
      }
      grp.userData = { flames, light, ring, fill };
      return at(grp, o.x, o.y);
    },
    update(m, o, time) {
      const u = m.userData, k = env(o, 0.2, 0.6);
      u.flames.forEach((s, i) => {
        const f = 0.75 + 0.3 * Math.sin(time * 13 + i * 2);
        s.position.set(Math.sin(i * 2.3) * 5, 14 + i * 5 * f, Math.cos(i * 2.3) * 5);
        s.scale.set(40 * f * k, 60 * f * k, 1);
      });
      u.light.intensity = 2.6 * k * (0.85 + Math.random() * 0.2);
      u.ring.material.opacity = (0.3 + Math.sin(time * 3) * 0.1) * k;
      u.fill.material.opacity = 0.06 * k;
      for (const s of o.motes) {
        const v = s.userData, f = (time * 0.4 + v.ph) % 1;
        s.position.set(Math.cos(v.a) * v.d, 5 + f * 70, Math.sin(v.a) * v.d);
        s.material.opacity = Math.sin(f * Math.PI) * 0.9 * k;
      }
    }
  };

  function spectralMammoth(material, bright) {
    const b = new THREE.Group();
    add(b, g.ico(34, 1), material, 0, 52, 0, { sx: 1.35, sy: 1, sz: 1, shadow: false });
    add(b, g.ico(24, 1), material, 22, 76, 0, { shadow: false });          // hump
    add(b, g.ico(20, 1), material, 50, 58, 0, { shadow: false });          // head
    const trunk = new THREE.Group(); trunk.position.set(64, 50, 0); b.add(trunk);
    add(trunk, g.cyl(5, 7, 34, 6), material, 6, -16, 0, { rz: 0.4, shadow: false });
    add(trunk, g.cyl(3, 5, 18, 6), material, 6, -38, 0, { rz: -0.3, shadow: false });
    for (const z of [-12, 12]) {
      add(b, new THREE.TorusGeometry(22, 3, 4, 12, Math.PI * 0.6), bright, 62, 40, z, { rz: Math.PI * 0.95, shadow: false });
    }
    const legs = [];
    for (const [x, z] of [[-26, -18], [-26, 18], [24, -18], [24, 18]]) {
      const l = new THREE.Group(); l.position.set(x, 34, z); b.add(l);
      add(l, g.cyl(9, 8, 36, 6), material, 0, -18, 0, { shadow: false });
      legs.push(l);
    }
    b.add(K.glow(0x6aa8ff, 160, 0.18));
    b.userData.legs = legs; b.userData.trunk = trunk;
    return b;
  }
  FX.stampede = {
    make(o) {
      const grp = new THREE.Group();
      const herd = new THREE.Group(); grp.add(herd);
      const material = fadeMat(0xa8d4ff, 0.42), bright = glowMat(0xbfe8ff, 0.6);
      o.beasts = [];
      const n = 5;
      for (let i = 0; i < n; i++) {
        const b = spectralMammoth(material, bright);
        b.position.set(-(i % 2) * 70 - Math.random() * 30, 0, (i / (n - 1) - 0.5) * (o.width - 60));
        b.userData.ph = Math.random() * 6;
        herd.add(b); o.beasts.push(b);
      }
      o.dust = [];
      for (let i = 0; i < 16; i++) {
        const s = K.glow(0xcfe0f0, 60, 0.5);
        s.userData = { z: (Math.random() - 0.5) * o.width, ph: Math.random() };
        herd.add(s); o.dust.push(s);
      }
      grp.userData = { herd, material, bright };
      grp.rotation.y = -o.angle;
      return at(grp, o.x0, o.y0);
    },
    update(m, o, time) {
      const u = m.userData, front = Math.min(o.len, o.t * o.speed), k = env(o, 0.25, 0.4);
      u.herd.position.x = front;
      u.material.opacity = 0.42 * k; u.bright.opacity = 0.6 * k;
      for (const b of o.beasts) {
        const ph = time * 11 + b.userData.ph;
        b.userData.legs.forEach((l, i) => { l.rotation.z = Math.sin(ph + (i % 2 ? Math.PI : 0) + (i > 1 ? 0.6 : 0)) * 0.6; });
        b.userData.trunk.rotation.z = Math.sin(ph * 0.5) * 0.3;
        b.position.y = Math.abs(Math.sin(ph)) * 6;
      }
      for (const s of o.dust) {
        const f = (time * 1.2 + s.userData.ph) % 1;
        s.position.set(-40 - f * 120, 10 + f * 30, s.userData.z);
        s.material.opacity = (1 - f) * 0.5 * k;
      }
    }
  };

  // ---------------------------------------------------------------------------------------------
  // Projectile styles (+x = direction of flight)
  // ---------------------------------------------------------------------------------------------
  PROJ.boneShard = p => {
    const grp = new THREE.Group(), spin = new THREE.Group(); grp.add(spin);
    add(spin, g.cone(4, 26, 5), K.m(0xe8e2cc), 0, 0, 0, { rz: -Math.PI / 2, shadow: false });
    add(spin, g.cone(2.5, 12, 4), K.m(0xd8d2bc), -6, 3, 0, { rz: -Math.PI / 2 + 0.4, shadow: false });
    grp.add(K.glow(0x9ff0b8, 50, 0.8));
    grp.userData = { spin, spinRate: 18 };
    return grp;
  };
  PROJ.boneSpear = p => {
    const grp = new THREE.Group(), spin = new THREE.Group(); grp.add(spin);
    const bone = K.m(0xe8e2cc);
    add(spin, g.cyl(3, 4, 70, 6), bone, -10, 0, 0, { rz: Math.PI / 2, shadow: false });
    add(spin, g.cone(7, 26, 5), bone, 36, 0, 0, { rz: -Math.PI / 2, shadow: false });
    for (let i = 0; i < 5; i++) add(spin, g.cone(3, 14, 4), bone, -30 + i * 12, (i % 2 ? 1 : -1) * 6, 0, { rz: (i % 2 ? -1 : 1) * 2.4, shadow: false });
    grp.add(K.glow(0x9ff0b8, 120, 0.7), K.glow(0xffffff, 40, 0.8));
    grp.userData = { spin, spinRate: 10 };
    return grp;
  };
  PROJ.shadowBolt = p => {
    const grp = new THREE.Group();
    add(grp, g.ico(7, 1), K.lit(0x1a0a30), 0, 0, 0, { shadow: false });
    grp.add(K.glow(0x9a6cff, 70, 0.95));
    for (let i = 1; i <= 3; i++) { const s = K.glow(0x6a3cff, 40 - i * 8, 0.8 - i * 0.2); s.position.x = -i * 12; grp.add(s); }
    return grp;
  };
  PROJ.crescent = p => {
    const grp = new THREE.Group(), spin = new THREE.Group(); grp.add(spin);
    const blade = new THREE.Mesh(new THREE.TorusGeometry(30, 5, 4, 20, Math.PI * 1.1), glowMat(0xd8c8ff, 0.95));
    blade.rotation.x = Math.PI / 2;
    const halo = new THREE.Mesh(new THREE.TorusGeometry(30, 12, 4, 20, Math.PI * 1.1), glowMat(0x9a6cff, 0.45));
    halo.rotation.x = Math.PI / 2;
    spin.add(blade, halo);
    grp.add(K.glow(0x9a6cff, 110, 0.6));
    grp.userData = { tick(m, p, time) { spin.rotation.y = time * 16; } };
    return grp;
  };
  PROJ.twinOrb = p => {
    const c = new THREE.Color(p.color).getHex();
    const grp = new THREE.Group();
    add(grp, g.ico(6, 1), K.lit(0xffffff), 0, 0, 0, { shadow: false });
    grp.add(K.glow(c, 60, 0.95));
    const sat = K.glow(c === 0x6ff0e0 ? 0xff6fb8 : 0x6ff0e0, 22, 1); grp.add(sat);
    grp.userData = { tick(m, p, time) { sat.position.set(0, Math.sin(time * 20) * 12, Math.cos(time * 20) * 12); } };
    return grp;
  };
  PROJ.quarrel = p => {
    const grp = new THREE.Group();
    add(grp, g.cyl(1.4, 1.4, 34, 4), K.m(0x6b4a2a), 0, 0, 0, { rz: Math.PI / 2, shadow: false });
    add(grp, g.cone(3, 9, 4), K.metal(0xb8bcc2), 20, 0, 0, { rz: -Math.PI / 2, shadow: false });
    for (const r of [0, Math.PI / 2]) add(grp, g.box(9, 0.6, 6), K.m(0xc8402a), -14, 0, 0, { rx: r, shadow: false });
    return grp;
  };
  PROJ.harpoon = p => {
    const grp = new THREE.Group();
    const steel = K.metal(0x9aa0a8, 0.35);
    add(grp, g.cyl(2.2, 2.2, 50, 6), K.m(0x4a3320), -6, 0, 0, { rz: Math.PI / 2, shadow: false });
    add(grp, g.cone(5, 18, 4), steel, 26, 0, 0, { rz: -Math.PI / 2, shadow: false });
    for (const s of [-1, 1]) add(grp, g.cone(2.5, 12, 4), steel, 16, s * 5, 0, { rz: s * 2.5, shadow: false });
    add(grp, g.torus(3, 1, 4, 8), steel, -32, 0, 0, { shadow: false });
    return grp;
  };
  PROJ.ember = p => {
    const grp = new THREE.Group();
    add(grp, g.ico(6, 1), K.lit(0xffe0a0), 0, 0, 0, { shadow: false });
    grp.add(K.glow(0xff7a20, 70, 0.95));
    const flick = [];
    for (let i = 1; i <= 4; i++) { const s = K.glow(i % 2 ? 0xffb050 : 0xff5a10, 36 - i * 5, 0.85); s.position.x = -i * 10; grp.add(s); flick.push(s); }
    grp.userData = { tick(m, p, time) { flick.forEach((s, i) => { s.position.y = Math.sin(time * 30 + i) * 4; }); } };
    return grp;
  };
  PROJ.magma = p => {
    const grp = new THREE.Group(), spin = new THREE.Group(); grp.add(spin);
    add(spin, g.dodec(12), K.m(0x2a1410, { emissive: 0x6a1a00 }), 0, 0, 0, { shadow: false });
    for (let i = 0; i < 5; i++) add(spin, g.tet(5), K.lit(0xffa040), Math.cos(i * 1.25) * 9, Math.sin(i * 1.25) * 9, (i % 2 ? 4 : -4), { shadow: false });
    grp.add(K.glow(0xff5a10, 110, 0.9), K.glow(0xffd080, 40, 0.9));
    grp.userData = { spin, spinRate: 7 };
    return grp;
  };
})(window.Game);
