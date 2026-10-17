// Minimap (bottom right; bottom center in split screen): terrain, base ownership, units and each player's view.
// Right-click orders the hero to move there (one-player games only).
(function (G) {
  const WIDTH = 280;                       // CSS pixels
  const TEAM_CSS = { [G.TEAM.PLAYER]: '63,116,184', [G.TEAM.ENEMY]: '178,46,36' };
  const NEUTRAL_CSS = '120,116,108';

  let canvas, ctx, terrain, scale, H, countsEl;
  let lastCounts = '';

  const toMap = (x, y) => ({ x: x * scale, y: y * scale });
  const toWorld = (mx, my) => ({ x: G.clamp(mx / scale, 0, G.map.w), y: G.clamp(my / scale, 0, G.map.h) });

  function buildTerrain(dpr) {
    terrain = document.createElement('canvas');
    terrain.width = WIDTH * dpr; terrain.height = H * dpr;
    const t = terrain.getContext('2d');
    t.scale(dpr, dpr);
    t.fillStyle = '#5d6168'; t.fillRect(0, 0, WIDTH, H);
    t.fillStyle = 'rgba(125,147,168,0.45)';
    for (const p of G.map.ice) {
      t.beginPath(); t.ellipse(p.x * scale, p.y * scale, p.rx * scale, p.ry * scale, p.rot, 0, Math.PI * 2); t.fill();
    }
    t.fillStyle = '#7f95a8';
    t.fillRect((G.map.w / 2 - 65) * scale, 0, Math.max(2, 130 * scale), H);
    t.fillStyle = '#26262a';
    for (const k of G.map.rocks) { t.beginPath(); t.arc(k.x * scale, k.y * scale, Math.max(1.2, k.r * scale), 0, Math.PI * 2); t.fill(); }
    if (G.map.trees) {
      t.fillStyle = 'rgba(20,16,12,0.55)';
      for (const tr of G.map.trees) t.fillRect(tr.x * scale - 0.75, tr.y * scale - 0.75, 1.5, 1.5);
    }
  }

  function pointerWorld(e) {
    const r = canvas.getBoundingClientRect();
    return toWorld(e.clientX - r.left, e.clientY - r.top);
  }

  G.minimap = {
    init() {
      canvas = document.getElementById('minimap');
      countsEl = document.getElementById('minimapCounts');
      ctx = canvas.getContext('2d');
      scale = WIDTH / G.map.w;
      H = Math.round(G.map.h * scale);
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width = WIDTH + 'px'; canvas.style.height = H + 'px';
      canvas.width = WIDTH * dpr; canvas.height = H * dpr;
      ctx.scale(dpr, dpr);
      buildTerrain(dpr);

      canvas.addEventListener('contextmenu', e => e.preventDefault());
      canvas.addEventListener('mousedown', e => {
        const w = pointerWorld(e);
        // Right-click moves the mouse-and-keyboard player's hero (split screen: only if a side has the mouse).
        const p = G.players.length === 1 ? G.players[0] : G.players.find(pl => pl.keyboard);
        if (e.button === 2 && p) p.act.move(w.x, w.y);
      });
    },

    render() {
      ctx.drawImage(terrain, 0, 0, WIDTH, H);

      // Bases: filled + outlined in the owner's color, grey while neutral.
      const counts = { [G.TEAM.PLAYER]: 0, [G.TEAM.ENEMY]: 0, neutral: 0 };
      for (const b of G.bases) {
        const c = b.team === null ? NEUTRAL_CSS : TEAM_CSS[b.team];
        counts[b.team === null ? 'neutral' : b.team]++;
        const p = toMap(b.x, b.y), r = b.r * scale;
        ctx.fillStyle = `rgba(${c},${b.team === null ? 0.25 : 0.55})`;
        ctx.strokeStyle = `rgb(${c})`;
        ctx.lineWidth = b.team === null ? 1.5 : 2.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        for (const s of b.slots) {
          if (!s.building || s.wall) continue;
          const q = toMap(s.x, s.y), k = s.core ? 3.5 : 1.5;  // Command Center: a bigger, gold mark
          ctx.fillStyle = s.core ? '#ffd27a' : '#e9dcc2';
          ctx.fillRect(q.x - k, q.y - k, k * 2, k * 2);
        }
      }

      // Unit dots go into one path per color: a fill per dot was hundreds of draws a frame.
      for (const [team, color] of [[G.TEAM.PLAYER, '#7fb0e0'], [G.TEAM.ENEMY, '#e0503c'], [G.TEAM.NEUTRAL, '#b8a888']]) {
        ctx.beginPath();
        for (const e of G.entities) {
          if (e.dead || e.team !== team || e instanceof G.Hero) continue;
          const x = e.x * scale, y = e.y * scale;
          ctx.moveTo(x + 2.2, y); ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        }
        ctx.fillStyle = color; ctx.fill();
      }
      for (const e of G.entities) {
        if (e.dead || !(e instanceof G.Hero) || G.players.some(p => p.hero === e) || G.unseen(e)) continue;
        // An enemy hero: a bigger red mark.
        const p = toMap(e.x, e.y);
        ctx.fillStyle = '#ff7a5c'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      // Each player's hero: pale blue for the west, red-orange for the east.
      for (const { hero } of G.players) {
        if (G.unseen(hero)) continue;
        const hp = toMap(hero.x, hero.y);
        ctx.fillStyle = hero.team === G.TEAM.PLAYER ? '#bfe3ff' : '#ff7a5c'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(hp.x, hp.y, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }

      // Camera view: the ground footprint of the four screen corners (a trapezoid).
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, WIDTH, H); ctx.clip();
      ctx.strokeStyle = 'rgba(233,220,194,0.9)'; ctx.lineWidth = 1.2;
      for (const { cam } of G.players) {
        const corners = [[0, 0], [cam.w, 0], [cam.w, cam.h], [0, cam.h]].map(([sx, sy]) => {
          const w = cam.screenToWorld(sx, sy);
          return toMap(w.x, w.y);
        });
        ctx.beginPath();
        corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
        ctx.closePath(); ctx.stroke();
      }
      ctx.restore();

      // Only touch the DOM when the counts change: rewriting innerHTML every frame forces a relayout.
      // West is always on the left; one-player views name the sides from the viewer's (an East network player is "You" on the right).
      const split = G.players.length > 1, east = G.players[0].hero.team === G.TEAM.ENEMY;
      const [westName, eastName] = split ? ['West', 'East'] : east ? ['Enemy', 'You'] : ['You', 'Enemy'];
      const html =
        `<span class="you">${westName} ${counts[G.TEAM.PLAYER]}</span>` +
        `<span class="neutral">Neutral ${counts.neutral}</span>` +
        `<span class="enemy">${eastName} ${counts[G.TEAM.ENEMY]}</span>`;
      if (html !== lastCounts) { countsEl.innerHTML = html; lastCounts = html; }
    }
  };
})(window.Game);
