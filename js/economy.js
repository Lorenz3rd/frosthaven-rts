// Economy: gold. Fallen soldiers and destroyed buildings leave coin piles on the ground;
// any living hero (either side) who walks over a pile pockets it. Heroes spend gold on buildings.
(function (G) {
  G.START_GOLD = 400;
  G.BUILDING_SALVAGE = 0.3;   // share of a building's cost left behind when it's destroyed
  const PICKUP_REACH = 22;    // edge-to-edge distance at which a hero scoops up a pile
  const COIN_R = 10;          // pile radius at the smallest size

  G.coins = [];

  // Drop a pile worth `amount` gold at (x, y). Piles grow (a little) with their value.
  G.dropCoins = function (x, y, amount) {
    amount = Math.round(amount);
    if (amount <= 0) return;
    G.coins.push({ x, y, amount, r: COIN_R + Math.min(18, Math.sqrt(amount) * 1.5), t: 0, dead: false });
    G.burst(x, y, '#ffcf4a', 6, 90);
  };

  // Called once per update step.
  G.updateCoins = function (dt) {
    const heroes = G.entities.filter(h => h instanceof G.Hero && !h.dead);
    for (const c of G.coins) {
      c.t += dt;
      for (const h of heroes) {
        if (G.dist(h.x, h.y, c.x, c.y) > h.r + c.r + PICKUP_REACH) continue;
        const amount = Math.round(c.amount * G.bonusOf(h.team).gold);
        h.gold += amount;
        c.dead = true;
        G.floaters.push({ x: c.x, y: c.y - 10, text: '+' + amount + 'g', t: 0, color: '#ffcf4a' });
        G.burst(c.x, c.y, '#ffe27a', 10, 140);
        break;
      }
    }
    G.coins = G.coins.filter(c => !c.dead);
  };
})(window.Game);
