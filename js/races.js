// Races: each side fields one. A race re-skins every building and unit (see the race model files under
// js/models/), but building names come from the shared catalog.
// Races are cosmetic, with one exception: each fields two special troops of its own (`special`, the
// barracks types that train them; see G.BUILDINGS). Every other troop is the same for everyone.
(function (G) {
  // trait: a short tagline for the lobby. shotFx colors tower/unit shot trails and impacts.
  G.RACES = [
    {
      id: 'human', name: 'Human', color: '#c9a25a',
      desc: 'Frosthaven settlers. Timber, stone and steel.',
      trait: 'Timber, stone and steel',
      shotFx: { trail: '#ffb050', impact: '#e9dcc2' },
      special: ['barracksRam', 'barracksLongbow']
    },
    {
      id: 'algox', name: 'Algox', color: '#9fd4ea',
      desc: 'Towering snow-folk of the northern crags. Hide, bone and living ice.',
      trait: 'Hide, bone and living ice',
      shotFx: { trail: '#bfe9ff', impact: '#dff4ff' },
      special: ['barracksStormspeaker', 'barracksIcespeaker']
    },
    {
      id: 'lurker', name: 'Lurker', color: '#3fc0c8',
      desc: 'Crab-folk risen from the frozen deep. Coral, shell and brine.',
      trait: 'Coral, shell and brine',
      shotFx: { trail: '#5fe0d8', impact: '#9ff0ea' },
      special: ['barracksWavethrower', 'barracksClawcrusher']
    },
    {
      id: 'unfettered', name: 'Unfettered', color: '#e0a040',
      desc: 'Self-made automatons of brass and lightning.',
      trait: 'Brass and lightning',
      shotFx: { trail: '#7fe8ff', impact: '#c8f6ff' },
      special: ['barracksRuinedMachine', 'barracksBurrowingBlade']
    }
  ];

  const byId = {};
  for (const r of G.RACES) byId[r.id] = r;
  G.raceById = id => byId[id] || byId.human;

  // Which race each team plays. Set from the match config before the world is built (see main.js).
  G.teamRace = { [G.TEAM.PLAYER]: 'human', [G.TEAM.ENEMY]: 'algox' };
  G.raceOf = team => G.teamRace[team] || 'human';
  G.raceDef = team => G.raceById(G.raceOf(team));

  // Per-match handicaps, set from the single player difficulty (see ai.js). troopDmg multiplies the damage
  // of a team's soldiers (trained and summoned); gold multiplies the coins its hero picks up.
  const NO_BONUS = { troopDmg: 1, gold: 1 };
  G.teamBonus = { [G.TEAM.PLAYER]: NO_BONUS, [G.TEAM.ENEMY]: NO_BONUS };
  G.bonusOf = team => G.teamBonus[team] || NO_BONUS;

  // The special barracks a team's race can build.
  G.specialBarracks = team => G.raceDef(team).special || [];

  // Barracks carry no race name: they're named after the troops they train (see G.BUILDINGS).
  G.buildingName = (type, team) => (G.raceDef(team).buildings && G.raceDef(team).buildings[type]) || G.BUILDINGS[type].name;
  G.unitName = kind => G.SQUAD_KINDS[kind].name || kind;
})(window.Game);
